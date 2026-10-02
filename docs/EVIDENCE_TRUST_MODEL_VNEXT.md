# Pisač Evidence Trust Model vNext

**Status:** TARGET TRUST MODEL — implementation must be proven before production adoption  
**Companion:** REFERENCE_ARCHITECTURE_VNEXT.md

## 1. Goal

The Evidence Trust Plane converts locally observed writing-process data into a chain of verifiable statements without overstating what those statements prove.

Trust is layered. A stronger layer never retroactively upgrades a weaker observation into proof of human authorship.

## 2. Claims and non-claims

### Local observation can support

- a specific Pisač client recorded a sequence of document transactions;
- those transactions are internally reconstructable under the declared schema;
- the local bundle is internally hash-consistent;
- a particular canonical document state can be reproduced from the recorded segment when reconstruction succeeds.

### Server receipt can additionally support

- an authenticated request submitted a specific segment digest;
- the server accepted that exact digest under a stated evidence schema/profile;
- the server observed acceptance no later than its recorded server time;
- the accepted receipt links to the predecessor the server expected.

### Transparency inclusion can additionally support

- a receipt digest was included in an append-only public/verifiable log state;
- later checkpoints are cryptographically consistent extensions of earlier checkpoints.

### Qualified/trusted timestamp can additionally support

- the checkpoint digest existed no later than the trusted timestamp;
- under an eIDAS qualified timestamp, the EU legal presumption attached to qualified electronic time stamps applies to the accuracy of date/time and integrity of the bound data.

### None of these layers proves

- the student's physical identity at the keyboard;
- sole authorship;
- absence of a second device;
- absence of external AI or human assistance;
- academic integrity or misconduct;
- truth of the written content.

## 3. Versioned evidence envelope

New v2 evidence uses a stable, versioned envelope.

Conceptual shape:

~~~text
EvidenceSegmentV2
- evidenceSchema: 'pisac-evidence-segment-v2'
- canonicalization: 'RFC8785-JCS'
- hashAlgorithm: 'sha256'
- documentId
- sessionId
- segmentId
- sequenceFrom
- sequenceTo
- observedStartedAt
- observedEndedAt
- initialDocumentHash
- finalDocumentHash
- predecessorSegmentHash | null
- events[]
- captureContext
- evidenceProfileId
~~~

Every field whose meaning affects verification belongs to the versioned schema. No verifier is allowed to infer omitted semantics from the current application version.

## 4. Canonicalization and hashing

### New format

1. Validate the logical segment against the declared schema.
2. Serialize using RFC 8785 JSON Canonicalization Scheme.
3. Compute SHA-256 over canonical UTF-8 bytes.
4. The resulting digest is the segment identity for server anchoring.

### Legacy evidence

Existing Pisač local-process v1 bundles keep their existing canonicalization and verification implementation forever.

Migration rule:

~~~text
schema version -> canonicalization version -> verifier implementation
~~~

A v1 bundle is never rehashed as v2 and presented as if the original digest had used JCS.

## 5. Client capture boundary

Capture remains opt-in/policy-driven and restricted to the Pisač editor surface.

The client:

- records ProseMirror/Tiptap document transactions, not claims about physical key presses;
- distinguishes known UI origins such as paste/drop where the editor can observe them;
- does not monitor other applications;
- does not read clipboard history outside actual paste events;
- seals bounded process segments;
- verifies reconstruction before placing a segment in the upload outbox;
- keeps document durability independent from evidence capture availability.

Failure rule:

> Evidence failure must never destroy or block the student's ordinary document save path.

## 6. Evidence Outbox

Evidence upload is asynchronous.

Each outbox item contains:

- immutable canonical segment bytes;
- segment digest;
- predecessor digest;
- local creation metadata;
- attempt state;
- server receipt once accepted.

Outbox semantics:

- idempotent upload;
- retry transient failures;
- do not silently discard authorization/schema/conflict failures;
- expose incomplete anchoring honestly to the user/submission gate;
- deletion follows RetentionProfile and submission policy.

## 7. Evidence Gateway

The gateway is a privileged trust boundary, separate from ordinary generic sync.

Validation order:

1. Authenticate principal.
2. Resolve document/project context.
3. Authorize EVIDENCE_APPEND for this document.
4. Resolve assignment EvidenceProfile and retention policy.
5. Validate payload size and schema version.
6. Recompute canonicalization and segment digest.
7. Validate document/session identifiers.
8. Validate sequence bounds and predecessor relationship.
9. Enforce idempotency.
10. Persist immutable payload object and receipt metadata.
11. Sign receipt through SigningKeyProvider.
12. Queue transparency publication.

Malformed evidence never enters the canonical evidence index.

## 8. Raw evidence storage

Raw evidence is encrypted object storage, not a transparency-log payload and not one SQL row per editor transaction.

Object key is opaque. Metadata belongs in PostgreSQL.

Conceptual metadata:

~~~text
evidence_segments
- segment_id
- tenant_id
- document_id
- session_id
- sequence_from / sequence_to
- segment_hash
- predecessor_hash
- object_ref
- bytes
- evidence_schema
- evidence_profile_id
- accepted_at
- retention_until
- deletion_state
~~~

Object storage payload is immutable after acceptance, but retention deletion remains possible unless a specific legal/institutional hold applies.

## 9. Signed server receipt

Receipt conceptual payload:

~~~text
EvidenceReceiptV1
- receiptSchema
- receiptId
- tenantIdHash or opaque tenant scope
- documentEvidenceId
- sessionId
- segmentId
- segmentHash
- predecessorSegmentHash
- evidenceProfileId
- acceptedAt
- signingKeyId
- signingKeyVersion
- signatureAlgorithm
~~~

Do not place student name, email, title of thesis or raw content in the portable receipt unless a specific export context requires it.

Signature is calculated over canonical receipt bytes.

Private signing keys live in KMS/HSM. Historical public keys remain discoverable for verification after rotation.

## 10. Transparency log

### Purpose

The transparency layer makes retroactive history rewriting detectable even to verifiers that do not trust the live Pisač database.

### Implementation principle

Use a production transparency-log implementation such as Tessera rather than implementing a custom Merkle tree.

Leaf payload:

- receipt digest;
- receipt schema identifier;
- opaque receipt ID;
- optional region/log identifier.

No raw evidence and no direct PII.

### Checkpoints

Each regional log periodically publishes a signed checkpoint containing at least:

- log identity;
- tree size;
- Merkle root;
- checkpoint signature.

Where configured, one or more independent witnesses cosign/check the checkpoint history.

### Proofs

Verifier APIs support:

- inclusion proof for a receipt leaf;
- consistency proof/checkpoint verification;
- public checkpoint retrieval;
- public signing/witness keys.

## 11. Trusted timestamp

Do not call a TSA for every editing event.

Timestamp published checkpoint roots on a bounded cadence or submission boundary.

Profiles:

### Standard

Signed Pisač receipt and signed transparency checkpoint.

### Enhanced

RFC 3161 trusted time-stamp token over checkpoint digest.

### EU High Assurance

Qualified electronic time stamp from a qualified trust service provider appearing on the EU Trusted List, where available under the institution's assurance policy.

The timestamp token and provider/certificate chain are preserved with checkpoint verification material.

## 12. Assurance profiles

### Minimal

- no full replay upload required;
- canonical checkpoint digests;
- server receipt optional/assignment-defined;
- short local evidence retention.

### Standard

- bounded semantic transaction segments;
- server signed receipts;
- ordinary review retention;
- submission may require all declared segments to be anchored.

### Review

- replay-capable segments;
- mentor may inspect evidence explicitly shared/permitted;
- deleted text handling governed by institution policy;
- server receipts and transparency inclusion.

### High Assurance

- Review requirements;
- stricter authentication/session context;
- KMS/HSM-signed receipts;
- transparency inclusion and witnessed checkpoints;
- RFC3161/eIDAS-qualified checkpoint timestamp;
- final artifact provenance binding.

### Controlled

- High Assurance;
- managed institutional execution context/device controls;
- future native agent/device-attestation inputs where justified;
- still does not claim mathematical proof of human authorship.

## 13. Retention profiles

RetentionProfile is orthogonal to EvidenceProfile.

Each data class specifies:

- purpose;
- legal/institutional basis;
- minimum/maximum retention;
- mentor visibility duration;
- student export right;
- deletion behavior;
- legal/academic hold behavior;
- whether raw payload and durable proof have different lifetimes.

Example principle:

~~~text
raw replay payload:        bounded retention
signed receipt:            longer retention where lawful
transparency digest:       long-lived opaque proof
final submission artifact: institution policy
~~~

A digest may be retained after raw payload deletion only if the policy/lawful basis permits it and the digest itself does not unnecessarily expose personal data.

## 14. Evidence visibility

Evidence existence and evidence visibility are separate.

Possible relationships:

- student owns private evidence;
- mentor may view only evidence connected to a specifically shared/submitted revision;
- institution auditor may have narrowly scoped access under policy;
- support staff do not automatically gain raw evidence access.

All evidence reads generate audit events.

## 15. Academic revisions and evidence

Evidence does not determine academic-object semantics by itself.

Existing layers remain:

~~~text
Process Segment
   -> verified object activity
   -> Academic Revision Lifecycle
   -> EvidenceBasis / source review
   -> Mentor ReviewCoverage
~~~

Server anchoring upgrades integrity/timing of process evidence. It does not change EvidenceBasis verdicts or mentor judgments.

## 16. Submission proof package

At submission, generate a compact portable proof package:

~~~text
SubmissionProof
- submissionId
- canonicalDocumentRevision
- finalArtifactHash
- required EvidenceProfile
- evidence completeness status
- anchored receipt IDs/digests
- transparency checkpoint
- inclusion proof(s) or aggregate reference
- trusted timestamp token/ref where required
- C2PA credential/ref
- public verification key identifiers
~~~

The proof package contains links/digests, not every raw editing event.

## 17. C2PA binding

C2PA is the final-artifact provenance layer.

Use C2PA 2.4 concepts where supported:

- hard binding to DOCX/PDF artifact;
- c2pa.actions for high-level content history;
- c2pa.ai-disclosure for relevant AI assistance disclosure;
- c2pa.repository-receipt when it correctly represents repository ingestion proof;
- otherwise a namespaced Pisač assertion such as hr.pisac.academic-provenance.

Pisač assertion may include:

- submission ID;
- canonical revision;
- EvidenceProfile;
- regional log ID;
- transparency checkpoint digest;
- verification URI;
- proof-package digest.

Do not embed raw replay or private mentor data.

## 18. C2PA OOXML implementation gate

Specification support is not implementation proof.

Before production:

1. Create deterministic synthetic DOCX fixture.
2. Embed a C2PA manifest according to OOXML/ZIP C2PA rules.
3. Validate the credential with an independent validator.
4. Open in supported Microsoft Word versions.
5. Save/reopen and record expected credential behavior.
6. Verify native OOXML signatures ordering if they are used.
7. Confirm no corruption of footnotes, comments, equations, relationships, styles or package content types.
8. Run on Windows golden environment.

If current c2pa-rs/c2patool does not support DOCX directly, do not fake support. Build a narrow OOXML packaging implementation from the specification or defer C2PA DOCX until a suitable SDK path exists.

## 19. Public verifier

Pisač should provide an independent-verification path:

Input:

- final artifact or artifact hash;
- proof package / C2PA credential;
- optional receipt.

Verifier performs:

- artifact hash/binding validation;
- C2PA signature validation;
- Pisač signing-key validation;
- transparency inclusion/checkpoint validation;
- trusted timestamp validation if present;
- schema/profile interpretation.

Output uses factual language:

- VALID CRYPTOGRAPHIC BINDING;
- RECEIPT INCLUDED IN LOG;
- TIMESTAMP VALID;
- RAW EVIDENCE AVAILABLE / EXPIRED / WITHHELD BY POLICY;
- PROVENANCE INCOMPLETE;

never:

- HUMAN WRITTEN;
- NO AI USED;
- CHEATING / NOT CHEATING.

## 20. Failure modes

### Client loses evidence before upload

Document remains safe; evidence profile reports an explicit gap.

### Duplicate upload

Idempotency returns same receipt; no second canonical evidence item.

### Predecessor mismatch

Fail closed as chain conflict; preserve both local data and diagnostic state.

### Object storage write succeeds, DB transaction fails

Use staged/orphan cleanup or transactional metadata protocol; never issue a receipt until canonical metadata commit succeeds.

### DB commit succeeds, signer unavailable

Receipt remains pending-signature; submission requiring signed evidence cannot treat it as anchored.

### Transparency publication delayed

Receipt remains server-signed but not transparency-anchored; assurance state is explicit.

### Timestamp provider unavailable

High-assurance finalization waits or follows institution-approved fallback policy; ordinary authoring is unaffected.

### Signing key rotated

New receipts use new version; historic verifier keeps old public key/certificate metadata.

### Transparency log compromise

Public/witnessed checkpoints and external timestamp material allow detection/recovery analysis; raw evidence remains separately stored.

## 21. Privacy and abuse threats

Threats include:

- over-collection of deleted text;
- mentor browsing unrelated student evidence;
- support/admin privilege abuse;
- evidence payload leakage;
- timestamp/log PII leakage;
- correlation through stable public identifiers;
- indefinite retention;
- malicious client fabricating internally consistent local history;
- compromised browser/device;
- compromised server credentials.

Mitigations:

- minimization profiles;
- opaque public log leaves;
- ReBAC authorization;
- read audit;
- encrypted storage;
- least-privilege services;
- server anchoring close to observation time;
- external/witnessed checkpoints;
- retention deletion;
- explicit non-claims in product UI.

## 22. Acceptance tests

Evidence Trust Plane is not production-ready until it proves:

- deterministic JCS/hash fixtures across implementations;
- legacy v1 verifier stability;
- exact idempotent duplicate behavior;
- predecessor-chain rejection;
- unauthorized cross-student append denial;
- unauthorized evidence read denial;
- storage corruption detection;
- signing-key version validation;
- inclusion proof validation;
- consistency checkpoint validation;
- timestamp token validation;
- raw payload deletion without breaking portable proof interpretation;
- privacy-safe log leaf inspection;
- synthetic end-to-end submission proof verification.

## 23. Implementation order

1. Evidence schema v2 + JCS test vectors.
2. Local Evidence Outbox contract.
3. Gateway with synthetic storage and development signer.
4. KMS/HSM signing adapter.
5. Tessera transparency spike.
6. Witness/checkpoint verification.
7. RFC3161 timestamp spike.
8. eIDAS QTSP integration profile.
9. Retention/deletion workflows.
10. C2PA/OOXML submission binding.
11. Independent verifier.

## 24. Primary standards

- RFC 8785 JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785
- RFC 9162 Certificate Transparency Version 2.0: https://www.rfc-editor.org/rfc/rfc9162
- RFC 3161 Time-Stamp Protocol: https://www.rfc-editor.org/rfc/rfc3161
- Transparency.dev / Tessera: https://transparency.dev/
- C2PA 2.4: https://spec.c2pa.org/specifications/specifications/2.4/
- EU Trusted Lists: https://digital-strategy.ec.europa.eu/en/policies/eu-trusted-lists
- eIDAS Regulation: https://eur-lex.europa.eu/eli/reg/2014/910/oj
- GDPR: https://eur-lex.europa.eu/eli/reg/2016/679/oj

## 25. Final trust rule

Cryptography protects statements from undetected alteration. It does not make the underlying statement broader than the observation supports.

That principle governs every Pisač receipt, badge, mentor view, export and final Content Credential.