# F5-D — durable local process ledger

## Scope

This step makes the opt-in transaction capture from F5-C survive reloads locally. It does not add a backend, remote mentor access, identity proof, external timestamps or a human/AI score.

## Storage boundary

Process evidence uses a separate Dexie/IndexedDB database from the canonical document journal. The demo uses `pisac-process-ledger-demo`; document content continues to use its existing journal. Failure of one lifecycle must not be reported as durability of the other.

A segment record contains the captured-process bundle plus `startedAt`, `updatedAt`, status (`active`, `interrupted`, `sealed`) and `previousSessionHead`.

## Checkpoint and append-only rules

`LocalProcessCapture.checkpoint()` waits for a stable serialized hash tail and returns a self-consistent prefix without stopping capture. The UI persists these prefixes. A later checkpoint must extend the already persisted prefix; rollback or rewriting an earlier event is rejected. A sealed segment cannot be overwritten.

A continuation must reference the head of the latest prior segment. The first segment alone has no parent.

## Reload / interruption semantics

Reload never resumes an old `sessionId` as though nothing happened. Stored bundles are cryptographically self-verified with the actual editor schema. An active segment found after reload is marked `interrupted`. A new opt-in session starts from the document currently loaded by the ordinary document journal and links to the prior segment head.

This link proves only local data-structure continuity. It does not prove that no activity occurred during the gap. The interruption remains visible in the ledger.

Invalid or chain-inconsistent records are surfaced and retained; they are not silently deleted or repaired.

## Failure behavior

IndexedDB/process-ledger failures do not block ordinary editing or document journalling. The process panel shows that durable forensic evidence is not confirmed. In-memory capture may still operate, but the UI must not describe it as durable.

## Verification targets

Unit coverage includes reload through a fresh DB handle, immutable sealing, exact continuation links, corrupt-record retention, append-only checkpoint rules and stable active checkpoints. Browser coverage separates document `LOCAL_DURABLE` from process-checkpoint durability, then exercises sealed reload and interrupted-session continuation.

The remaining production gap is remote sharing/server anchoring and durable authorization. Those are intentionally outside F5-D.
