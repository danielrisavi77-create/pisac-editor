-- Gate 1 least-privilege hardening for the already-live F1 tables.
-- Forward-only: do not rewrite or replay previously applied F1 migrations.
--
-- Supabase may leave broader table privileges on public-schema roles by
-- default. Pisač needs only workspace/project CRUD and read-only access to
-- canonical server state; canonical writes remain RPC-only.

-- Personal workspace/project rows are writable only through their RLS policies.
revoke all on table public.pisac_workspaces from anon, authenticated;
revoke all on table public.pisac_projects from anon, authenticated;
grant select, insert, update, delete on table public.pisac_workspaces to authenticated;
grant select, insert, update, delete on table public.pisac_projects to authenticated;

-- Canonical documents, revisions and checkpoints are directly read-only.
-- INSERT/UPDATE/DELETE remain available only through the reviewed RPCs.
revoke all on table public.pisac_documents from anon, authenticated;
revoke all on table public.pisac_document_revisions from anon, authenticated;
revoke all on table public.pisac_checkpoints from anon, authenticated;
grant select on table public.pisac_documents to authenticated;
grant select on table public.pisac_document_revisions to authenticated;
grant select on table public.pisac_checkpoints to authenticated;

-- Intentionally do not change EXECUTE on the three canonical write RPCs here.
-- Their existing contract remains: PUBLIC/anon denied, authenticated allowed.
