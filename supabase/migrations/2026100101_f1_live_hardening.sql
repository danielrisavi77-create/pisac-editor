-- F1 live hardening after restoring the existing Pisač project.
-- Forward-only: the project already has the original F1 migrations applied.
-- Aligns live privileges/RLS with the reviewed repository migrations and
-- addresses Supabase performance advisor findings without rewriting history.

-- Workspace/project CRUD is intentional and row-scoped by RLS.
grant select, insert, update, delete on table public.pisac_workspaces to authenticated;
grant select, insert, update, delete on table public.pisac_projects to authenticated;
revoke all on table public.pisac_workspaces from anon;
revoke all on table public.pisac_projects from anon;

-- Canonical server state is readable directly, but writes stay RPC-only.
grant select on table public.pisac_documents to authenticated;
grant select on table public.pisac_document_revisions to authenticated;
grant select on table public.pisac_checkpoints to authenticated;
revoke insert, update, delete on table public.pisac_documents from authenticated;
revoke insert, update, delete on table public.pisac_document_revisions from authenticated;
revoke insert, update, delete on table public.pisac_checkpoints from authenticated;
revoke all on table public.pisac_documents from anon;
revoke all on table public.pisac_document_revisions from anon;
revoke all on table public.pisac_checkpoints from anon;

-- Recreate RLS policies using initPlan-friendly auth.uid() calls.
drop policy if exists pisac_workspaces_select_own on public.pisac_workspaces;
create policy pisac_workspaces_select_own on public.pisac_workspaces for select to authenticated
using (owner_id = (select auth.uid()));
drop policy if exists pisac_workspaces_insert_own on public.pisac_workspaces;
create policy pisac_workspaces_insert_own on public.pisac_workspaces for insert to authenticated
with check (owner_id = (select auth.uid()));
drop policy if exists pisac_workspaces_update_own on public.pisac_workspaces;
create policy pisac_workspaces_update_own on public.pisac_workspaces for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists pisac_workspaces_delete_own on public.pisac_workspaces;
create policy pisac_workspaces_delete_own on public.pisac_workspaces for delete to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists pisac_projects_select_own on public.pisac_projects;
create policy pisac_projects_select_own on public.pisac_projects for select to authenticated
using (workspace_id in (select w.id from public.pisac_workspaces w where w.owner_id = (select auth.uid())));
drop policy if exists pisac_projects_insert_own on public.pisac_projects;
create policy pisac_projects_insert_own on public.pisac_projects for insert to authenticated
with check (workspace_id in (select w.id from public.pisac_workspaces w where w.owner_id = (select auth.uid())));
drop policy if exists pisac_projects_update_own on public.pisac_projects;
create policy pisac_projects_update_own on public.pisac_projects for update to authenticated
using (workspace_id in (select w.id from public.pisac_workspaces w where w.owner_id = (select auth.uid())))
with check (workspace_id in (select w.id from public.pisac_workspaces w where w.owner_id = (select auth.uid())));
drop policy if exists pisac_projects_delete_own on public.pisac_projects;
create policy pisac_projects_delete_own on public.pisac_projects for delete to authenticated
using (workspace_id in (select w.id from public.pisac_workspaces w where w.owner_id = (select auth.uid())));

drop policy if exists pisac_documents_select_own on public.pisac_documents;
create policy pisac_documents_select_own on public.pisac_documents for select to authenticated
using (project_id in (
  select p.id from public.pisac_projects p
  join public.pisac_workspaces w on w.id = p.workspace_id
  where w.owner_id = (select auth.uid())
));

drop policy if exists pisac_document_revisions_select_own on public.pisac_document_revisions;
create policy pisac_document_revisions_select_own on public.pisac_document_revisions for select to authenticated
using (document_id in (
  select d.id from public.pisac_documents d
  join public.pisac_projects p on p.id = d.project_id
  join public.pisac_workspaces w on w.id = p.workspace_id
  where w.owner_id = (select auth.uid())
));

drop policy if exists pisac_checkpoints_select_own on public.pisac_checkpoints;
create policy pisac_checkpoints_select_own on public.pisac_checkpoints for select to authenticated
using (document_id in (
  select d.id from public.pisac_documents d
  join public.pisac_projects p on p.id = d.project_id
  join public.pisac_workspaces w on w.id = p.workspace_id
  where w.owner_id = (select auth.uid())
));

-- Cover FK columns called out by the performance advisor.
create index if not exists pisac_document_revisions_actor_id_idx
  on public.pisac_document_revisions(actor_id);
create index if not exists pisac_checkpoints_created_by_idx
  on public.pisac_checkpoints(created_by);

-- The three authenticated SECURITY DEFINER RPC warnings are intentional:
-- these are the only canonical write paths. Their original migrations pin an
-- empty search_path, schema-qualify objects, check auth.uid() internally, and
-- revoke EXECUTE from PUBLIC/anon.
