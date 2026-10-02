# F5-F — verified node lineage and AcademicObjectRegistry

## Scope

This layer extends the verified multi-session process history from F5-E with explicit node-level academic-object lineage. It remains local-only. It does not add Academic Revision Lifecycle, EvidenceBasis, mentor projection, server attestation, identity proof, or an AI/human score.

## Stable touched-node metadata

New capture events include `touchedNodeIds`, derived from ProseMirror StepMaps over the before/after documents. The field is part of the hashed event envelope.

Verification does not trust the stored metadata by itself: it replays the captured steps, recomputes the touched stable node IDs and rejects mismatches.

Older `pisac-f1-pm-v1` events without `touchedNodeIds` remain replayable and process-verifiable for backward compatibility, but they cannot produce node-level academic-object activity.

## Persistent AcademicObjectRegistry

An academic object is associated explicitly with an existing canonical editor `nodeId` inside one `documentId`. Academic object IDs are graph-local, so registry identity is the pair `documentId + objectId`; identical IDs in different works remain independent. No prose matching or semantic guessing creates a binding.

Bindings are append-only records containing:
- `documentId`
- `bindingId`
- academic `objectId` and type
- the object's current graph revision
- canonical editor `nodeId`
- `boundAt`
- monotonic `bindingVersion`
- `previousBindingId`

The registry has its own IndexedDB lifecycle, separate from the document journal and process ledger. A unique `[documentId+objectId+bindingVersion]` index prevents two persisted rows from occupying the same version of one object's binding history while allowing the same academic object ID in different documents.

Loading replays persisted rows through the domain validator. Corrupt or impossible registry history is surfaced as `invalid-registry`; rows are not silently repaired or deleted.

Rebindings require a strictly later `boundAt`. Equal timestamps are rejected because process events and bindings use millisecond wall-clock timestamps and their relative order would otherwise be ambiguous.

## Temporal attribution

A historical binding is effective from its `boundAt` until the next binding for that object.

Only process events that:
1. belong to the same `documentId` as the registry binding,
2. belong to a fully valid verified process history,
3. cryptographically verify,
4. contain recomputed `touchedNodeIds` for the bound node, and
5. occur strictly inside the binding's effective interval

may appear as verified object activity.

An event whose timestamp exactly equals a binding boundary is excluded rather than guessed into either side of the boundary.

Verified object activity retains the exact `bindingId`, session ID, ordered event indexes, before/after node text and the timestamp of its first actually attributed event. It preserves the verified process-history lineage order rather than re-sorting sessions by IDs or wall-clock ties.

## UI boundary

The demo lets the user explicitly bind `CLAIM-014` to the currently selected canonical editor block and then shows only verified activity occurring after that binding.

The registry is reloaded from its durable store after a successful write so the UI consumes the canonical persisted history rather than assuming its prior React state was complete.

This UI does not call an edit a new academic revision. Creating/sealing academic revisions is intentionally deferred to the next lifecycle layer.
