# R3 — Evidence Trust Plane Foundation

**Status:** executable foundation; no production evidence server is enabled by this change.

## Goal

R3 proves the semantics between a locally verified EvidenceSegmentV2 and a server-signed evidence receipt before adding real object storage, KMS/HSM, transparency or timestamp infrastructure.

The critical guarantee is:

> A signed receipt exists only after exact canonical bytes have been revalidated, rehashed, authorized, immutably stored, atomically accepted into the evidence chain, signed and signature-verified.

## End-to-end flow

~~~text
EvidenceSegmentV2
  -> Evidence Outbox intent
  -> EvidenceGateway
       1. validate v2 ingest envelope
       2. parse JSON
       3. validate EvidenceSegmentV2 schema
       4. recompute RFC8785 JCS string
       5. require wire string == canonical string byte-for-byte
       6. recompute SHA-256 + payload byte count
       7. compare descriptor to segment
       8. resolve server-side EvidencePackage context
       9. enforce server document/profile authority
      10. high-consistency APPEND_EVIDENCE authorization
      11. immutable payload put
      12. atomic metadata reserve / predecessor check / idempotency
      13. canonical receipt digest
      14. signer sign()
      15. signer verify()
      16. attach signature to accepted metadata
  -> signed receipt
~~~

## Evidence Outbox

The outbox contract stores one immutable EvidenceIngestCommandV2.

State machine:

~~~text
pending
  -> uploading
       -> accepted      accepted/duplicate signed receipt
       -> pending       transient unavailable; retry
       -> blocked       invalid/security/chain/idempotency/size/closed package
~~~

A retry does not rebuild the evidence segment or change its canonical payload/hash.

This PR adds the state-machine/port contract only. A crash-safe Dexie/SQLite persistence adapter is a later implementation step.

## Server package context is authoritative

The client cannot choose the effective evidence policy.

EvidenceContextPort resolves:

- EvidencePackage ID;
- canonical document ID;
- EvidenceProfile ID;
- maximum payload size;
- whether the package currently accepts evidence.

The Gateway rejects a segment whose document/profile does not match this server context.

## Authorization

The Gateway checks:

~~~text
action = append_evidence
resource = evidence_package:<id>
consistency = higher-consistency
~~~

Authorization failure occurs before object storage.

Authorization provider unavailability is reported separately from DENY so operations remain observable while callers still fail closed.

## Exact canonical wire bytes

The Gateway accepts only the exact RFC 8785 JCS string.

It does not accept:

~~~text
semantically-equivalent JSON
 -> server canonicalizes it
 -> receipt silently describes different bytes
~~~

Instead:

~~~text
wire bytes/string == server recomputed JCS
~~~

must hold exactly.

Duplicate object keys, alternative whitespace/key ordering and noncanonical representations therefore cannot obtain a receipt for different wire bytes under the same logical object.

## Payload storage semantics

EvidencePayloadStore is immutable and content-addressed within EvidencePackage scope.

Allowed:

- first exact write -> STORED;
- retry same package/hash/exact bytes -> EXISTING.

Rejected:

- same package/hash/different bytes -> CONFLICT.

The in-memory adapter uses collision-safe structured keys rather than delimiter-concatenated IDs.

## Atomic acceptance metadata

EvidenceAcceptanceRepository owns:

- idempotency scope;
- predecessor chain;
- receipt ID minting;
- acceptedAt minting;
- previous receipt linkage;
- pending_signature/signed state.

This is deliberate: acceptedAt is created as part of canonical metadata acceptance, not earlier in the HTTP/application path.

Production implementation must make the reserve operation transactional.

## Idempotency

Idempotency scope is:

~~~text
authenticated principal
+ EvidencePackage
+ clientRequestId
~~~

Retry with the exact same descriptor returns the existing acceptance.

Reuse of the same idempotency key for different evidence returns IDPOTENCY_CONFLICT and never rewrites the accepted record.

## Chain semantics

Each EvidencePackage has one accepted segment head in this foundation.

A new segment must declare:

~~~text
predecessorSegmentHash == current accepted segmentHash
~~~

The repository atomically compares and advances the head.

The resulting receipt also contains previousReceiptId, producing a second explicit server receipt linkage.

Future policy may define multiple named streams/packages where parallel chains are needed; this PR deliberately does not guess such topology.

## Receipt semantics

Portable receipt payload contains:

- receipt schema;
- opaque receipt/package/document/session/segment IDs;
- segment hash;
- predecessor hash;
- previous receipt ID;
- evidence schema/profile;
- sequence range/event count;
- payload byte count;
- acceptedAt.

It does not contain:

- student name;
- email;
- raw document/evidence text;
- principal ID.

The authenticated principal is retained in private acceptance metadata for access/audit purposes.

## Signing

SigningKeyProvider is provider-neutral.

It exposes:

- sign(exact bytes);
- verify(exact bytes, signature);
- publicVerificationKey().

Gateway signs RFC8785-JCS receipt payload bytes and verifies the returned signature **before** it can be persisted as signed.

Signature metadata records:

- algorithm;
- key ID;
- key version;
- signature bytes (base64url).

## Development signer

DevelopmentEd25519SigningKeyProvider:

- uses an ephemeral in-memory Ed25519 keypair;
- signs/verifies real Ed25519 signatures;
- exports SPKI public verification material;
- refuses construction when NODE_ENV=production.

It is not a production signing solution.

Production target remains non-exportable KMS/HSM keys.

## Failure matrix

### Authorization denied/unavailable

No object storage write and no acceptance metadata.

### Context not found / mismatched

No object storage write and no receipt.

### Payload too large / package closed

Explicit TOO_LARGE / NOT_ACCEPTING terminal outcome.

### Object storage unavailable

No metadata and no receipt.

### Object storage succeeds; metadata reserve fails

A private orphan payload may remain.

There is **no receipt and no accepted metadata**.

A future object-store adapter needs orphan cleanup/TTL.

### Metadata reserve succeeds; signer unavailable

Acceptance record remains:

~~~text
pending_signature
~~~

No signed receipt is returned.

Retry of the same clientRequestId receives the exact existing receiptId + acceptedAt and retries signing.

### Signer returns unverifiable signature

Same as signer failure: metadata remains pending_signature; no signed receipt.

### Signature persistence unavailable

Metadata remains pending_signature.

Retry signs the same accepted receipt payload again; canonical acceptance time/id do not change.

### Duplicate after signed acceptance

Returns DUPLICATE plus the exact stored signed receipt.

### Wrong predecessor

Returns CHAIN_CONFLICT plus expected predecessor hash; chain is unchanged.

## Test adapters

R3 includes in-memory adapters for:

- evidence package context;
- immutable payload storage;
- acceptance repository.

These exist only to make the semantics executable and adversarially testable before selecting production infrastructure.

They are not deployment recommendations.

## Explicitly out of scope

R3 does not add:

- API route;
- authenticated HTTP endpoint;
- production Postgres tables/RPCs;
- Supabase Storage/Azure Blob/S3 adapter;
- crash-safe Evidence Outbox persistence;
- production KMS/HSM;
- Tessera/transparency log;
- witness;
- RFC3161/eIDAS timestamp;
- C2PA;
- public verifier;
- final submission gate.

## Next implementation gate

After R3 foundation is green, the next trust-plane step is:

1. production persistence schema + atomic repository implementation;
2. private object-storage adapter;
3. KMS/HSM SigningKeyProvider;
4. shadow authenticated endpoint;
5. adversarial auth/idempotency/concurrency tests;
6. only then transparency/Tessera.

No transparency layer should be added to an ingest path whose acceptance semantics are not yet production-grade.
