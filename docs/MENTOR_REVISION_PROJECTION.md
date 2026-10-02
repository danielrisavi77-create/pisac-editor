# F5-I — ReviewCoverage and revision-driven Mentor Projection

## Scope

This layer projects the document-scoped academic revision/evidence lifecycle into persistent mentor review coverage and the Mentor Command Center.

It does not add remote mentor accounts, notification delivery, backend synchronization, grading, risk scoring, authorship judgments, or automated approval.

## Persistent ReviewCoverage

A persistent mentor review record contains:

- `documentId`
- exact registry `bindingId`
- immutable review `id`
- `reviewerId`
- `objectId`
- exact `reviewedRevision`
- `reviewedAt`
- status: `reviewed | accepted | needs-work`

Production review writes are created from the **current AcademicObjectRegistry binding**. The persisted record therefore carries that exact `bindingId`; callers do not choose an arbitrary object/revision/binding.

Review time cannot predate the current binding.

The coverage database is append-only by record ID and document-scoped. Review timestamps must be strictly increasing for the same reviewer/object/binding, so two conflicting same-millisecond outcomes cannot be resolved by an arbitrary ID tie-break. Legacy experimental rows without `documentId` or `bindingId` are preserved but make the ledger invalid; new reviews are refused until that state is resolved.

The same academic object ID in two documents therefore never shares coverage history. A rebind to a different node at the **same academic revision** also invalidates prior coverage because the old review belongs to the old `bindingId`; projection becomes `CHANGED_SINCE_REVIEW` until the new binding is explicitly reviewed.

## Coverage is not approval

Coverage answers only whether the reviewer has reviewed the current revision:

- `NEVER_REVIEWED`
- `CHANGED_SINCE_REVIEW`
- `CURRENTLY_COVERED`

A `needs-work` record for the current revision is still `CURRENTLY_COVERED`: the mentor did review that revision. However its workflow owner becomes the **student**, because a revision request is pending.

Likewise, marking a revision `reviewed` does not verify its EvidenceBasis.

## Independent action signals

The projector keeps these signals separate:

1. **Mentor review delta**
   - current academic revision has not yet been reviewed;
   - includes a never-reviewed object or a revision changed since the last review.

2. **Mentor-actionable readiness blockers**
   - readiness blockers assigned to mentor work.

3. **Student-actionable readiness blockers**
   - in this stack, revision-specific evidence recheck is assigned to the student.

4. **Pending student revision request**
   - latest exact-revision mentor record is `needs-work`.

The projector exposes all four rather than collapsing them into one score.

## One primary “waiting on” value

The existing Command Center still needs one primary queue category.

Precedence is:

1. if any mentor action exists → `mentor`;
2. otherwise, if any student action exists → `student`;
3. otherwise → `none`.

This does not erase the secondary action. For example, immediately after rev.5 is sealed:

- mentor review delta = 1;
- student evidence recheck = 1;
- primary waiting-on = `mentor`.

After the mentor reviews rev.5:

- mentor review delta = 0;
- student evidence recheck = 1;
- primary waiting-on = `student`.

After evidence recheck:

- both are 0;
- waiting-on = `none`.

## Fail-closed projection

Projection rejects:

- a binding from another document;
- a persisted review claiming a future revision;
- a revision ledger that is one phase ahead of the registry.

The latter prevents the Command Center from presenting a misleading state during an unresolved revision→registry two-phase mismatch.

## No fabricated baseline review

Binding a claim does **not** create a mentor review record.

A newly bound claim starts as `NEVER_REVIEWED` until a mentor explicitly records review coverage.

The demo exposes that explicit action both next to the live claim projection and inside the Command Center.

## Command Center integration

The main Command Center is intentionally hybrid during this phase:

- live `CLAIM-014` is loaded from the persistent registry/revision/evidence/coverage stores;
- the remaining demo academic objects are still synthetic fixtures.

Generic synthetic review-queue actions are not silently reused as persistent live-claim review records. The live claim has a separate explicit persistent review action.

A local `pisac:lifecycle-updated` event refreshes the Command Center after successful binding, revision advancement, evidence review, or mentor coverage writes. It is only an in-page refresh signal, not a remote event bus.

## Out of scope

- mentor authentication/authorization;
- remote student/mentor routing;
- notifications;
- persistent revision-request messages;
- mentor comments linked to backend users;
- final submission approval;
- grading;
- integrity or AI-risk scores.
