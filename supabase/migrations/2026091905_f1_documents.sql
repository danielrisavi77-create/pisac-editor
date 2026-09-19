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
  'Canonical server state of one project''s document: the current revision and its content. Local durable state is never this. F1: prepared, do not auto-apply to production.';
comment on table public.pisac_document_revisions is
  'Immutable append-only revision log. Insert and select only; (document_id, actor_id, client_transaction_id) is the idempotency key. F1: prepared, do not auto-apply to production.';
comment on column public.pisac_documents.current_revision is
  'Canonical revision. 0 means the document exists but nothing has been committed yet.';
comment on column public.pisac_document_revisions.client_transaction_id is
  'Client-minted idempotency key, unique per (document, actor). Never a keystroke log: one id per debounced canonical candidate.';

alter table public.pisac_documents enable row level security;
alter table public.pisac_document_revisions enable row level security;

-- Owner-only access, reached through project -> workspace. No grants to anon;
-- the authenticated role reaches these rows solely through the policies below.

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

create policy pisac_documents_insert_own
  on public.pisac_documents
  for insert
  to authenticated
  with check (
    project_id in (
      select p.id
      from public.pisac_projects p
      join public.pisac_workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  );

create policy pisac_documents_update_own
  on public.pisac_documents
  for update
  to authenticated
  using (
    project_id in (
      select p.id
      from public.pisac_projects p
      join public.pisac_workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  )
  with check (
    project_id in (
      select p.id
      from public.pisac_projects p
      join public.pisac_workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  );

-- Deliberately no delete policy on pisac_documents: a document dies with its
-- project, through the on delete cascade, not by hand.

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

create policy pisac_document_revisions_insert_own
  on public.pisac_document_revisions
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and document_id in (
      select d.id
      from public.pisac_documents d
      join public.pisac_projects p on p.id = d.project_id
      join public.pisac_workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  );

-- IMMUTABLE: no update policy, no delete policy on pisac_document_revisions.

/*
 * The CAS commit.
 *
 * `security invoker`, so row level security keeps deciding who may touch
 * which document — a security definer function here would be a private door
 * around the policies above. `search_path` is empty: every object is
 * schema-qualified, and pg_catalog stays implicitly available.
 *
 * Returns one of:
 *   {"status":"committed",   "revision":<new>}
 *   {"status":"duplicate",   "revision":<the revision this key already made>}
 *   {"status":"stale_base",  "currentRevision":<server's revision>}
 *   {"status":"not_found"}                    document invisible or absent
 *   {"status":"unauthenticated"}              no auth.uid()
 *   {"status":"invalid_document"}             payload is not a v1 document
 *   {"status":"invalid_client_transaction_id"}
 *
 * Document validation here is deliberately shallow (object + schemaVersion):
 * the authoritative structural check is `validateDocument` in
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
security invoker
set search_path = ''
as $$
declare
  v_actor uuid;
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

  -- (a) Idempotency first: a replayed commit must answer from the log, not
  -- take the lock and not mint a revision.
  select r.revision into v_duplicate
  from public.pisac_document_revisions r
  where r.document_id = p_document_id
    and r.actor_id = v_actor
    and r.client_transaction_id = p_client_transaction_id;

  if found then
    return pg_catalog.jsonb_build_object('status', 'duplicate', 'revision', v_duplicate);
  end if;

  if pg_catalog.jsonb_typeof(p_document) is distinct from 'object'
    or p_document -> 'schemaVersion' is distinct from '1'::jsonb
  then
    return pg_catalog.jsonb_build_object('status', 'invalid_document');
  end if;

  -- (b) Serialise concurrent commits on the document row itself.
  select d.current_revision into v_current
  from public.pisac_documents d
  where d.id = p_document_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  -- Re-check under the lock: two concurrent replays of the same key both pass
  -- the check above, and the loser must still be told 'duplicate' rather than
  -- 'stale_base' or a unique-violation error.
  select r.revision into v_duplicate
  from public.pisac_document_revisions r
  where r.document_id = p_document_id
    and r.actor_id = v_actor
    and r.client_transaction_id = p_client_transaction_id;

  if found then
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
    (document_id, revision, document, actor_id, client_transaction_id)
  values
    (p_document_id, v_next, p_document, v_actor, p_client_transaction_id);

  update public.pisac_documents
  set current_document = p_document,
      current_revision = v_next
  where id = p_document_id;

  return pg_catalog.jsonb_build_object('status', 'committed', 'revision', v_next);
end;
$$;

comment on function public.pisac_commit_document(uuid, bigint, jsonb, text) is
  'Compare-and-set commit of one canonical document revision. Idempotent per (document_id, auth.uid(), client_transaction_id). A stale base is reported, never overwritten.';

-- Belt and braces: the policies above already gate access, but these revokes
-- make the "no anonymous access" rule explicit rather than assumed.
revoke all on table public.pisac_documents from anon;
revoke all on table public.pisac_document_revisions from anon;

-- The revision log is immutable even for its owner. Without this, a future
-- update or delete policy would be enough to rewrite history.
revoke update, delete on table public.pisac_document_revisions from authenticated;

-- New functions are executable by PUBLIC by default, which would hand the
-- anon role a commit path around the table revokes.
revoke all on function public.pisac_commit_document(uuid, bigint, jsonb, text) from public;
revoke all on function public.pisac_commit_document(uuid, bigint, jsonb, text) from anon;
grant execute on function public.pisac_commit_document(uuid, bigint, jsonb, text) to authenticated;
