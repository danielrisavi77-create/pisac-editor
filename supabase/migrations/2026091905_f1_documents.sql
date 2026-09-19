-- F1-4a: canonical server document + immutable revision log.
--
-- Prepared per docs/F1_PLAN.md §6 (migration numbering); follows
-- 2026091904_f1_workspace.sql.
-- Target project ref: cxwxxcwrgushfkisfpxz (currently paused).
-- PREPARED ONLY: review and apply by hand. Never auto-apply to production.
--
-- Constitution (docs/F1_PLAN.md §3, §5):
--   * local durable state is NOT canonical server state — the revision
--     counter lives here and nowhere else;
--   * compare-and-set on the base revision, no silent last-write-wins: a
--     stale base is reported back, never overwritten;
--   * idempotency key (document_id, actor_id, client_transaction_id), so a
--     lost response can be replayed without minting a second revision.
--
-- WRITE PATH: these two tables are writable ONLY through the two security
-- definer functions at the bottom of this file. `authenticated` keeps select
-- (so reads stay RLS-scoped and a future history UI works) and has insert,
-- update and delete revoked. Without that, a PostgREST `PATCH
-- /pisac_documents` or `POST /pisac_document_revisions` would walk straight
-- around the compare-and-set — last-write-wins by another name.
--
-- ISOLATION: written for the default READ COMMITTED. The commit function
-- serialises writers on the document row with `for update`, so it never
-- relies on REPEATABLE READ and never has to handle a 40001 serialisation
-- failure.

create extension if not exists pgcrypto;

-- Exactly one document per project in F1 (enforced by the unique project_id);
-- the plural table name is deliberate, because F2 lifts that restriction.
create table if not exists public.pisac_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.pisac_projects(id) on delete cascade,
  current_revision bigint not null default 0 check (current_revision >= 0),
  current_document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

-- The revision log. Append-only by construction: there is no update or delete
-- policy below, and the privilege is revoked from `authenticated` as well, so
-- neither a future policy mistake nor a direct PostgREST call can rewrite an
-- author's history.
create table if not exists public.pisac_document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.pisac_documents(id) on delete cascade,
  revision bigint not null check (revision > 0),
  document jsonb not null,
  -- md5 of the committed document text. Read only to tell a genuine replay
  -- (same content under the same key) from a client bug that reused an
  -- idempotency key for different content. Never a security claim.
  document_digest text not null check (char_length(document_digest) = 32),
  actor_id uuid not null references auth.users(id),
  client_transaction_id text not null
    check (char_length(client_transaction_id) between 1 and 128),
  created_at timestamptz not null default now(),
  -- One row per revision of a document: the CAS winner, nothing else.
  constraint pisac_document_revisions_revision_key
    unique (document_id, revision),
  -- The idempotency key. A replayed commit collides here instead of
  -- appending a duplicate revision.
  constraint pisac_document_revisions_idempotency_key
    unique (document_id, actor_id, client_transaction_id)
);

create index if not exists pisac_documents_project_id_idx
  on public.pisac_documents (project_id);

-- Reuses the trigger function created by 2026091904_f1_workspace.sql.
drop trigger if exists pisac_documents_set_updated_at on public.pisac_documents;

create trigger pisac_documents_set_updated_at
  before update on public.pisac_documents
  for each row
  execute function public.pisac_set_updated_at();

comment on table public.pisac_documents is
  'Canonical server state of one project''s document: the current revision and its content. Local durable state is never this. Written only by pisac_commit_document / pisac_ensure_document. F1: prepared, do not auto-apply to production.';
comment on table public.pisac_document_revisions is
  'Immutable append-only revision log. Written only by pisac_commit_document; (document_id, actor_id, client_transaction_id) is the idempotency key. F1: prepared, do not auto-apply to production.';
comment on column public.pisac_documents.current_revision is
  'Canonical revision. 0 means the document exists but nothing has been committed yet.';
comment on column public.pisac_document_revisions.client_transaction_id is
  'Client-minted idempotency key, unique per (document, actor). Never a keystroke log: one id per debounced canonical candidate.';

alter table public.pisac_documents enable row level security;
alter table public.pisac_document_revisions enable row level security;

-- READ path only. Owner-only, reached through project -> workspace. There are
-- deliberately no insert, update or delete policies on either table: the two
-- functions below are the whole write path, and a policy here would only
-- create a second one.

create policy pisac_documents_select_own
  on public.pisac_documents
  for select
  to authenticated
  using (
    project_id in (
      select p.id
      from public.pisac_projects p
      join public.pisac_workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  );

create policy pisac_document_revisions_select_own
  on public.pisac_document_revisions
  for select
  to authenticated
  using (
    document_id in (
      select d.id
      from public.pisac_documents d
      join public.pisac_projects p on p.id = d.project_id
      join public.pisac_workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  );

/*
 * Get-or-create the single F1 document of a project.
 *
 * `security definer` (owner: postgres) because `authenticated` has no insert
 * privilege on pisac_documents any more — that revoke is what closes the
 * PATCH-around-the-CAS hole. A definer function skips RLS, so ownership is
 * proven INSIDE the body, explicitly, against auth.uid(); `search_path` is
 * empty and every object is schema-qualified, so the caller cannot shadow a
 * name the body resolves.
 *
 * Returns:
 *   {"status":"ok","documentId":<uuid>,"revision":<n>,"document":<jsonb>}
 *   {"status":"not_found"}         project absent, or not the caller's
 *   {"status":"unauthenticated"}
 */
create or replace function public.pisac_ensure_document(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_owned boolean;
  v_id uuid;
  v_revision bigint;
  v_document jsonb;
begin
  v_actor := auth.uid();
  if v_actor is null then
    return pg_catalog.jsonb_build_object('status', 'unauthenticated');
  end if;

  -- Ownership, explicitly: definer means RLS is not doing this for us.
  select pg_catalog.count(*) > 0 into v_owned
  from public.pisac_projects p
  join public.pisac_workspaces w on w.id = p.workspace_id
  where p.id = p_project_id
    and w.owner_id = v_actor;

  if not v_owned then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  select d.id, d.current_revision, d.current_document
  into v_id, v_revision, v_document
  from public.pisac_documents d
  where d.project_id = p_project_id;

  if not found then
    -- The canonical empty document: exactly one empty paragraph, schema
    -- version 1. Mirrors `emptyDocument()` in src/domain/document/transaction.ts;
    -- minted here rather than taken as an argument so a direct PostgREST call
    -- cannot seed a project with content that never passed validation.
    -- gen_random_uuid() is pg_catalog's (PG13+), not pgcrypto's, so it
    -- resolves under the empty search_path.
    v_document := pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'nodes', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'type', 'paragraph',
          'id', pg_catalog.gen_random_uuid()::text,
          'children', '[]'::jsonb
        )
      )
    );

    insert into public.pisac_documents (project_id, current_revision, current_document)
    values (p_project_id, 0, v_document)
    on conflict (project_id) do nothing
    returning id, current_revision, current_document
    into v_id, v_revision, v_document;

    if v_id is null then
      -- Another request won the race; re-read its row rather than its answer.
      select d.id, d.current_revision, d.current_document
      into v_id, v_revision, v_document
      from public.pisac_documents d
      where d.project_id = p_project_id;
    end if;
  end if;

  if v_id is null then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'documentId', v_id,
    'revision', v_revision,
    'document', v_document
  );
end;
$$;

/*
 * The CAS commit.
 *
 * `security definer` (owner: postgres) for the same reason: `authenticated`
 * cannot insert into pisac_document_revisions or update pisac_documents, so
 * this function is the only way a revision is ever minted. Ownership is
 * therefore checked here, explicitly, through document -> project ->
 * workspace against auth.uid(); a document that is not the caller's is
 * reported as not_found, exactly as an absent one is.
 *
 * Returns one of:
 *   {"status":"committed",   "revision":<new>}
 *   {"status":"duplicate",   "revision":<the revision this key already made>}
 *   {"status":"txid_reused"}                  same key, different content
 *   {"status":"stale_base",  "currentRevision":<server's revision>}
 *   {"status":"too_large"}                    payload over 1 MiB
 *   {"status":"not_found"}                    document absent or not yours
 *   {"status":"unauthenticated"}              no auth.uid()
 *   {"status":"invalid_document"}             payload is not a v1 document
 *   {"status":"invalid_client_transaction_id"}
 *
 * Document validation here is deliberately shallow (object + schemaVersion +
 * size): the authoritative structural check is `validateDocument` in
 * src/domain/document/validate.ts, which runs in the server action before
 * this function is ever called. Postgres is the last gate, not the only one.
 */
create or replace function public.pisac_commit_document(
  p_document_id uuid,
  p_base_revision bigint,
  p_document jsonb,
  p_client_transaction_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_digest text;
  v_seen_digest text;
  v_duplicate bigint;
  v_current bigint;
  v_next bigint;
begin
  v_actor := auth.uid();
  if v_actor is null then
    return pg_catalog.jsonb_build_object('status', 'unauthenticated');
  end if;

  -- The idempotency key has to be well formed before it can be looked up.
  if p_client_transaction_id is null
    or pg_catalog.char_length(p_client_transaction_id) = 0
    or pg_catalog.char_length(p_client_transaction_id) > 128
  then
    return pg_catalog.jsonb_build_object('status', 'invalid_client_transaction_id');
  end if;

  if pg_catalog.jsonb_typeof(p_document) is distinct from 'object'
    or p_document -> 'schemaVersion' is distinct from '1'::jsonb
  then
    return pg_catalog.jsonb_build_object('status', 'invalid_document');
  end if;

  -- 1 MiB. A document this big is a bug or an attack, and the revision log
  -- would carry a copy of it forever.
  if pg_catalog.pg_column_size(p_document) > 1048576 then
    return pg_catalog.jsonb_build_object('status', 'too_large');
  end if;

  v_digest := pg_catalog.md5(p_document::text);

  -- (a) Idempotency first: a replayed commit must answer from the log, not
  -- take the lock and not mint a revision. Scoped to this actor, so it can
  -- only ever see rows the caller wrote.
  select r.revision, r.document_digest
  into v_duplicate, v_seen_digest
  from public.pisac_document_revisions r
  where r.document_id = p_document_id
    and r.actor_id = v_actor
    and r.client_transaction_id = p_client_transaction_id;

  if found then
    if v_seen_digest is distinct from v_digest then
      -- Same key, different content: the client reused an idempotency key.
      -- Nothing is written, and it is not reported as a successful replay.
      return pg_catalog.jsonb_build_object('status', 'txid_reused');
    end if;
    return pg_catalog.jsonb_build_object('status', 'duplicate', 'revision', v_duplicate);
  end if;

  -- (b) Serialise concurrent commits on the document row itself, and prove
  -- ownership in the same statement: definer skips RLS, so the join chain
  -- document -> project -> workspace against auth.uid() IS the access check.
  select d.current_revision into v_current
  from public.pisac_documents d
  join public.pisac_projects p on p.id = d.project_id
  join public.pisac_workspaces w on w.id = p.workspace_id
  where d.id = p_document_id
    and w.owner_id = v_actor
  for update of d;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  -- Re-check under the lock: two concurrent replays of the same key both pass
  -- the check above, and the loser must still be told 'duplicate' rather than
  -- 'stale_base' or a unique-violation error.
  select r.revision, r.document_digest
  into v_duplicate, v_seen_digest
  from public.pisac_document_revisions r
  where r.document_id = p_document_id
    and r.actor_id = v_actor
    and r.client_transaction_id = p_client_transaction_id;

  if found then
    if v_seen_digest is distinct from v_digest then
      return pg_catalog.jsonb_build_object('status', 'txid_reused');
    end if;
    return pg_catalog.jsonb_build_object('status', 'duplicate', 'revision', v_duplicate);
  end if;

  -- (c) Compare-and-set. `is distinct from` so a null base is a mismatch and
  -- never falls through to a write. Nothing is overwritten on a mismatch.
  if v_current is distinct from p_base_revision then
    return pg_catalog.jsonb_build_object('status', 'stale_base', 'currentRevision', v_current);
  end if;

  -- (d) Append, then advance. The insert carries the same row lock, so the
  -- log and the pointer move together or not at all.
  v_next := v_current + 1;

  insert into public.pisac_document_revisions
    (document_id, revision, document, document_digest, actor_id, client_transaction_id)
  values
    (p_document_id, v_next, p_document, v_digest, v_actor, p_client_transaction_id);

  update public.pisac_documents
  set current_document = p_document,
      current_revision = v_next
  where id = p_document_id;

  return pg_catalog.jsonb_build_object('status', 'committed', 'revision', v_next);
end;
$$;

comment on function public.pisac_ensure_document(uuid) is
  'Get-or-create the single F1 document of a project. Security definer, so ownership is checked in the body against auth.uid().';
comment on function public.pisac_commit_document(uuid, bigint, jsonb, text) is
  'Compare-and-set commit of one canonical document revision. Idempotent per (document_id, auth.uid(), client_transaction_id). A stale base is reported, never overwritten.';

-- Belt and braces: the policies above already gate reads, but these revokes
-- make the "no anonymous access" rule explicit rather than assumed.
revoke all on table public.pisac_documents from anon;
revoke all on table public.pisac_document_revisions from anon;

-- THE WRITE PATH IS THE TWO FUNCTIONS, NOTHING ELSE.
-- Supabase grants `authenticated` full table privileges by default, so
-- without these revokes a direct PostgREST call could update a document's
-- current_revision, or append a revision, without ever touching the CAS.
revoke insert, update, delete on table public.pisac_documents from authenticated;
revoke insert, update, delete on table public.pisac_document_revisions from authenticated;

-- New functions are executable by PUBLIC by default, which would hand the
-- anon role a write path around the table revokes.
revoke all on function public.pisac_ensure_document(uuid) from public;
revoke all on function public.pisac_ensure_document(uuid) from anon;
grant execute on function public.pisac_ensure_document(uuid) to authenticated;

revoke all on function public.pisac_commit_document(uuid, bigint, jsonb, text) from public;
revoke all on function public.pisac_commit_document(uuid, bigint, jsonb, text) from anon;
grant execute on function public.pisac_commit_document(uuid, bigint, jsonb, text) to authenticated;
