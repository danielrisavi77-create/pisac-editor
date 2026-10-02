# F1-8 Activate — runbook

**Datum:** 2. listopada 2026.  
**Status:** BACKEND_ACTIVE_DEPLOY_ENV_PENDING  
**Owner:** Daniel Rišavi  
**Project ref:** `cxwxxcwrgushfkisfpxz` (eu-central-1) — `ACTIVE_HEALTHY`

## Live backend evidence

Live migration history currently contains:

- `f1_workspace`
- `f1_documents_tables`
- `f1_ensure_document_fn`
- `f1_commit_document_fn`
- `f1_documents_grants`
- `f1_checkpoints`
- `f1_live_hardening`

Live tables: `pisac_workspaces`, `pisac_projects`, `pisac_documents`, `pisac_document_revisions`, `pisac_checkpoints`.

All five F1 tables have RLS enabled. The database is intentionally empty before authenticated synthetic verification.

The three authenticated-callable SECURITY DEFINER RPC advisor warnings are expected and must remain explicitly reviewed:
- `pisac_ensure_document`
- `pisac_commit_document`
- `pisac_create_checkpoint`

They are the intentional privileged write paths; PUBLIC/anon execution must remain revoked and authorization stays in the functions.

## Current Supabase compatibility requirement

Supabase now recommends publishable browser keys for new deployments. Pisač therefore uses:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` remains a temporary compatibility fallback only. Do not add a secret/service-role key to any `NEXT_PUBLIC_*` variable.

## Remaining Gate 1 activation steps

1. Configure the deployed application environment:
   - `NEXT_PUBLIC_SUPABASE_URL=https://cxwxxcwrgushfkisfpxz.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key from Supabase>`
   - `NEXT_PUBLIC_SITE_URL=https://pisac-demo.netlify.app`
2. Configure Supabase Auth URL allowlisting for:
   - `http://localhost:3000/auth/callback`
   - `https://pisac-demo.netlify.app/auth/callback`
3. Ensure Netlify deployment authentication is configured; a skipped deploy is not deployment evidence.
4. Deploy an exact commit with the public Supabase environment present at build/runtime.
5. Run authenticated synthetic E2E:
   - sign in;
   - create/list project;
   - open document;
   - edit → local durable → server sync;
   - reload and verify persistence;
   - create checkpoint;
   - exercise stale-base conflict/recovery;
   - sign out/in and verify persistence.
6. Run authorization adverse cases:
   - Student A own data = ALLOW;
   - Student A → Student B = DENY;
   - anonymous → protected data = DENY;
   - direct forbidden table mutation = DENY;
   - approved RPC mutation = ALLOW.
7. Bind evidence to exact commit, deployment origin, Supabase project ref, workflow run and test artifacts.
8. Only then promote the applicable F1 fixtures from PARTIAL/UNIT-COVERED toward PASS.

## Slot state

Lekta staging remains paused while the dedicated Pisač project is active on the current plan. Production Lekta was not changed.

Definition ≠ PASS. An active database is not the same as an authenticated product E2E pass.
