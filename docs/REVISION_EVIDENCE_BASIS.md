# F5-H — revision-specific EvidenceBasis review lifecycle

## Existing EvidenceBasis remains canonical

Pisač already has the content-level `src/domain/evidence/basis.ts` model. That model owns the actual EvidenceBasis snapshot:

- claim text + text anchor;
- source identity + source version;
- excerpt/locator;
- snapshot review time;
- deterministic evaluation of claim movement/change and source-version change.

F5-H does **not** create a second competing EvidenceBasis model.

Instead, F5-H adds an append-only academic-revision review lifecycle **over IDs of those existing EvidenceBasis snapshots**.

## Stable claim↔source link

A review link represents a durable claim↔source relationship:

- `documentId`
- `linkId`
- `claimId`
- `sourceId`
- `attachedRevision`
- `attachedAt`

The link is document-scoped.

Production mutation paths derive `documentId`, `claimId`, and `attachedRevision` from the current AcademicObjectRegistry claim binding rather than accepting an arbitrary future claim revision.

Attachment cannot be backdated before the current claim revision became effective.

## Exact EvidenceBasis snapshot per reviewed revision

A review verification contains:

- `documentId`
- `verificationId`
- `linkId`
- exact `basisId` of the EvidenceBasis snapshot reviewed
- exact academic `claimRevision`
- `verifiedAt`
- substantive `verdict`: `supports | challenges | insufficient`

The current-binding adapter derives `claimRevision` from the current registry binding. It rejects a verification timestamp before the current revision's `boundAt`. It also checks that the referenced basis belongs to the same claim, source and bound node. `evidenceBasisReviewRef()` derives that identity from the existing canonical `EvidenceBasis` model via its validator.

The review ledger therefore never says merely “source S was checked sometime.” It records “EvidenceBasis snapshot B was checked for claim rev.N.”

A new claim revision can be reviewed against a new EvidenceBasis snapshot while historical rev.N remains tied to its original snapshot.

## Freshness is separate from substantive verdict

For a source link that already applies to a revision:

- `VALID` means one explicit review verification exists for that exact claim revision.
- `RECHECK_REQUIRED` means the source relationship exists but no verification covers that exact revision.

`VALID` is freshness/review coverage only.

A `VALID` review may have verdict:

- `supports`
- `challenges`
- `insufficient`

Therefore a current review with verdict `challenges` is still freshness-`VALID`.

Likewise, `RECHECK_REQUIRED` does not mean the source is false. It means the prior EvidenceBasis review does not cover the current formulation.

A link attached at rev.N is not projected backward onto rev.N-1.

## Readiness boundary

The readiness adapter exports only:

`VALID | RECHECK_REQUIRED`

It deliberately discards the substantive verdict. Readiness is `VALID` only when **both** the exact-revision review exists and the referenced canonical EvidenceBasis snapshot currently evaluates `VALID` under the existing basis evaluator. Missing, stale, or conflicting basis-validity inputs fail closed to `RECHECK_REQUIRED`.

The existing Academic Readiness evaluator therefore blocks stale/unreviewed review coverage **or** a stale canonical basis snapshot, but does not treat a fully current `challenges` verdict as if it were an up-to-date-review failure.

A future evidence-quality policy may separately decide what to do with `challenges` or `insufficient`.

## Persistence

The review lifecycle uses its own IndexedDB store, separate from:

- the actual EvidenceBasis snapshot domain;
- process history;
- AcademicObjectRegistry;
- academic revisions.

Persistence enforces:

- unique `[documentId+linkId]`;
- unique `[documentId+verificationId]`;
- unique `[documentId+linkId+claimRevision]`.

Each exact link/revision can therefore have one immutable review verification. A second writer cannot silently replace the recorded EvidenceBasis snapshot or verdict for that revision. Concurrent writers are reconciled by reading the canonical persisted ledger; contradictory canonical basis-validity signals fail readiness closed.

Legacy experimental unscoped `rows` data is preserved but causes `invalid-ledger`. Missing document identity is never guessed.

Malformed typed rows likewise fail closed.

## Demo boundary

The demo source `SRC-DEMO-1` and basis IDs `DEMO-BASIS-R4`, `DEMO-BASIS-R5`, ... are explicitly synthetic demonstration identifiers.

The source link is created without automatically marking evidence reviewed.

The user explicitly verifies rev.N, which stores the rev.N EvidenceBasis snapshot ID. After the claim advances to rev.N+1, freshness becomes `RECHECK_REQUIRED`; the new explicit review records a different rev.N+1 EvidenceBasis snapshot ID.

## Out of scope

F5-H does not yet add:

- mentor ownership/routing;
- Command Center projection;
- evidence-quality blocking policy;
- persistent storage of the canonical EvidenceBasis snapshot objects themselves;
- source-version monitoring orchestration;
- backend/remote sharing;
- server attestation;
- identity proof;
- AI/human scoring.
