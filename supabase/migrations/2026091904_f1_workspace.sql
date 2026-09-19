-- F1-1b: personal workspace + academic project.
--
-- Prepared per docs/F1_PLAN.md §6 (migration numbering); first F1 migration.
-- Target project ref: cxwxxcwrgushfkisfpxz (currently paused).
-- PREPARED ONLY: review and apply by hand. Never auto-apply to production.
--
-- Tables use the `pisac_` prefix so they stay disjoint from any future
-- shared-project tables.

create extension if not exists pgcrypto;

-- One personal workspace per user in F1 (enforced by the unique owner_id).
create table if not exists public.pisac_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (owner_id)
);

create table if not exists public.pisac_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.pisac_workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pisac_projects_workspace_id_idx
  on public.pisac_projects (workspace_id);

-- Keeps updated_at truthful; without it the column would only ever hold the
-- insert time. Plain function (no security definer needed) with an empty
-- search_path, so every referenced object is schema-qualified.
create or replace function public.pisac_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists pisac_projects_set_updated_at on public.pisac_projects;

create trigger pisac_projects_set_updated_at
  before update on public.pisac_projects
  for each row
  execute function public.pisac_set_updated_at();

comment on table public.pisac_workspaces is
  'Personal workspace owned by exactly one authenticated user. F1: prepared, do not auto-apply to production.';
comment on table public.pisac_projects is
  'Academic project (rad) belonging to one personal workspace. F1: prepared, do not auto-apply to production.';

alter table public.pisac_workspaces enable row level security;
alter table public.pisac_projects enable row level security;

-- Owner-only access. No grants to anon; the authenticated role reaches these
-- rows solely through the policies below.

create policy pisac_workspaces_select_own
  on public.pisac_workspaces
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy pisac_workspaces_insert_own
  on public.pisac_workspaces
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy pisac_workspaces_update_own
  on public.pisac_workspaces
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy pisac_workspaces_delete_own
  on public.pisac_workspaces
  for delete
  to authenticated
  using (owner_id = auth.uid());

create policy pisac_projects_select_own
  on public.pisac_projects
  for select
  to authenticated
  using (
    workspace_id in (
      select w.id from public.pisac_workspaces w where w.owner_id = auth.uid()
    )
  );

create policy pisac_projects_insert_own
  on public.pisac_projects
  for insert
  to authenticated
  with check (
    workspace_id in (
      select w.id from public.pisac_workspaces w where w.owner_id = auth.uid()
    )
  );

create policy pisac_projects_update_own
  on public.pisac_projects
  for update
  to authenticated
  using (
    workspace_id in (
      select w.id from public.pisac_workspaces w where w.owner_id = auth.uid()
    )
  )
  with check (
    workspace_id in (
      select w.id from public.pisac_workspaces w where w.owner_id = auth.uid()
    )
  );

create policy pisac_projects_delete_own
  on public.pisac_projects
  for delete
  to authenticated
  using (
    workspace_id in (
      select w.id from public.pisac_workspaces w where w.owner_id = auth.uid()
    )
  );

-- Belt and braces: the policies above already gate access, but these revokes
-- make the "no anonymous access" rule explicit rather than assumed.
revoke all on table public.pisac_workspaces from anon;
revoke all on table public.pisac_projects from anon;
