# Evidence Format v2 — RFC 8785 JCS foundation

**Status:** shadow/proof format only. The production authoring capture path remains v1 until a later migration gate.

## Purpose

Evidence v2 establishes a stable cryptographic byte representation before any server receipt, transparency-log or timestamp implementation is built.

It deliberately does **not** replace the existing local process ledger in this PR.

## Version markers

Every v2 segment carries:

- `evidenceSchema = pisac-evidence-segment-v2`
- `canonicalization = RFC8785-JCS`
- `hashAlgorithm = sha256`

A verifier must select behavior from these declared identifiers. It must never infer the canonicalization algorithm from the current application version.

## Canonicalization

`canonicalizeJcs()` implements the RFC 8785 JSON Canonicalization Scheme for in-memory JSON values:

- ECMAScript JSON serialization for primitives and numbers;
- no whitespace;
- recursive object-property sorting by raw UTF-16 code units;
- array order preserved;
- NaN and Infinity rejected;
- lone UTF-16 surrogates rejected;
- JavaScript-only values such as undefined, functions, bigint and symbols rejected.

Unicode normalization is **not** applied. NFC and decomposed strings therefore remain distinct, as required by JCS.

## Segment semantics

A v2 segment contains:

- document/session/segment identifiers;
- an explicit contiguous sequence range;
- canonical ISO timestamps;
- initial and final document hashes;
- optional predecessor-segment hash;
- ordered transaction events;
- source classification already observable by Pisač;
- ProseMirror-style step JSON;
- optional sorted unique touched node IDs;
- per-event before/after document hashes;
- capture-context identifiers;
- EvidenceProfile identifier.

Structural validation also requires the per-event document hash chain to connect from `initialDocumentHash` to `finalDocumentHash`.

## Cryptographic identity

The segment digest is:

~~~text
SHA-256(
  UTF8(
    RFC8785_JCS(EvidenceSegmentV2)
  )
)
~~~

The canonical bytes, byte length and digest are returned together so the later Evidence Gateway can verify exactly what the client claims it uploaded.

## Test vectors

Tests include:

1. the RFC 8785 serialization example;
2. RFC UTF-16 property-order behavior;
3. rejection of non-finite numbers and lone surrogates;
4. an independently precomputed EvidenceSegmentV2 canonical string and SHA-256 digest;
5. sequence, timestamp and document-hash-chain failure cases.

The fixed evidence vector is:

~~~text
sha256 = 23edb335328a73fd448a8e56c61d6a9f8c6d2f471d2c2b89f2e5da5d8470c0c4
canonical UTF-8 bytes = 1028
~~~

## Legacy v1 guarantee

The existing files that define current evidence behavior are intentionally untouched:

- `src/editor/process-capture.ts`
- `src/domain/forensics/integrity.ts`
- `src/lib/process-ledger/process-ledger.ts`

Existing `pisac-local-transactions-v1` bundles continue to use the historic Pisač canonicalizer and hashes.

A future migration may **project** a verified v1 process into a new v2 segment, but it must create a new v2 cryptographic identity. It may never relabel a historic v1 hash as JCS/v2.

## Explicitly out of scope

This step does not add:

- an Evidence Outbox;
- server upload;
- Evidence Gateway;
- signed receipts;
- KMS/HSM;
- object storage;
- transparency log;
- trusted/eIDAS timestamp;
- C2PA;
- production switch from v1 to v2.

Those remain later gates in the vNext convergence plan.
