# F5-E — multi-session history and academic-object lineage

## Verified session history

History is built only from durable process bundles that pass capture verification. Every segment boundary remains first-class. A boundary can have a positive or zero-duration gap; neither case is interpreted as continuous writing.

Global navigation addresses `session-start`, concrete `event`, and `gap` states. Gap states never reconstruct or interpolate a document.

Descriptive analytics report segment/session/event facts only. Segment duration is not labelled active work. Short inter-transaction spans are reported separately and are not an authorship or AI score.

## Stable node touch metadata

New capture events include `touchedNodeIds`, derived from ProseMirror StepMaps over the before/after documents. The field is part of the hashed event. Verification recomputes the touched IDs from the captured steps and rejects a mismatch.

The field is backward-compatible: older `pisac-f1-pm-v1` events without `touchedNodeIds` remain replayable/verifiable, but they cannot provide node-level academic-object lineage.

## Academic-object binding

Object evolution does not search prose or infer that an event “looks related” to a claim. A binding requires an explicit Academic Graph mapping from `objectId` to stable document `nodeId`. For a verified bundle, the binding helper selects only events whose verified `touchedNodeIds` include that node. Before/after text is reconstructed from the node immediately before the first and after the last bound event.

A binding records object ID/type, revision, node ID, session ID, ordered event indexes and evidence IDs. Invalid/missing events, conflicting duplicate revisions and ambiguous event order are rejected.

The current demo evolution card remains explicitly synthetic because the production editor/Academic Graph does not yet persist a real objectId→nodeId registry. The next integration step is that registry; until it exists, the UI must not present synthetic lineage as automatic evidence.
