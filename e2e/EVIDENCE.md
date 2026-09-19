# F1 fixture evidence record

Definition ≠ PASS. Evidence must bind fixture → executable test → exact SHA →
environment → result → artifact.

- Environment: Node 22 local / `.nvmrc` Node 24 in CI, Chromium (Playwright
  project `chromium`), production build via `next build && next start`.
- Commands: `npm test` (unit + AI Architect), `npm run test:e2e` (Playwright).
- SHA for this record: the commit that last touched this file —
  `git log -1 --format=%H -- e2e/EVIDENCE.md`.
- Limitation, not a gap to paper over: no `NEXT_PUBLIC_SUPABASE_*` env vars
  exist here (Supabase project `Pisac` is PAUSED, `docs/F1_STATE.md` Q2), so the
  app under test is UNCONFIGURED. Every authenticated surface — workspace,
  `/d/[id]` editor, server commit, checkpoints — cannot be exercised in a
  browser yet. Those legs are BLOCKED, never simulated.
- What `/demo` does and does not unblock: the public demo route runs the same
  `Editor`, journal and sync reducer with no auth and no server, so the
  LOCAL side is now exercised in a real browser (`e2e/demo.spec.ts`). It is
  evidence about local durability only. Everything that needs a server —
  SYNCED, drain, CAS, conflict, checkpoints, `/d/[id]` itself — stays BLOCKED,
  and the demo deliberately cannot reach those states.

| Fixture ID | Owner test file(s) | Status |
|---|---|---|
| FX-FR-001-001 | `e2e/auth-guard.spec.ts`, `src/lib/supabase/guard.test.ts`, `src/domain/workspace/types.test.ts` | E2E-PARTIAL (guard only; project create/list BLOCKED: Supabase project paused) |
| FX-FR-002-001 | `src/domain/document/{schema,validate,normalize,equality}.test.ts` | UNIT-COVERED (E2E pending Supabase project) |
| FX-FR-004-001 | `src/domain/document/transaction.test.ts`, `src/editor/{schema,interop}.test.ts` | UNIT-COVERED (E2E pending Supabase project) |
| FX-FR-020-001 | `src/lib/journal/journal.test.ts`, `src/domain/sync/states.test.ts`, `e2e/demo.spec.ts` | E2E-PARTIAL (local durable leg in-browser on `/demo`; server leg BLOCKED: Supabase project paused) |
| FX-FR-021-001 | `src/domain/sync/drain.test.ts`, `src/lib/sync/drainRunner.test.ts` | UNIT-COVERED (E2E pending Supabase project) |
| FX-FR-022-001 | `src/domain/serverSync/{contract,bootstrap,migration}.test.ts` | UNIT-COVERED (E2E pending Supabase project) |
| FX-FR-023-001 | `src/domain/sync/conflict.test.ts` | UNIT-COVERED (E2E pending Supabase project) |
| FX-FR-024-001 | `src/domain/sync/recovery.test.ts`, `src/lib/journal/recovery.test.ts` | UNIT-COVERED (E2E pending Supabase project) |
| FX-FR-025-001 | `src/domain/serverSync/{checkpoints,checkpointsMigration}.test.ts` | UNIT-COVERED (E2E pending Supabase project) |
| FX-FR-075-001 | `src/domain/docx/{serialize,manifest,labels}.test.ts`, `src/lib/docx/export.test.ts` | UNIT-COVERED (E2E pending Supabase project) |
| FX-X-A11Y-001 | `e2e/a11y.spec.ts`, `src/domain/sync/labels.test.ts`, `e2e/demo.spec.ts` | E2E-PARTIAL (3 public routes + editor toolbar and 360px on `/demo`; authenticated editor a11y BLOCKED: Supabase project paused) |
| FX-X-REL-001 | `src/lib/sync/drainRunner.test.ts` (backoff/jitter/single-flight), `src/lib/journal/lock.test.ts` | UNIT-COVERED (E2E pending Supabase project) |
| FX-X-CLIENT-001 | `e2e/smoke.spec.ts`, `e2e/demo.spec.ts`, `src/lib/journal/journal.test.ts` | E2E-PARTIAL (shell + `/legacy/` + in-browser journal to LOCAL_DURABLE on `/demo`; authenticated offline flow BLOCKED: Supabase project paused) |
| FX-X-DG-001 | `src/domain/workspace/migration.test.ts`, `src/domain/serverSync/migration.test.ts`, `src/lib/journal/journal.test.ts` | UNIT-COVERED (E2E pending Supabase project) |
| FX-X-SEC-001 | `e2e/auth-guard.spec.ts`, `e2e/security-headers.spec.ts`, `src/lib/supabase/guard.test.ts`, `src/lib/rate/limiter.test.ts` | E2E-PARTIAL (deny path + no-secret-leak + CSP/XFO on every route with the demo typing canary passing under the policy; authenticated allow path and the OTP limiter's live leg BLOCKED: Supabase project paused. The app-layer limiter is per process and best effort by construction — the real limits are Supabase/edge config, see `.env.example`) |

UNIT-COVERED means the mechanism has executable unit tests, not that the
fixture passes end to end. No fixture is marked PASS.
