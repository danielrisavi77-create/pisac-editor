-- F1-5b: named, immutable checkpoints of the canonical server document.
--
-- Prepared per docs/F1_PLAN.md §6 (migration numbering); follows
-- 2026091905_f1_documents.sql.
-- Target project ref: cxwxxcwrgushfkisfpxz (currently paused).
-- PREPARED ONLY: review and apply by hand. Never auto-apply to production.
--
-- What a checkpoint is: a name the author put on a revision of their work,
-- together with the exact bytes of that revision. It is a bookmark with the
-- text attached, not a branch and not a backup of local state.
--
-- Constitution (docs/F1_PLAN.md §3, §5):
--   * local durable state is NOT canonical server state — a checkpoint is
--     taken from `pisac_documents.current_document` and its revision, inside
--     this function, and there is deliberately no parameter through which a
--     client could supply content. A checkpoint therefore always names
--     something the server really holds; unsent local changes are simply not
--     in it, and the UI says so rather than implying otherwise;
--   * evidence is not judgment — a checkpoint records what a document looked
--     like, never a claim about who wrote it or how;
--   * nothing here overwrites anything: the table is append-only.
--
-- IMMUTABILITY. There is no update and no delete policy on this table, and
-- both privileges are revoked from `authenticated` as well, so neither a
-- future policy mistake nor a direct PostgREST call can rewrite or erase a
-- checkpoint an author made. Insert goes through the one security definer
-- function below and nowhere else.
--
-- ISOLATION: written for the default READ COMMITTED. No write lock is taken
-- and none is needed: the function reads the current document row `for share`
-- (so the row cannot be committed over between the read and the insert) and
-- performs a single insert of what it read. There is no read-modify-write of
-- the document itself, so there is nothing to serialise and no 40001 to
-- handle.
--
-- RESTORING a checkpoint is NOT part of F1 (see docs/F1_STATE.md): this
-- migration creates the record and the read path only.

create extension if not exists pgcrypto;

create table if not exists public.pisac_checkpoints (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.pisac_documents(id) on delete cascade,
  -- The server revision this checkpoint names. 0 is legitimate: a document
  -- that exists and holds no commit yet can still be bookmarked.
  revision bigint not null check (revision >= 0),
  -- The author's own words, trimmed by the function, never rewritten here.
  name text not null check (char_length(name) between 1 and 120),
  document jsonb not null,
  -- md5 of the checkpointed document text, for the same narrow purpose as in
  -- the revision log: telling identical content apart from different content.
  -- Never a security claim and never an integrity guarantee.
  document_digest text not null check (char_length(document_digest) = 32),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- One checkpoint per (document, revision, name). Pressing the button twice
  -- with the same name names the same immutable object, so the second press
  -- collides here instead of appending a copy.
  constraint pisac_checkpoints_document_revision_name_key
    unique (document_id, revision, name)
);

create index if not exists pisac_checkpoints_document_id_created_at_idx
  on public.pisac_checkpoints (document_id, created_at desc);

comment on table public.pisac_checkpoints is
  'Named immutable snapshots of a canonical server document revision. Append-only: no update or delete policy, and both privileges revoked. Written only by pisac_create_checkpoint, which reads the content from the server row rather than taking it from the client. F1: prepared, do not auto-apply to production.';
comment on column public.pisac_checkpoints.revision is
  'The server revision the checkpoint names. Unsent local changes are by definition not included.';
comment on column public.pisac_checkpoints.document is
  'The canonical document exactly as the server held it at that revision. Never client-supplied.';

alter table public.pisac_checkpoints enable row level security;

-- READ path only. Owner-only, reached through document -> project ->
-- workspace. There is deliberately no insert, update or delete policy: the
-- function below is the whole write path, and immutability is the point.
create policy pisac_checkpoints_select_own
  on public.pisac_checkpoints
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
 * Create a checkpoint of the CURRENT server document.
 *
 * `security definer` (owner: postgres) because `authenticated` has no insert
 * privilege on pisac_checkpoints — that revoke is what makes the table
 * append-only in practice and not merely by policy. A definer function skips
 * RLS, so ownership is proven INSIDE the body, explicitly, against auth.uid();
 * `search_path` is empty and every object is schema-qualified, so the caller
 * cannot shadow a name the body resolves.
 *
 * There is no `p_document` parameter and there never will be: the content is
 * read from public.pisac_documents here. A client that could supply the bytes
 * could name a checkpoint after a revision whose content the server never
 * held.
 *
 * Returns:
 *   {"status":"created","checkpointId":<uuid>,"revision":<n>}
 *   {"status":"not_found"}         document absent, or not the caller's
 *   {"status":"unauthenticated"}
 *   {"status":"invalid_name"}      empty after trimming, or over 120 chars
 *
 * A repeated call with the same name at the same revision answers 'created'
 * with the id of the checkpoint that is already there. That is not a white
 * lie: the unique key is (document, revision, name) and the content is server
 * truth at that revision, so the second call names the exact same immutable
 * object. Reporting a retried click as a failure would be the dishonest
 * answer, and minting a second row would break the immutability this table
 * exists for.
 */
create or replace function public.pisac_create_checkpoint(
  p_document_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_name text;
  v_document_id uuid;
  v_revision bigint;
  v_document jsonb;
  v_id uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    return pg_catalog.jsonb_build_object('status', 'unauthenticated');
  end if;

  -- Trim only. Inner whitespace is the author's and is never collapsed; the
  -- same rule as validateCheckpointName in the client contract.
  v_name := pg_catalog.btrim(pg_catalog.coalesce(p_name, ''));
  if pg_catalog.char_length(v_name) = 0
    or pg_catalog.char_length(v_name) > 120
  then
    return pg_catalog.jsonb_build_object('status', 'invalid_name');
  end if;

  -- Ownership, explicitly: definer means RLS is not doing this for us. The
  -- `for share` keeps the row from being committed over between this read and
  -- the insert below, without taking a write lock anyone else has to wait on.
  select d.id, d.current_revision, d.current_document
  into v_document_id, v_revision, v_document
  from public.pisac_documents d
  join public.pisac_projects p on p.id = d.project_id
  join public.pisac_workspaces w on w.id = p.workspace_id
  where d.id = p_document_id
    and w.owner_id = v_actor
  for share of d;

  if not found then
    -- Absent, or not the caller's. The same answer either way, so the id
    -- cannot be probed.
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  insert into public.pisac_checkpoints
    (document_id, revision, name, document, document_digest, created_by)
  values
    (v_document_id, v_revision, v_name, v_document,
     pg_catalog.md5(v_document::text), v_actor)
  on conflict (document_id, revision, name) do nothing
  returning id into v_id;

  if v_id is null then
    -- The same name at the same revision is already checkpointed; answer with
    -- the row that is there rather than appending a duplicate.
    select c.id into v_id
    from public.pisac_checkpoints c
    where c.document_id = v_document_id
      and c.revision = v_revision
      and c.name = v_name;
  end if;

  if v_id is null then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'created',
    'checkpointId', v_id,
    'revision', v_revision
  );
end;
$$;

comment on function public.pisac_create_checkpoint(uuid, text) is
  'Names the CURRENT server revision of a document as an immutable checkpoint. Security definer, so ownership is checked in the body against auth.uid(). Content is read from the server row, never supplied by the caller.';

-- Belt and braces: the policy above already gates reads, but this revoke
-- makes the "no anonymous access" rule explicit rather than assumed.
revoke all on table public.pisac_checkpoints from anon;

-- THE WRITE PATH IS THE FUNCTION, NOTHING ELSE — and there is no write path
-- at all for an existing row. Supabase grants `authenticated` full table
-- privileges by default, so without these revokes a direct PostgREST call
-- could insert a checkpoint with invented content, rename one, or delete one.
revoke insert, update, delete on table public.pisac_checkpoints from authenticated;

-- New functions are executable by PUBLIC by default, which would hand the
-- anon role a write path around the table revokes.
revoke all on function public.pisac_create_checkpoint(uuid, text) from public;
revoke all on function public.pisac_create_checkpoint(uuid, text) from anon;
grant execute on function public.pisac_create_checkpoint(uuid, text) to authenticated;
