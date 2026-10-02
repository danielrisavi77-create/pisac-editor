# Pisač — Master Technical Plan

**Status:** canonical development and audit roadmap  
**Created:** 2026-10-01  
**Scope:** from current repository state to controlled FPZG pilot, with later Croatia/global scaling separated from pilot scope.

## Goal

Pisač is not considered complete merely because UI or code exists. The target is an evidence-backed system in which:

> student can safely write → Pisač reliably preserves the writing process → an authorized mentor can inspect permitted evidence → the system survives expected failures → the product is ready for a controlled FPZG pilot.

## Readiness states

Every capability is tracked with one of these states:

`NOT STARTED → DESIGNED → IMPLEMENTED → UNIT VERIFIED → INTEGRATION VERIFIED → E2E VERIFIED → REVIEWED → DONE`

A capability is **DONE** only when the applicable verification evidence exists.

---

# GATE 0 — Repository baseline

## Phase 0 — Repository Baseline Audit

Establish what actually exists before adding product logic.

Audit:
- repository and architecture inventory
- frontend architecture
- backend architecture
- Supabase migrations
- authentication and authorization
- RLS and privileged RPCs
- editor and canonical document model
- IndexedDB/Dexie durability
- synchronization
- conflicts and recovery
- forensic writing ledger
- mentor functionality
- AI Architect
- Lekta boundaries
- tests and evidence
- CI/CD and deployment
- security controls
- documentation
- open PRs and stacked work
- dead/legacy code
- prototype/demo vs production implementation

**Deliverable:** `docs/TECHNICAL_READINESS.md` with capability status, evidence, blockers, dependencies and prioritized next actions.

---

# GATE 1 — Functional MVP

Goal: a student can genuinely use Pisač to write without unacceptable risk of losing work.

## Phase 1 — Backend activation

**Live reconciliation 2026-10-02:** the dedicated Pisač Supabase project is already `ACTIVE_HEALTHY`; the original F1 schema is live and a forward-only hardening migration has been applied. The current critical path starts at deployed public environment configuration and authenticated browser/system evidence, not at restoring or replaying old migrations.

- activate/configure the dedicated Pisač Supabase project
- verify current Supabase requirements before applying anything
- review and apply approved migrations
- configure public frontend environment variables and server-only secrets
- validate authentication
- validate RLS and RPC authorization
- connect deployed Next.js app to the real backend
- execute authenticated integration/E2E tests
- bind results to exact commit/environment evidence

Minimum adversarial matrix:
- Student A → own document = ALLOW
- Student A → Student B document = DENY
- anonymous user → protected document = DENY
- direct Data API/RPC attempts outside allowed operation = DENY

## Phase 2 — Student account and workspace

Verify the complete lifecycle:

`login → workspace → create project → open document → edit → close → reopen → logout/login → document remains available`

Include:
- expired sessions
- invalid/nonexistent IDs
- unauthorized URLs
- multiple tabs
- multiple devices
- failure states and understandable Croatian UI

## Phase 3 — Editor and durability

Verify:
- editing
- local durable save
- server synchronization
- offline operation
- reconnection
- refresh
- browser/tab crash
- network failure
- backend failure
- retry behavior

UI must never claim a stronger durability state than evidence supports. Preserve explicit states such as `LOCAL_DURABLE`, `SYNCING`, `SYNCED`, `CONFLICT`, `ERROR`, and `RECOVERY_REQUIRED`.

## Phase 4 — Versioning, conflicts and recovery

Verify:
- compare-and-set behavior
- idempotency
- concurrent writers
- immutable revision history
- stale-base detection
- explicit rebase/discard
- checkpoints
- local recovery
- server recovery
- backup/restore

No silent last-write-wins.

**Gate 1 exit criterion:** a student can write a realistic work session and the system can demonstrate preservation/recovery across the defined failure matrix.

---

# GATE 2 — Evidence MVP

Goal: reliably preserve evidence about the writing process without making unsupported authorship or AI-detection claims.

## Phase 5 — Forensic Writing Ledger

Define and implement the event taxonomy needed for process reconstruction, including where appropriate:
- insert
- delete
- replace
- paste
- cut
- undo/redo
- formatting
- structural changes
- citations/sources
- checkpoints
- explicitly permitted AI actions

No OS-level keylogger and no collection outside the Pisač editor.

Each event must be attributable to an explicit document/session/sequence/revision/timestamp/type/payload/integrity context.

## Phase 6 — Integrity and provenance

Build and verify:
- deterministic canonical serialization
- cryptographic event hashing
- previous-hash chaining
- segment/session roots
- server anchoring where required
- tamper verification
- explicit integrity-failure states

A hash/integrity chain proves only the integrity properties it actually establishes; it is not proof of human authorship.

## Phase 7 — Sessions, rhythm and replay

Implement and verify:
- session boundaries
- explicit gaps/interruption states
- writing bursts
- paste/delete metrics
- revision navigation
- deterministic replay
- mapping events to concrete sessions

Never interpolate activity across an evidence gap.

**Gate 2 exit criterion:** recorded evidence can deterministically reconstruct the supported writing-process history and detect defined integrity violations.

---

# GATE 3 — Mentor MVP

Goal: create a real student ↔ mentor workflow protected by backend authorization.

## Phase 8 — Sharing and permissions

Extend owner-only access into explicit operation-level permissions for roles such as:
- Student
- Mentor
- Reviewer
- later: Institution Admin

Backend, not UI, must enforce permissions.

At minimum define and test:
- edit document
- view shared revision
- view permitted process evidence
- comment
- review
- revoke access
- submit/freeze
- export
- access historical versions

## Phase 9 — Mentor Process View

Build the core mentor evidence experience:
- timeline
- sessions
- gaps
- revisions
- replay
- paste events
- rhythm metrics
- checkpoints
- declared AI-assisted events
- comments
- changes since previous review

Integrate relevant existing domain work such as Semantic Diff, Review Delta, Academic Graph and Mentor Coverage only where its contracts are verified.

## Phase 10 — Student ↔ Mentor workflow

Target workflow:

`student writes → student shares → mentor reviews → mentor comments → student revises → mentor sees delta → student submits → final submission freezes`

Verify sharing/revocation and revision-specific review semantics.

**Gate 3 exit criterion:** the complete student/mentor workflow works through real backend permissions and durable data.

---

# GATE 4 — FPZG Pilot Ready

## Phase 11 — Production hardening

Test beyond happy paths:
- RLS/adversarial authorization
- rate limits and abuse controls
- session security
- XSS/CSRF and input boundaries
- dependency/security audit
- database constraints and limits
- backup and verified restore
- disaster recovery
- observability and alerting
- performance/load/concurrency
- accessibility
- supported browsers and mobile layouts
- degraded/offline networks
- backend outage while editing

Failure must degrade honestly and preserve recoverable student work wherever the design promises it.

## Phase 12 — Privacy, governance and pilot

Before real student data:
- data minimization
- retention schedule
- deletion
- data export/access
- legal-basis assessment
- privacy notice
- audit access
- incident procedure
- institutional roles and responsibilities
- appropriate FPZG privacy/DPO review
- controlled pilot protocol

Rollout:
`internal synthetic test → small controlled test → limited FPZG pilot → findings/fixes → expanded pilot`

---

# Cross-cutting verification infrastructure

These are verification layers, not product features. They are added in the order that closes current risk fastest.

## Deterministic correctness

- **fast-check** — property/state-machine tests for append-only ledgers, replay, revision lifecycles, evidence invalidation and mentor projections.
- **Zod** — runtime schemas at persistence/API/import boundaries; compile-time TypeScript types are not treated as runtime validation.
- **StrykerJS** — mutation testing on critical `src/domain/**` and selected `src/lib/**` scopes to test the quality of the tests themselves.

## Architecture and codebase hygiene

- **dependency-cruiser** — CI-enforced import/layer rules. Domain code must stay framework/persistence independent; UI must not bypass application/domain boundaries.
- **Knip** — unused files/exports/dependencies/scripts detection so parallel AI development does not accumulate unreachable implementations.
- **Renovate** — dependency and GitHub Action update PRs with normal CI/review; no blind automerge for security-, persistence- or framework-critical changes.

## Security/supply chain

- Gitleaks for secrets.
- OSV-Scanner for dependency vulnerabilities.
- zizmor for GitHub Actions security.
- Semgrep for general and Pisač-specific static rules.
- Harden-Runner where appropriate for CI runtime visibility.
- SBOM/provenance/signing is a release-hardening concern for Gate 4, not a Gate 1 prerequisite.

## Formal-model spike

After the authenticated vertical slice and deterministic correctness harness exist, build one **small Alloy 6 model** covering:

`Revision ↔ SharePackage ↔ Mentor visibility ↔ Evidence review validity`.

Required assertions include:
- a newer private revision is never visible through an older share;
- a sealed revision is immutable;
- revocation closes future access according to policy;
- revision-specific review/evidence cannot silently migrate to changed content;
- restore/version transitions preserve later history rather than deleting it.

TLA+/Apalache is reserved for sync/concurrency protocols only if ordinary state-machine/property testing leaves a meaningful unresolved concurrency risk. Formal methods must not become an excuse to delay the verified vertical slice.

## Authority rule

AI/Jev/Laya may discover suspicious states, rank review work or generate candidate tests. They do **not** decide correctness. Merge/release authority remains deterministic tests, database authorization checks, exact environment evidence and human/independent review where required.

---

# Development workflow

Do not use:

`AI writes → another AI says looks good → merge`

Use:

`SPEC → TEST → IMPLEMENT → TEST → REVIEW 1 → FIX → REVIEW 2 → E2E → EVIDENCE → DONE`

Implementation/review roles should rotate between Claude and ChatGPT/Codex where useful. For critical security, durability and data-integrity work, the reviewer should actively try to falsify the implementation assumptions.

## Definition of Done template

Example: `AUTH-017 — Mentor cannot access unrelated document`

- [ ] specification
- [ ] implementation
- [ ] unit verification
- [ ] integration verification
- [ ] adversarial verification
- [ ] E2E verification
- [ ] code review
- [ ] evidence bound to commit/environment
- [ ] documentation updated

Only then: **DONE**.

---

# Execution order

`Phase 0 → 1 → 2 → 3 → 4 → GATE 1`

`Phase 5 → 6 → 7 → GATE 2`

`Phase 8 → 9 → 10 → GATE 3`

`Phase 11 → 12 → GATE 4 / FPZG PILOT READY`

Do not build later-scale infrastructure merely because it may eventually be useful. Preserve architectural escape routes, but optimize current implementation for verified pilot requirements.

---

# Later scale — intentionally outside FPZG pilot scope

## GATE 5 — Croatia Scale

Potential later work:
- multi-tenancy
- tenant isolation
- university/faculty administration
- SSO
- institution-specific policies
- billing
- institutional reporting
- LMS/SIS integrations

## GATE 6 — Global Scale

Potential later work:
- internationalization
- regional/data-residency architecture
- jurisdiction-specific governance
- enterprise identity
- global LMS/SIS ecosystem
- regional infrastructure and operations

---

# Phase 0 output format

Phase 0 must turn this roadmap into an evidence-based backlog, approximately 80–120 tasks if warranted by the repository.

Each task should include:
- ID
- gate/phase
- capability
- current status
- priority
- dependency
- repository evidence
- missing evidence
- Definition of Done
- blocker, if any

The audit must distinguish **implemented code** from **verified behavior**, and **demo/prototype behavior** from **production behavior**.
