# F5-D — durable local process ledger

## Scope

This step makes the opt-in transaction capture from F5-C survive reloads locally. It does not add a backend, remote mentor access, identity proof, external timestamps or a human/AI score.

## Storage boundary

Process evidence uses a separate Dexie/IndexedDB database from the canonical document journal. The demo uses `pisac-process-ledger-demo`; document content continues to use its existing journal. Failure of one lifecycle must not be reported as durability of the other.

A segment record contains the captured-process bundle plus `startedAt`, `updatedAt`, status (`active`, `interrupted`, `sealed`) and `previousSessionHead`.

## Checkpoint and append-only rules

`LocalProcessCapture.checkpoint()` waits for a stable serialized hash tail and returns a self-consistent prefix without stopping capture. The UI persists these prefixes. A later checkpoint must extend the exact already-persisted prefix: prior event envelopes, segment identity, start time and parent link cannot be rewritten even if a caller reuses the same event-hash strings. Checkpoint time cannot move backwards.

Only an `active` segment accepts checkpoints. `interrupted` and `sealed` are terminal storage states: an interrupted segment cannot be resumed or sealed later, and a sealed segment cannot be overwritten.

A continuation must reference the head of the latest prior terminal segment. The first segment alone has no parent. A new child is rejected while the latest prior segment is still active, and its start time cannot overlap the terminal parent.

## Reload / interruption semantics

Reload never resumes an old `sessionId` as though nothing happened. Stored bundles are cryptographically self-verified with the actual editor schema. An active segment found after reload is marked `interrupted`. A new opt-in session starts from the document currently loaded by the ordinary document journal and links to the prior segment head.

This link proves only local data-structure continuity. It does not prove that no activity occurred during the gap. The interruption remains visible in the ledger.

Invalid or chain-inconsistent records are surfaced and retained; they are not silently deleted, repaired or bypassed by appending a new continuation.

## Failure behavior

IndexedDB/process-ledger failures do not block ordinary editing or document journalling. The process panel shows that durable forensic evidence is not confirmed. In-memory capture may still operate, but the UI must not describe it as durable.

## Verification targets

Unit coverage includes reload through a fresh DB handle, immutable sealing, terminal interruption, exact continuation links, rejection of continuation from an active/overlapping parent, corrupt-record retention, exact append-only checkpoint-prefix rules and monotonic durable timestamps. Browser coverage separates document `LOCAL_DURABLE` from process-checkpoint durability, then exercises sealed reload and interrupted-session continuation.

The remaining production gap is remote sharing/server anchoring and durable authorization. Those are intentionally outside F5-D.
