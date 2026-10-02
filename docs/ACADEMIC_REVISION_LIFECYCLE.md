# F5-G — Academic Revision Lifecycle

## Scope

This layer turns verified object activity from F5-F into explicit academic revision drafts and sealed revisions. It remains local-only and document-scoped.

It does not add EvidenceBasis, mentor projection, backend sharing, server attestation, identity proof or AI/human scoring.

## Draft semantics

A draft is keyed by `documentId + objectId` and tied to one exact registry `bindingId` and base academic revision.

Only verified activity for that same document, object, binding and canonical node may enter the draft. Individual keystrokes do not increment the academic revision.

The draft's `openedAt`, `lastActivityAt` and `afterText` are derived from verified activity. Callers do not supply an arbitrary snapshot from the live editor.

A later draft update must contain all activity already persisted for that draft. Rollback of verified activity is rejected.

## Seal semantics

Explicit seal creates exactly `baseRevision + 1`.

The sealed revision copies the verified draft snapshot. It does not re-read the live editor at seal time, so uncaptured edits made after the verified process segment cannot silently enter a sealed academic revision. Seal time must be strictly later than `lastActivityAt`; this keeps the final old-binding event strictly inside the old binding interval after registry phase 2.

A deleted bound node is represented by `afterText = null`.

Revision IDs are immutable, and the persistence store enforces one sealed revision number per `documentId + objectId`.

## Registry synchronization

Revision persistence and AcademicObjectRegistry persistence are separate IndexedDB lifecycles, so the transition is intentionally two-phase:

1. atomically replace the revision draft with the sealed revision;
2. append a new registry binding version for the same canonical node and the new academic revision.

If phase 1 succeeds and phase 2 fails, reload recovery may complete only this exact missing second phase. Recovery requires:
- the latest sealed revision belongs to the same document/object;
- it is exactly current registry revision + 1;
- it references the current binding;
- its seal time is strictly after the binding time.

Any larger or unrelated mismatch is rejected as unsafe.

## Persistence boundary

Drafts and sealed revisions use separate IndexedDB tables. Legacy experimental unscoped `rows` data is preserved but rejected as `invalid-ledger`; the lifecycle does not guess a missing `documentId`.

The drafts table has a unique `[documentId+objectId]` index, allowing at most one open draft per academic object in one document.

The sealed table has a unique `[documentId+objectId+revision]` index, preventing concurrent writers from persisting two different records for the same academic revision.

## Next layer

Revision-specific EvidenceBasis is deliberately deferred. This lifecycle does not contain evidence IDs or evidence verdicts.
