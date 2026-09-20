# F1-8 Activate — runbook

**Datum:** 20. rujna 2026.  
**Status:** SCHEMA_APPLIED  
**Owner:** Daniel Rišavi  
**Project ref:** `cxwxxcwrgushfkisfpxz` (eu-central-1) — `ACTIVE_HEALTHY`

## Applied migrations

- `f1_workspace`
- `f1_documents_tables`
- `f1_ensure_document_fn`
- `f1_commit_document_fn`
- `f1_documents_grants`
- `f1_checkpoints`

Live tables: `pisac_workspaces`, `pisac_projects`, `pisac_documents`, `pisac_document_revisions`, `pisac_checkpoints`.

SECURITY DEFINER RPCs (`pisac_ensure_document`, `pisac_commit_document`, `pisac_create_checkpoint`) are intentional write paths. Advisor WARN is expected.

## Slot juggling

Lekta staging (`bnyemcnsphlitjradrst`) remains paused so Pisac can stay active on the free plan.

## Still on you

1. Auth → URL Configuration:
   - `http://localhost:3000/auth/callback`
   - production origin `/auth/callback` once deployed
2. Local `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL=https://cxwxxcwrgushfkisfpxz.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=` (Project Settings → API → anon)
   - `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
3. Vercel connector needs re-auth to finish deploy (`pisac` project id `prj_ksnRDuZjXCeaCZuZOPCcUGiR6tDe`).
4. Authenticated E2E after env is live.

Definition ≠ PASS. Schema applied is not fixture PASS.
