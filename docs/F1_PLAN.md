# F1 Governance Plan

Maps the F1 Authoring Kernel PR roadmap to concrete steps, defines the sync
state machine, and registers the F1 fixture IDs. Source: dossier §6, §7,
§23, §27, §30. Definitions only — no implementation claims.

## 1. Scope and non-goals

- F1 editor: Tiptap/ProseMirror only; stable structural node id = opaque UUID.
- F1 schema: paragraph, headings 1–3, text, bold/italic — nothing wider.
- Deferred to a later phase (dossier §30, "Do not build yet"): AI tutor.
- Deferred: production AI Router (frozen, tests kept green only).
- Deferred: RAG, vector infrastructure, policy runtime, citation engine.
- Deferred: full DOCX import (F1 ships DOCX export only), PDF/A.
- Deferred: realtime multiplayer, CRDT (dossier §8 is out of scope for F1).
- No drive-by refactors; one bounded step per commit per `docs/F1_STATE.md`.

## 2. The 7 F1 PRs → steps

| F1 PR | Steps (`docs/F1_STATE.md`) | Status | Key files/dirs expected |
|---|---|---|---|
| 1. tooling/governance | F1-0a, F1-0b | DONE / IN_PROGRESS | `next.config.ts`, CI config, `docs/F1_PLAN.md` |
| 2. auth/workspace | F1-1a, F1-1b | TODO | `src/lib/supabase/{client,server}.ts`, `supabase/migrations/<next>_f1_workspace.sql`, `app/(workspace)/` |
| 3. canonical document/editor | F1-2a, F1-2b | TODO | `src/domain/document/*`, `app/(workspace)/d/[id]/page.tsx` |
| 4. local durability/server sync | F1-3a, F1-3b, F1-4a, F1-4b | TODO | Dexie journal module, sync status chip, `documents`/`document_revisions` migration, server action |
| 5. recovery/conflict/checkpoints | F1-5a, F1-5b | TODO | conflict/rebase/discard logic, checkpoint snapshot module |
| 6. DOCX | F1-6 | TODO | `docx` export module, export manifest with fidelity labels |
| 7. fixtures/browser E2E | F1-7 | TODO | `e2e/*.spec.ts`, fixture evidence records |

## 3. Sync state machine

8 user-visible states (dossier §7). Flow:
`editor intent → canonical candidate → atomic IndexedDB transaction →
LOCAL_DURABLE → editor projection → pending queue → server CAS →
canonical revision → ACK → SYNCED`.

| State | Croatian UI label | Entered when | Leaves via |
|---|---|---|---|
| EDITING | Uređivanje | User changes the document; a new canonical candidate is produced | Candidate is queued for an atomic local transaction → SAVING_LOCAL |
| SAVING_LOCAL | Spremam lokalno | Atomic IndexedDB transaction (snapshot + pending tx + local sequence + sync state) is in flight | Transaction commits → LOCAL_DURABLE; transaction fails → ERROR |
| LOCAL_DURABLE | Spremljeno lokalno | Local transaction committed durably | Entry pushed onto pending queue for server sync → SYNCING |
| SYNCING | Sinkroniziram | Pending queue item sent to server CAS with idempotency key | Server ACKs on matching base revision → SYNCED; stale base → CONFLICT; transport/server failure → ERROR |
| SYNCED | Sinkronizirano | Server ACK received; local state now matches canonical server revision | New editor intent → EDITING |
| CONFLICT | Sukob | Server rejects CAS because local base revision is stale | Explicit rebase → SYNCING (resubmit); explicit discard → LOCAL_DURABLE (drop local change); original conflict stays recorded in either case |
| ERROR | Greška | Local transaction fails, or sync transport/server error occurs | Retry with backoff → SAVING_LOCAL or SYNCING; unrecoverable local storage failure → RECOVERY_REQUIRED |
| RECOVERY_REQUIRED | Potreban oporavak | IndexedDB corrupt or unavailable | Recovery flow restores from checkpoint (server + local named immutable snapshot) → EDITING |

Never a generic "Saved" label — one of the 8 states above only.

Invariants (dossier §7, verbatim-ish):
- Atomic local transaction must save together: snapshot, pending transaction,
  local sequence, sync state.
- Idempotency key: `(document_id, actor_id, client_transaction_id)`.
- Conflict rules: no silent last-write-wins; explicit rebase; explicit
  discard; the original conflict stays recorded.

## 4. F1 fixture register

Definition ≠ PASS. Evidence must bind fixture → executable test → exact SHA
→ environment → result → artifact.

| Fixture ID | Intended area | Owner test file (planned) | Status |
|---|---|---|---|
| FX-FR-001-001 | Project basics (assumed) | `src/domain/project/project.test.ts` | DEFINED — NOT PASS |
| FX-FR-002-001 | Document basics (assumed) | `src/domain/document/document.test.ts` | DEFINED — NOT PASS |
| FX-FR-004-001 | Project/document basics (assumed) | `src/domain/document/document.test.ts` | DEFINED — NOT PASS |
| FX-FR-020-001 | Save/local durability (assumed) | `src/domain/sync/reducer.test.ts` | DEFINED — NOT PASS |
| FX-FR-021-001 | Save/sync (assumed) | `src/domain/sync/reducer.test.ts` | DEFINED — NOT PASS |
| FX-FR-022-001 | Sync (assumed) | `src/lib/sync/server-sync.test.ts` | DEFINED — NOT PASS |
| FX-FR-023-001 | Conflict (assumed) | `src/domain/sync/conflict.test.ts` | DEFINED — NOT PASS |
| FX-FR-024-001 | Recovery (assumed) | `src/domain/sync/recovery.test.ts` | DEFINED — NOT PASS |
| FX-FR-025-001 | Checkpoint (assumed) | `src/domain/sync/checkpoint.test.ts` | DEFINED — NOT PASS |
| FX-FR-075-001 | DOCX export | `src/lib/export/docx.test.ts` | DEFINED — NOT PASS |
| FX-X-A11Y-001 | Accessibility | `e2e/f1-a11y.spec.ts` | DEFINED — NOT PASS |
| FX-X-REL-001 | Reliability | `e2e/f1-reliability.spec.ts` | DEFINED — NOT PASS |
| FX-X-CLIENT-001 | Offline/client (assumed) | `e2e/f1-offline.spec.ts` | DEFINED — NOT PASS |
| FX-X-DG-001 | Data governance (assumed) | `e2e/f1-data-governance.spec.ts` | DEFINED — NOT PASS |
| FX-X-SEC-001 | Security | `e2e/f1-security.spec.ts` | DEFINED — NOT PASS |

## 5. Constitution invariants enforced in F1

- Identity ≠ authorship.
- Evidence ≠ judgment.
- No "AI %" or misconduct score.
- No keylogger (no per-keystroke logging).
- Local durable state ≠ canonical server state.
- Never a generic "Saved" label (use the 8 sync states).
- No silent last-write-wins on conflict.
- Restore always creates a new canonical transition; never deletes later history.

## 6. Migration numbering note

Next migration file uses the pattern `supabase/migrations/2026MMDDNN_<name>.sql`;
existing ones are `2026091901_ai_router_v1.sql` (legacy, untouched) and
`2026091903_ai_architect_v03.sql` (prepared, not applied); F1 migrations
start at `2026091904`.
