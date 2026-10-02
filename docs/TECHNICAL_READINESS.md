# Pisač — Technical Readiness Audit

**Phase:** 0 — Repository Baseline Audit  
**Started:** 2026-10-01  
**Baseline:** main after eab8b517150a79555defe0445cfe15c7227749ae  
**Live reconciliation:** 2026-10-02  
**Rule:** code existence is not equivalent to verified production behavior.

## Executive status

Pisač is not a frontend-only prototype. Main contains a substantial F1 authoring kernel: Next.js, Tiptap canonical editor, Dexie local journal, explicit sync state machine, server-sync contracts, live Supabase/Postgres schema with RLS and privileged RPC boundaries, conflict/recovery logic, checkpoints, DOCX export, CI and Playwright coverage.

The dedicated Pisač Supabase project is now ACTIVE_HEALTHY. The original six F1 migrations were already live; forward-only `f1_live_hardening` and `gate1_least_privilege` migrations have now been applied. The principal Gate 1 blocker is now **deployed application environment + authenticated server-backed E2E/adversarial evidence**, not database restoration.

Collaboration/mentor domain logic and demo UI already exist on main, but F2 explicitly says real UI/server persistence follows backend activation. Newer forensic/process-history work exists in open draft/stacked PRs and is not counted as production-ready main functionality.

## Status legend

DONE; REVIEWED; E2E VERIFIED; INTEGRATION VERIFIED; UNIT VERIFIED; IMPLEMENTED; DESIGNED; NOT STARTED; BLOCKED.

## Capability inventory

| ID | Capability | Status | Priority | Evidence / missing proof |
|---|---|---|---|---|
| P0-001 | Next.js application shell | E2E VERIFIED | P0 | Next.js 15, CI build/Playwright |
| P0-002 | Canonical Tiptap editor | UNIT VERIFIED | P0 | editor/interop tests; authenticated E2E missing |
| P0-003 | Canonical document model | UNIT VERIFIED | P0 | domain tests; server lifecycle E2E missing |
| P0-004 | Local durable journal | E2E VERIFIED (local) | P0 | Dexie + /demo; server reconciliation missing |
| P0-005 | Explicit sync state machine | UNIT VERIFIED | P0 | drain/state tests; live server E2E missing |
| P0-006 | Server CAS/revision store | UNIT VERIFIED / LIVE SCHEMA | P0 | live RPC/schema exists; authenticated browser/CAS E2E missing |
| P0-007 | Conflict resolution | UNIT VERIFIED | P0 | rebase/discard tests; multi-client E2E missing |
| P0-008 | Recovery | UNIT VERIFIED | P0 | recovery tests; live server recovery missing |
| P0-009 | Named checkpoints | UNIT VERIFIED / LIVE SCHEMA | P0 | live checkpoint RPC/table exists; authenticated E2E missing |
| P0-010 | DOCX export | UNIT VERIFIED | P1 | F1 serializer/fidelity tests; browser export E2E missing |
| P0-011 | Supabase auth | IMPLEMENTED / BACKEND ACTIVE | P0 | SSR auth/guards/routes; deployed env + live login/session E2E missing |
| P0-012 | Workspace/project persistence | IMPLEMENTED / LIVE SCHEMA | P0 | schema/actions/UI live-capable; authenticated create/list E2E missing |
| P0-013 | Owner-only RLS | LIVE / ACL HARDENED / ADVERSE PROOF PENDING | P0 | RLS enabled; authenticated table privileges reduced to exact CRUD/SELECT surface; cross-user/direct-API evidence still missing |
| P0-014 | Privileged write RPC boundary | LIVE / REVIEWED / ACL VERIFIED | P0 | anon EXECUTE false, authenticated EXECUTE true on exactly three canonical write RPCs; three intentional SECURITY DEFINER advisor WARNs remain; adversarial identity proof pending |
| P0-015 | Security headers | E2E VERIFIED public scope | P0 | authenticated route proof later |
| P0-016 | App auth rate limiter | UNIT VERIFIED/LIMITED | P1 | per-process only; edge/Supabase limits required |
| P0-017 | CI quality gates | E2E VERIFIED baseline | P0 | lint/typecheck/unit/build/bundle/Chromium |
| P0-018 | Netlify deploy workflow | IMPLEMENTED | P1 | verify actual deployment, not only gated job success |
| P0-019 | Public local demo | E2E VERIFIED demo scope | P2 | never counts as server evidence |
| P0-020 | Legacy prototype | IMPLEMENTED/LEGACY | P2 | removal/archive criterion needed |
| P0-021 | AI Architect | UNIT VERIFIED | P2 | live inference intentionally disabled |
| P0-022 | Lekta boundary | UNIT VERIFIED contract only | P2 | real API/persistence absent |
| P0-023 | SharePackage/collaboration domain | UNIT VERIFIED | P1 | real persistence/RLS/UI absent |
| P0-024 | Revision request/review domain | UNIT VERIFIED | P1 | real persistence/E2E absent |
| P0-025 | Mentor collaboration demo | E2E VERIFIED demo only | P1 | production mentor access absent |
| P0-026 | Production mentor backend | DESIGNED | P0 after Gate 1 | F2 invariants exist; schema/RLS/routes/E2E absent |
| P0-027 | Submission/final freeze | DESIGNED | P1 | implementation absent |
| P0-028 | Forensic Writing Ledger | IN PROGRESS OFF MAIN | P1 | draft PR #28 |
| P0-029 | Multi-session gap-aware replay | IN PROGRESS OFF MAIN | P1 | draft PR #31 |
| P0-030 | Academic Graph/Mentor Coverage/Delta | IN PROGRESS OFF MAIN | P2 | draft PR #27; currently non-mergeable |
| P0-031 | Protected Facts | PARTIAL/STACKED | P2 | contract/demo work; real Lekta backend absent |
| P0-032 | Multi-tenant institution model | DESIGNED ONLY | P3 | intentionally post-pilot |
| P0-033 | Production monitoring/alerting | NOT STARTED / insufficient evidence | P0 pre-pilot | implementation + alert drills needed |
| P0-034 | Verified DB backup/restore | NOT STARTED / insufficient evidence | P0 pre-pilot | define RPO/RTO + restore drill |
| P0-035 | Privacy/retention/deletion | DESIGNED/INCOMPLETE | P0 pre-pilot | data inventory + workflows + institutional review |
| P0-036 | Load/concurrency evidence | PARTIAL | P1 | local perf tripwires; live DB load missing |
| P0-037 | Cross-browser coverage | PARTIAL | P1 | CI currently Chromium |
| P0-038 | Accessibility | E2E PARTIAL | P1 | authenticated editor/mentor surfaces missing |
| P0-039 | Production AI endpoint | DISABLED BY DESIGN | P2 | identity/quota/distributed abuse controls first |
| P0-040 | Production source/citation retrieval | NOT STARTED/deferred | P2 | explicitly deferred |
| P0-041 | Property/runtime correctness harness | NOT STARTED | P0 after live vertical slice | fast-check + Zod |
| P0-042 | Mutation testing | NOT STARTED | P1 | Stryker critical-domain scope |
| P0-043 | Architecture/dead-code gates | NOT STARTED | P1 | dependency-cruiser + Knip |
| P0-044 | Dependency automation | NOT STARTED | P1 | Renovate with normal CI/review |
| P0-045 | Formal lifecycle model | NOT STARTED / SPIKE | P2 | Alloy model for revision/share/mentor/evidence; not Gate 1 blocker |

## Key findings

### F0-1 — Backend is live; product evidence still does not close Gate 1
Supabase SSR plumbing, workspace/project schema, owner-only RLS, canonical document/revision store, CAS RPC, idempotency and checkpoint contracts exist and the target database is ACTIVE_HEALTHY. What is still missing is a named deployed/test application environment carrying the public Supabase configuration plus authenticated browser/system evidence over those live boundaries.

### F0-2 — Demo evidence is not production evidence
/demo proves browser-side editor/local-journal behavior. It does not prove auth, server sync, CAS, RLS, checkpoints or production mentor permissions.

### F0-3 — Mentor domain logic is ahead of the production mentor product
SharePackage, revision-request, review and attention logic exist and have tests/demo coverage. F2 says production UI/server persistence is still future work.

### F0-4 — Forensic work is branch topology, not baseline capability
PR #28 (forensic ledger), PR #31 (multi-session history) and PR #27 (Academic Graph/Mentor Coverage) are draft/stacked work. Audit them on their exact heads before reconciliation.

### F0-5 — CI is strong but not yet a correctness proof
Current CI covers lint, typecheck, unit tests, AI tests, production build, bundle budget and Chromium Playwright. Authenticated live-backend E2E remains the major missing product evidence. Property/state-machine testing, mutation testing, architecture-boundary enforcement, dead-code analysis and the planned security toolchain remain additional quality work rather than implied by a green baseline CI.

## Immediate Gate 1 backlog

| ID | Task | Status | Dependency | Definition of Done |
|---|---|---|---|---|
| G1-BE-001 | Re-check dedicated Pisač Supabase project state | DONE | account access | ACTIVE_HEALTHY recorded |
| G1-BE-002 | Review current Supabase changelog/docs | DONE | 001 | current 2026 changes reviewed |
| G1-BE-003 | Security review workspace migration | DONE | 002 | grants/RLS reviewed + hardened |
| G1-BE-004 | Security review document/CAS migration | DONE | 002 | CAS/idempotency/definer reviewed + hardened |
| G1-BE-005 | Security review checkpoint migration | DONE | 002 | ownership/immutability reviewed + hardened |
| G1-BE-006 | Activate/restore backend environment | DONE | 001 | project ACTIVE_HEALTHY |
| G1-BE-007 | Reconcile/apply F1 migration state | DONE | 003–006 | original live history preserved; forward-only hardening applied |
| G1-BE-008 | Run Supabase advisors | DONE | 007 | only intentional definer WARN + unused-index INFO remain |
| G1-BE-009 | Configure deployed app Supabase public env | TODO / OWNER-DEPLOY | 006 | URL + publishable key + site URL present; no secret exposure |
| G1-BE-010 | Configure auth redirect allowlist and verify login/callback/session | TODO / OWNER-AUTH | 009 | authenticated browser flow passes |
| G1-BE-011 | Verify workspace create/list | TODO | 010 | live DB E2E passes |
| G1-BE-012 | Verify document bootstrap/load | TODO | 011 | server canonical document opens |
| G1-BE-013 | Verify local→server sync ACK | TODO | 012 | LOCAL_DURABLE→SYNCED demonstrated |
| G1-BE-014 | Cross-user/anonymous/direct-write denial | TODO | 010–013 | adverse authorization matrix passes |
| G1-BE-015 | Idempotency/reused tx/stale-base conflict | TODO | 013 | no duplicate or silent overwrite |
| G1-BE-016 | Rebase/discard/checkpoint/offline/recovery/multi-client E2E | TODO | 015 | failure matrix evidenced |
| G1-BE-017 | Upgrade F1 evidence register | TODO | 010–016 | PASS only with exact SHA/env/artifacts |

## Post-vertical-slice correctness backlog

| ID | Task | Priority | Gate |
|---|---|---|---|
| Q-COR-001 | fast-check property/state-machine invariants | P0 | immediately after authenticated vertical slice |
| Q-COR-002 | Zod persistence/API runtime schemas | P0 | same |
| Q-COR-003 | Stryker critical-domain mutation tests | P1 | after property baseline |
| Q-ARCH-001 | dependency-cruiser import/layer rules | P1 | after vertical slice |
| Q-DEAD-001 | Knip unused code/dependency gate | P1 | after architecture rules |
| Q-DEP-001 | Renovate controlled dependency/action updates | P1 | after CI gates stable |
| Q-SEC-001 | Gitleaks + OSV + zizmor + Semgrep + Harden-Runner | P0/P1 | Gate 1 hardening / Gate 4 expansion |
| Q-FORMAL-001 | Alloy Revision/Share/Mentor/Evidence model | P2 spike | after deterministic harness; never a Gate 1 blocker |

## Evidence/Mentor backlog seeds

| ID | Task | State | Dependency |
|---|---|---|---|
| G2-EV-001 | Audit PR #28 event taxonomy | TODO | Gate 1 stable |
| G2-EV-002 | Audit canonical serialization/hash implementation | TODO | EV-001 |
| G2-EV-003 | Define server anchoring for process segments | TODO | EV-002 |
| G2-EV-004 | Audit PR #31 session/gap semantics | TODO | EV-001 |
| G2-EV-005 | Prove replay never crosses gaps | TODO | EV-004 |
| G2-EV-006 | Define privacy/minimization for exact event payloads | TODO | EV-001 |
| G3-MN-001 | Reconcile overlapping SharePackage models | TODO | Gate 1 |
| G3-MN-002 | Mentor relationship persistence schema | TODO | MN-001 |
| G3-MN-003 | Exact-revision share persistence | TODO | MN-002 |
| G3-MN-004 | Operation-level authorization matrix | TODO | MN-002 |
| G3-MN-005 | Production mentor routes/UI | TODO | MN-003/004 |
| G3-MN-006 | E2E revocation semantics | TODO | MN-005 |
| G3-MN-007 | Persist revision requests/comments | TODO | MN-003 |
| G3-MN-008 | Mentor Process View over verified evidence | TODO | Gate 2 + mentor persistence |
| G3-MN-009 | Submission/freeze model | TODO | mentor workflow stable |
| G3-MN-010 | Full student→mentor→student→submit E2E | TODO | MN-005..009 |

## Phase 0 next audit work

1. Expand this inventory into the complete 80–120 task backlog.
2. Audit exact open-PR dependency graph and identify obsolete/superseded stacked PRs.
3. Audit migration 1904–1906 against current Supabase guidance before activation.
4. Inspect deployment evidence and determine whether current Netlify job actually deploys or only passes its token gate.
5. Establish pilot operational backlog: monitoring, backup/restore, incident response, privacy/retention, cross-browser and load testing.

This document is intentionally conservative: a capability is never promoted merely because a PR description claims it works.


# E. Complete master backlog

Phase 0 expanded the roadmap into an executable queue. Existing capabilities remain separately tracked above; tasks below are verification/implementation units.

## Phase 0 — repository/governance
P0-AUD-001 inventory; 002 evidence separation; 003 PR topology; 004 obsolete-stack reconciliation; 005 PR19 CI; 006 PR20 CI; 007 PR27 reconciliation; 008 PR28 audit; 009 PR31 audit; 010 consolidation order; 011 duplicate-domain inventory; 012 legacy retirement; 013 deploy reality; 014 SHA-bound readiness; 015 evidence promotion rule.

## Phase 1 — backend/auth (20)
G1-BE-001 project state; 002 current Supabase guidance; 003 migration1904 review; 004 migration1905 review; 005 migration1906 review; 006 activate backend; 007 apply migrations; 008 advisors; 009 deploy env; 010 auth E2E; 011 workspace E2E; 012 document bootstrap; 013 sync ACK; 014 cross-user deny; 015 direct-write deny; 016 idempotency; 017 tx-key misuse; 018 stale-base conflict; 019 rebase/discard; 020 checkpoints.

## Phase 2 — student lifecycle (10)
G1-ST-001 first login; 002 project validation; 003 logout/login continuity; 004 expired session; 005 invalid IDs; 006 unauthorized deep link; 007 multiple projects; 008 archive/delete policy; 009 backend outage UI; 010 authenticated accessibility.

## Phase 3 — durability/sync (10)
G1-SY-001 offline/reconnect; 002 refresh pending; 003 crash recovery; 004 multi-tab; 005 multi-device; 006 timeout/backoff; 007 server 5xx; 008 truthful durability UI; 009 large-doc boundary; 010 evidence PASS upgrades.

## Phase 4 — version/recovery/export (8)
G1-VR-001 revision history; 002 checkpoint E2E; 003 salvage-local; 004 adopt-server; 005 local DB corruption; 006 DOCX browser export; 007 artifact fidelity; 008 import/roundtrip scope.

## Phase 5 — forensic ledger (8)
G2-FL-001 PR28 taxonomy; 002 payload privacy; 003 sequence/revision invariants; 004 editor capture; 005 durable process segments; 006 AI-event semantics; 007 retention/deletion; 008 browser regression.

## Phase 6 — integrity (7)
G2-IN-001 canonical serialization; 002 WebCrypto SHA-256; 003 hash-chain tamper detection; 004 segment/session roots; 005 server anchoring; 006 adversarial tamper suite; 007 evidentiary limitations.

## Phase 7 — replay (7)
G2-RP-001 PR31 audit; 002 ordered segments; 003 gap states; 004 no interpolation; 005 evidence-derived rhythm; 006 event-to-session navigation; 007 process-history E2E.

## Phase 8 — mentor authorization (8)
G3-AU-001 SharePackage reconciliation; 002 MentorRelationship persistence; 003 exact-revision persistence; 004 operation matrix; 005 RLS/RPC mentor policy; 006 revoke backend; 007 cross-mentor isolation; 008 private revision invisibility.

## Phase 9 — Mentor Process View (5)
G3-MV-001 production mentor route; 002 timeline/session/gap; 003 verified-segment replay; 004 review delta/coverage; 005 mentor privacy/a11y E2E.

## Phase 10 — end-to-end review workflow (5)
G3-WF-001 persisted comments/revision requests; 002 student response; 003 re-review delta; 004 submission freeze; 005 full student→mentor→student→submit E2E.

## Phase 11 — production hardening (7)
G4-OP-001 monitoring; 002 alert drill; 003 RPO/RTO + backup/restore drill; 004 load/concurrency; 005 cross-browser; 006 dependency/security gate; 007 incident simulation.

## Phase 12 — privacy/pilot (5)
G4-PV-001 data inventory; 002 retention/deletion/export; 003 legal-basis/privacy/DPIA assessment; 004 synthetic/internal pilot; 005 limited FPZG pilot gate.

This produces **103 executable task IDs**, in addition to the 40 capability records above.

# F. Open PR topology

Observed 2026-10-01:
- PR #19: feat/f3-protected-facts → feat/f3-semantic-diff; draft, mergeable, latest CI failed.
- PR #20: feat/f3-protected-facts-demo → feat/f3-protected-facts; draft, mergeable, latest CI failed.
- PR #25: audit/pisac-2-consolidation → feat/f4-research-memory; draft, mergeable, green CI.
- PR #27: feat/f5-academic-graph → main; draft, currently non-mergeable, green CI on head.
- PR #28: feat/f5-forensic-ledger → feat/f5-writing-provenance; draft, mergeable, green CI.
- PR #31: feat/f5-multisession-history → feat/f5-persistent-process-ledger; draft, mergeable, green CI.

Intermediate F2/F3/F4/F5 branches also exist. Do not merge these PRs independently until a consolidation map identifies already-main, superseded and still-needed commits.

# G. Phase 0 completion

- [x] master plan
- [x] baseline capability inventory
- [x] 100+ executable task roadmap
- [x] open PR topology
- [ ] exact consolidation order
- [ ] red PR CI causes classified
- [ ] migrations reviewed against current Supabase guidance
- [ ] deployment reality verified
- [ ] pilot operations/privacy acceptance criteria finalized

Do not apply production migrations until the remaining Phase 0 safety checks are complete.


# H. Phase 0 closing findings — 2026-10-01

## H1 — Red PR CI classification

PR #19 and PR #20 both fail at TypeScript typecheck, not in Protected Facts/Lekta behavior. The exact repeated error is in `src/domain/attention/project.test.ts`: `SharePackage` is inferred against `never` in the test helper. This is the same defect later documented/fixed by consolidation PR #25. Therefore #19/#20 should not receive isolated feature fixes; their surviving content should be reconciled through the green consolidation lineage.

## H2 — Safe stack consolidation order

Do not merge current open PRs in numerical order.

Recommended reconciliation:
1. Treat current `main` as the canonical F1 + already-consolidated F2/F3/F4 baseline.
2. Use green PR #25 only as an audit/reference to identify any F2–F4 commits not already represented on main; do not blindly merge its historical stack.
3. Mark #19/#20 as superseded candidates after confirming their Protected Facts/Lekta files already exist on main with equivalent/newer content.
4. Rebase/recreate #27 from current main because it is non-mergeable; preserve only Academic Graph/Mentor Coverage/Delta/Readiness changes.
5. Audit the F5 provenance chain in order: `feat/f5-writing-provenance` → PR #28 forensic ledger → live-editor capture → persistent-process-ledger → PR #31 multi-session history.
6. Rebuild that F5 sequence onto current main as bounded PRs rather than merging the historical stacked ancestry wholesale.
7. Require green lint/typecheck/unit/E2E at every reconstructed boundary.

This minimizes duplicate domain models and prevents old stack failures from being reintroduced.

## H3 — Supabase project reality

Connected Supabase project inventory confirms:
- Pisač ref `cxwxxcwrgushfkisfpxz`, eu-central-1: **INACTIVE**
- Lekta staging: ACTIVE_HEALTHY
- Lekta: ACTIVE_HEALTHY

Therefore G1-BE-001 is DONE and G1-BE-006 remains an explicit activation prerequisite. No migration has been applied by this audit.

## H4 — Current Supabase security review

Current Supabase guidance confirms:
- exposed tables need explicit grants + RLS;
- functions receive EXECUTE privileges unless restricted;
- `security definer` requires a pinned/empty `search_path`;
- current guidance says a security-definer function in an exposed schema is callable over the Data API with creator privileges and recommends placing privileged helpers in a non-exposed schema where possible.

The prepared F1 migrations already do several things correctly: RLS is explicitly enabled, anonymous table access is revoked, direct authenticated writes are revoked for canonical document/revision tables, privileged functions explicitly check `auth.uid()`, `search_path=''` is used, relation names are schema-qualified, PUBLIC/anon execute is revoked, and authenticated execute is granted narrowly.

**Pre-activation change required:** review moving `pisac_ensure_document`, `pisac_commit_document` and checkpoint privileged RPC implementation into a non-exposed schema, or document/test why an exposed-schema RPC is intentionally required. If an exposed wrapper is needed for PostgREST RPC, use the smallest invoker/exposed surface possible and keep privileged implementation private. Also review `(select auth.uid())` policy form/indexing for scale and run advisors after migration.

G1-BE-002 is DONE as a documentation review. G1-BE-003..005 remain open until SQL is patched/re-reviewed.

## H5 — Netlify deployment reality

Run 36861506779 on main was green only because the token gate succeeded. Checkout, setup-node, install and **Build and deploy were all skipped**. The current repository therefore does not have evidence that GitHub Actions deployed commit `eab8b517...` to Netlify.

P0-AUD-013 is classified: **BLOCKED — NETLIFY_AUTH_TOKEN absent from GitHub Actions environment**. A green gated job must not be represented as a successful deployment.

## H6 — Pilot operational/privacy acceptance criteria

Before FPZG pilot:
- monitoring must capture actionable server/auth/sync failures without logging document content unnecessarily;
- alerts must have an owner and a tested trigger path;
- backup policy must state RPO/RTO and pass a restore drill;
- authorization must pass owner/cross-user/cross-mentor/direct-API adversarial tests;
- event collection must have a field-level data inventory and minimization rationale;
- retention/deletion/export rules must cover document content, revisions, forensic events, comments and audit metadata;
- exact-writing-event retention must be separately justified from ordinary document retention;
- user-facing claims must distinguish integrity/process evidence from authorship judgment;
- privacy/legal-basis/DPIA need assessment must be reviewed with appropriate FPZG privacy/institutional roles before real-student collection;
- a synthetic-data internal pilot must precede real-student pilot;
- pilot rollback/incident/contact procedure must exist.

## H7 — Phase 0 gate

Completed:
- [x] master plan
- [x] baseline capability inventory
- [x] 100+ executable task roadmap
- [x] open PR topology
- [x] exact consolidation order
- [x] red PR CI causes classified
- [x] current Supabase guidance reviewed
- [x] deployment reality verified
- [x] pilot operations/privacy acceptance criteria

**PHASE 0: COMPLETE.**

Next phase: **Phase 1 / Gate 1 backend activation**, beginning with migration hardening before any database write. Restoring the inactive Pisač Supabase project is a state-changing owner action and is not performed as part of this audit.


# I. Phase 1 — migration hardening started

**Date:** 2026-10-01

## I1 — Supabase RPC security conclusion corrected

Current Supabase documentation explicitly demonstrates a supported pattern for an API-callable `public` SECURITY DEFINER function when:
- `search_path` is pinned/empty,
- referenced objects are schema-qualified,
- business authorization is enforced inside the function,
- EXECUTE is revoked from PUBLIC/anon,
- EXECUTE is granted only to the intended role.

The prepared Pisač document/checkpoint RPCs already follow that pattern. Therefore the earlier Phase 0 suggestion that they necessarily move to a non-exposed schema is withdrawn. Moving them would add wrapper complexity without a demonstrated security gain for this RPC use case.

## I2 — Minimal pre-activation hardening applied

Prepared migrations 2026091904–06 were updated before any database application:
- explicit authenticated Data API table privileges were added instead of relying on default/dashboard grants;
- workspace/project tables explicitly grant the CRUD operations that their RLS policies permit;
- canonical document/revision/checkpoint tables explicitly grant SELECT only;
- direct INSERT/UPDATE/DELETE on canonical server-state tables remains revoked;
- owner RLS predicates use the `(select auth.uid())` form where applicable, matching current Supabase performance guidance;
- anon access remains explicitly revoked;
- privileged RPC execute grants remain authenticated-only.

No migration has been applied to the inactive Pisač project.

## I3 — Verification

On the latest migration-hardening head, GitHub Actions has completed successfully through:
- lint
- TypeScript typecheck
- unit tests
- AI Architect tests

Playwright/build completion is tracked separately by the workflow.

## I4 — Task status

- G1-BE-001 DONE — project confirmed INACTIVE.
- G1-BE-002 DONE — current Supabase guidance reviewed.
- G1-BE-003 REVIEWED/HARDENED — workspace migration.
- G1-BE-004 REVIEWED/HARDENED — document/revision migration.
- G1-BE-005 REVIEWED/HARDENED — checkpoint migration.
- G1-BE-006 BLOCKED/PENDING EXPLICIT ACTION — restore Pisač project.
- G1-BE-007+ remain TODO.

Next state-changing step is restoring the dedicated Pisač Supabase project. It must not be confused with applying migrations; restoration only makes the existing project reachable. Migration application remains a separate reviewed step.


# J. Phase 1 — live backend activation result

**Date:** 2026-10-01

- Lekta staging was paused to free the Free-plan active-project slot.
- Production Lekta was not changed.
- Pisač project `cxwxxcwrgushfkisfpxz` restored successfully and reached ACTIVE_HEALTHY.
- Read-only inventory found the original F1 backend had already been applied as six migrations; all five F1 public tables existed with RLS enabled and 0 rows.
- The reviewed 1904–1906 files were therefore **not replayed**.
- A forward-only repository migration `2026100101_f1_live_hardening.sql` was created and applied as Supabase migration `f1_live_hardening`.
- Live migration history now contains seven migrations.

Post-migration advisors:
- Security: only three intentional `authenticated_security_definer_function_executable` WARN findings for `pisac_ensure_document`, `pisac_commit_document`, and `pisac_create_checkpoint`. These RPCs are intentionally callable by authenticated users and enforce authorization internally; PUBLIC/anon EXECUTE remains revoked.
- Performance: prior 11 `auth_rls_initplan` warnings are cleared.
- Performance: prior two unindexed foreign-key findings are cleared.
- Remaining performance findings are only unused-index INFO entries on an empty database; do not remove these indexes based on zero-row usage.

Task status:
- G1-BE-006 DONE — backend active and healthy.
- G1-BE-007 DONE — existing F1 migration history preserved; forward-only hardening applied.
- G1-BE-008 DONE — security/performance advisors run and triaged.
- G1-BE-009 TODO — deployed application Supabase environment.
- G1-BE-010+ TODO — authenticated browser/system verification.

No synthetic or real student rows were inserted during this step.


# K. 2026-10-02 execution reconciliation

- Live project rechecked through the Supabase connection: `cxwxxcwrgushfkisfpxz` is ACTIVE_HEALTHY on Postgres 17.
- Eight live migrations are present; all five F1 public tables have RLS enabled and remain empty before synthetic auth verification.
- Security advisors currently report only the three intentional authenticated-callable SECURITY DEFINER RPC warnings.
- Performance advisors currently report five unused-index INFO findings on the empty database; those indexes are not removed based on zero-row statistics.
- Current Supabase guidance prefers `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the code migration uses it first with a temporary legacy anon fallback.
- `gate1_least_privilege` removed authenticated TRUNCATE/REFERENCES/TRIGGER/MAINTAIN from all five F1 tables while preserving workspace/project CRUD, canonical-state SELECT, anon denial and authenticated-only RPC EXECUTE.
- The next product proof is deploy configuration + authenticated synthetic E2E. Do not repeat restore/apply-old-migrations work.
- The quality/research expansion is now bounded: dependency-cruiser, Knip, Renovate and one Alloy spike are accepted additions; broad tool discovery stops unless a concrete failure/gap requires it.


# L. 2026-10-02 least-privilege closure

- PR #38 merged as `bfd93ba8fd4a55104ab73b693c6164a3be564926`.
- Supabase migration `gate1_least_privilege` applied successfully; live migration history now has eight entries.
- Live ACL verification confirms exact application privileges:
  - workspace/project: authenticated CRUD only;
  - canonical documents/revisions/checkpoints: authenticated SELECT only;
  - no authenticated TRUNCATE/REFERENCES/TRIGGER/MAINTAIN;
  - anon table access remains denied.
- Canonical RPC contract is unchanged: anon EXECUTE=false, authenticated EXECUTE=true on the three reviewed SECURITY DEFINER write paths.
- Advisors rerun after apply: only the same three intentional definer WARNs and five unused-index INFO findings remain.
- Issue #37 is closed.
- Windows local test-harness drift is tracked separately in #39; vulnerable Next→PostCSS dependency is tracked in #40.
