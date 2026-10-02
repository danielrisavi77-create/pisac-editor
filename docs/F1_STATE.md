# F1 Authoring Kernel — live state
Updated by the orchestrator after each iteration. Keep ≤80 lines.

## Current truth — 2026-10-02

- F1 authoring kernel is implemented on main: auth/workspace, canonical document/editor, Dexie durability, sync state machine, CAS server store, explicit conflict/recovery, checkpoints, DOCX, CI/Playwright, security/perf/quality passes.
- Dedicated Supabase project `Pisac` (`cxwxxcwrgushfkisfpxz`, eu-central-1) is `ACTIVE_HEALTHY`.
- Live database has five F1 public tables with RLS enabled and zero rows before synthetic authenticated verification.
- Live migration history has eight entries: six original F1 migrations plus `f1_live_hardening` and `gate1_least_privilege`.
- Post-hardening ACL proof: workspace/project = SELECT/INSERT/UPDATE/DELETE only; documents/revisions/checkpoints = SELECT only; `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` removed; anon table access remains denied. RPC EXECUTE remains authenticated-only. Advisors still show only the three intentional SECURITY DEFINER WARNs + unused-index INFO.
- Lekta staging remains paused to keep the Pisač project active on the current plan; production Lekta was not changed.
- Supabase publishable keys are now preferred. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is compatibility fallback only.
- Definition ≠ PASS: backend activation alone does not make authenticated F1 fixtures PASS.

## Completed activation work

- DONE G1-BE-001 project state inventoried.
- DONE G1-BE-002 current Supabase docs/changelog reviewed.
- DONE G1-BE-003 workspace migration reviewed/hardened.
- DONE G1-BE-004 document/CAS migration reviewed/hardened.
- DONE G1-BE-005 checkpoint migration reviewed/hardened.
- DONE G1-BE-006 Pisač backend restored and healthy.
- DONE G1-BE-007 existing live migration history preserved; forward-only `f1_live_hardening` applied.
- DONE G1-BE-008 security/performance advisors run and triaged.
- DONE DB-HARD-001 least-privilege migration `gate1_least_privilege` applied and live ACL/RPC contract re-verified.

## Queue — top = next

- TODO(owner/deploy) G1-BE-009 configure deployed app public env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`; ensure Netlify deploy auth exists. No secret/service-role key in browser env.
- TODO(owner/auth) G1-BE-010 allow localhost + production `/auth/callback` URLs in Supabase Auth.
- TODO [review] G1-BE-011 authenticated synthetic login/session E2E.
- TODO [review] G1-BE-012 workspace create/list + document bootstrap/load E2E.
- TODO [review] G1-BE-013 prove LOCAL_DURABLE → SYNCED against live server.
- TODO [review] G1-BE-014 cross-user/anonymous/direct-write adverse authorization matrix.
- TODO [review] G1-BE-015 idempotency, reused tx key and stale-base conflict E2E.
- TODO [review] G1-BE-016 rebase/discard, checkpoint, offline/reconnect, refresh/crash recovery, multi-tab/device.
- TODO G1-BE-017 update `e2e/EVIDENCE.md` with exact SHA + deployment origin + project ref + artifacts; promote only proven fixtures.

## Correctness hardening immediately after authenticated vertical slice

- TODO Q-COR-001 fast-check property/state-machine invariants for forensics, process ledger, object registry, revision/evidence/mentor projection.
- TODO Q-COR-002 Zod runtime validation at persistence/API boundaries.
- TODO Q-COR-003 Stryker mutation tests on critical domain/lib scope.
- TODO Q-ARCH-001 dependency-cruiser architecture/import boundaries.
- TODO Q-DEAD-001 Knip dead-code/export/dependency gate.
- TODO Q-DEP-001 Renovate dependency + GitHub Action update automation.
- TODO Q-FORMAL-001 small Alloy 6 model for Revision + Share + Mentor + Evidence invariants; not a Gate 1 blocker.
- TODO Q-SEC-001 Gitleaks + OSV + zizmor + Semgrep + Harden-Runner CI.

## Active stacked product work

- PR #33 Academic Revision Lifecycle — MERGED to main.
- PR #34 revision-specific EvidenceBasis — draft, now based on main.
- PR #35 persistent ReviewCoverage + mentor revision projection — draft, stacked on #34.
- Finish/reconcile this stack in order; do not let it replace Gate 1 live-backend evidence.

## Notes

- Public `/demo` is local-only evidence; it never proves server sync, RLS, canonical revisions or mentor authorization.
- AI Architect stays frozen during F1 except keeping its tests green.
- No production live AI endpoint until identity/quota/distributed-abuse gates exist.
- Windows local test parity issue is tracked in #39 (Vitest alias + CRLF SQL parser + noisy perf p95); GitHub CI remains authoritative until fixed.
- Dependency audit issue #40 tracks vulnerable PostCSS transitively pinned by Next 15.5.25.
