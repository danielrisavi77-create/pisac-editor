# Pisač — Technical Readiness Audit

**Phase:** 0 — Repository Baseline Audit  
**Started:** 2026-10-01  
**Baseline:** main after eab8b517150a79555defe0445cfe15c7227749ae  
**Rule:** code existence is not equivalent to verified production behavior.

## Executive status

Pisač is not a frontend-only prototype. Main already contains a substantial F1 authoring kernel: Next.js, Tiptap canonical editor, Dexie local journal, explicit sync state machine, server-sync contracts, prepared Supabase/Postgres migrations with RLS and privileged RPC boundaries, conflict/recovery logic, checkpoints, DOCX export, CI and Playwright coverage.

The principal Gate 1 blocker is backend activation and live verification. Repository evidence says the dedicated Pisač Supabase project is paused/unconfigured, migrations 2026091904–06 are PREPARED ONLY, and authenticated server-backed E2E legs remain BLOCKED.

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
| P0-006 | Server CAS/revision store | UNIT VERIFIED/BLOCKED | P0 | migration/RPC/tests; migration not live |
| P0-007 | Conflict resolution | UNIT VERIFIED | P0 | rebase/discard tests; multi-client E2E missing |
| P0-008 | Recovery | UNIT VERIFIED | P0 | recovery tests; live server recovery missing |
| P0-009 | Named checkpoints | UNIT VERIFIED/BLOCKED | P0 | migration/contracts; migration not live |
| P0-010 | DOCX export | UNIT VERIFIED | P1 | F1 serializer/fidelity tests; browser export E2E missing |
| P0-011 | Supabase auth | IMPLEMENTED/BLOCKED | P0 | SSR auth/guards/routes; project live E2E missing |
| P0-012 | Workspace/project persistence | IMPLEMENTED/BLOCKED | P0 | migration/actions/UI; live create/list missing |
| P0-013 | Owner-only RLS | UNIT VERIFIED/BLOCKED | P0 | migration tests; live adversarial proof missing |
| P0-014 | Privileged write RPC boundary | UNIT VERIFIED/BLOCKED | P0 | auth.uid/grants/revokes/search_path; live proof/advisors missing |
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

## Key findings

### F0-1 — Backend code exists; backend evidence does not close Gate 1
Supabase SSR plumbing, workspace/project schema, owner-only RLS, canonical document/revision store, CAS RPC, idempotency and checkpoint contracts exist. They are not live-verified because the target backend is currently documented as paused/unconfigured.

### F0-2 — Demo evidence is not production evidence
/demo proves browser-side editor/local-journal behavior. It does not prove auth, server sync, CAS, RLS, checkpoints or production mentor permissions.

### F0-3 — Mentor domain logic is ahead of the production mentor product
SharePackage, revision-request, review and attention logic exist and have tests/demo coverage. F2 says production UI/server persistence is still future work.

### F0-4 — Forensic work is branch topology, not baseline capability
PR #28 (forensic ledger), PR #31 (multi-session history) and PR #27 (Academic Graph/Mentor Coverage) are draft/stacked work. Audit them on their exact heads before reconciliation.

### F0-5 — CI is strong for the unconfigured baseline
Current CI covers lint, typecheck, unit tests, AI tests, production build, bundle budget and Chromium Playwright. Authenticated live-backend E2E remains the major missing evidence.

## Immediate Gate 1 backlog

| ID | Task | Status | Dependency | Definition of Done |
|---|---|---|---|---|
| G1-BE-001 | Re-check dedicated Pisač Supabase project state | TODO | account access | status/config recorded without secrets |
| G1-BE-002 | Review current Supabase changelog/docs against prepared migrations | TODO | 001 | relevant breaking changes checked |
| G1-BE-003 | Security review workspace migration 1904 | TODO | 002 | RLS/grants/functions reviewed |
| G1-BE-004 | Security review document migration 1905 | TODO | 002 | CAS/idempotency/RLS/definer reviewed |
| G1-BE-005 | Security review checkpoint migration 1906 | TODO | 002 | ownership/immutability reviewed |
| G1-BE-006 | Activate/restore backend environment | BLOCKED/OWNER if paused | 001 | project active/reachable |
| G1-BE-007 | Apply approved F1 migrations | TODO | 003–006 | schema/history verified |
| G1-BE-008 | Run Supabase advisors | TODO | 007 | findings triaged/resolved |
| G1-BE-009 | Configure deployed app Supabase env | TODO | 006 | auth can start; no secret exposure |
| G1-BE-010 | Verify login/callback/session | TODO | 009 | authenticated browser flow passes |
| G1-BE-011 | Verify workspace create/list | TODO | 010 | live DB E2E passes |
| G1-BE-012 | Verify document bootstrap/load | TODO | 011 | server canonical document opens |
| G1-BE-013 | Verify local→server sync ACK | TODO | 012 | LOCAL_DURABLE→SYNCED demonstrated |
| G1-BE-014 | Cross-user read denial | TODO | 012 + second identity | Student B cannot read A |
| G1-BE-015 | Direct-write bypass denial | TODO | 007 | table mutation cannot bypass RPC/CAS |
| G1-BE-016 | Idempotent replay | TODO | 013 | no duplicate revision |
| G1-BE-017 | Reused tx key rejection | TODO | 013 | txid_reused demonstrated |
| G1-BE-018 | Concurrent stale-base conflict | TODO | 013 | no silent overwrite |
| G1-BE-019 | Rebase/discard E2E | TODO | 018 | both paths verified; conflict retained |
| G1-BE-020 | Server checkpoints | TODO | 012 | snapshot comes from server truth |
| G1-BE-021 | Authenticated offline/reconnect | TODO | 013 | safe delayed sync |
| G1-BE-022 | Refresh/crash recovery | TODO | 013 | recoverable work survives |
| G1-BE-023 | Multi-tab scenario | TODO | 013 | matches locking/conflict contract |
| G1-BE-024 | Multi-device conflict | TODO | 018 | deterministic behavior verified |
| G1-BE-025 | Upgrade F1 evidence register | TODO | 010–024 | PASS only with SHA/env/artifact evidence |

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
