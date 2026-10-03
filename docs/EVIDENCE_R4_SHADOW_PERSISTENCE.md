# R4 — Production Evidence Persistence (Shadow)

**Status:** shadow persistence is deployed; ingestion remains disabled by default.

## What is live

Pisač Supabase project `cxwxxcwrgushfkisfpxz` now contains a private
`pisac_evidence` schema with:

- `packages` — server-owned EvidencePackage policy/context and chain head;
- `acceptances` — immutable acceptance metadata, receipt payload and signed
  receipt state;
- atomic service-role-only RPCs for package creation/context, pre-storage
  idempotency lookup, chain reservation, signature attachment and the temporary
  F1 shadow append authorization check.

Live migrations:

- `20261003073107 evidence_r4_shadow_persistence`
- `20261003073246 evidence_r4_shadow_indexes`
- `20261003074143 evidence_r4_shadow_lookup_recovery`
- `20261003075051 evidence_r4_shadow_lookup_authorization`
- `20261003075723 evidence_r4_signature_encoding`
- `20261003081415 evidence_r4_signature_encoding_pairs`
- `20261003082323 evidence_r4_signature_encoding_pairs` — idempotent live-history reapply
- `20261003082618 evidence_r4_sql_runtime_fixes`

The same SQL is mirrored in `supabase/migrations/`.

## Security boundary

The Evidence tables are not in the public schema.

`anon` and `authenticated`:

- have no schema USAGE;
- have no table privileges;
- have explicit deny RLS policies;
- cannot execute any `pisac_evidence_*` RPC.

`service_role` is the only database API role granted the Evidence RPCs.

All new Evidence RPCs are `SECURITY INVOKER`; R4 did not introduce another
authenticated `SECURITY DEFINER` path.

After the R4 migrations, the Supabase security advisor reports no new R4
warning. The only WARN findings remain the three existing F1 document/checkpoint
SECURITY DEFINER RPCs.

## Server secret model

New backend code prefers:

~~~text
SUPABASE_SECRET_KEY=sb_secret_...
~~~

with legacy `SUPABASE_SERVICE_ROLE_KEY` as a temporary fallback.

The secret is never a `NEXT_PUBLIC_*` value and never reaches the browser.

## Object storage

Raw canonical EvidenceSegmentV2 bytes are stored through the Supabase Storage
API, never through SQL writes to the `storage` schema.

Required bucket properties:

- explicitly configured `PISAC_EVIDENCE_STORAGE_BUCKET`;
- private;
- JSON-only (`application/json`);
- exact bounded file-size policy compatible with the server EvidenceProfile;
- immutable upload semantics (`upsert: false`).

A duplicate upload is treated as idempotent only after downloading the existing
object and comparing the exact canonical bytes.

The repository includes:

~~~text
npm run bootstrap:evidence-storage
~~~

which uses the server secret and Storage API to create/validate this bucket.

**Current live state:** no Evidence Storage bucket exists. R4 therefore remains
fail-closed/dormant until an operator configures a server secret and runs the
bootstrap.

## KMS/HSM signing

R4 has a provider-neutral `SigningKeyProvider`.

Concrete adapters:

- development-only ephemeral Ed25519 (prohibited in production);
- Azure Key Vault / Managed HSM P-256 ES256 adapter;
- AWS KMS Ed25519 semantic adapter retained as a second provider option.

Azure shadow configuration requires a **version-pinned** Key Vault key URL.
Signing sends only a SHA-256 digest to Key Vault. Receipt signature metadata
records:

- algorithm;
- stable Pisač key alias;
- concrete key version;
- signature wire encoding;
- base64url signature.

`signatureEncoding` is explicit because KMS providers do not necessarily use
the same ECDSA wire representation.

The Azure adapter verifies the signature through the same pinned Key Vault key
before the Gateway may persist the signed receipt.

**Current live state:** no KMS/HSM credentials are configured by this PR.
Production shadow ingestion therefore remains unavailable.

## Signature encodings

Portable receipts support:

~~~text
Ed25519              + raw
ECDSA_P256_SHA256    + ieee-p1363 | der
RSA_PSS_SHA256       + raw
~~~

The application validator and live signature-attachment RPC enforce these
algorithm/encoding pairs. Public verification keys are validated independently
as SPKI DER material; they do not carry a signature encoding.

The live signature-attachment RPC rejects missing/unknown signature encodings
and requires Ed25519 to use raw encoding.

## Shadow runtime gates

`POST /api/evidence/shadow/package` and
`POST /api/evidence/shadow/ingest` are dormant unless all required gates are
present.

Required:

1. `PISAC_EVIDENCE_SHADOW_ENABLED=1`;
2. pinned `NEXT_PUBLIC_SITE_URL`;
3. exact same-origin POST;
4. revalidated non-anonymous Supabase session;
5. server Supabase secret;
6. private correctly configured Evidence bucket;
7. server-defined EvidenceProfile and payload limit;
8. configured signing provider;
9. high-consistency APPEND_EVIDENCE authorization.

The client does not choose the effective EvidenceProfile or maximum evidence
payload size.

Internal Storage/KMS/database error details are not returned to the browser.

## Request-body defense

Shadow routes stream request bodies through a hard byte limit before JSON
parsing. A forged/missing `Content-Length` therefore cannot bypass the actual
size check.

The ingest body must pass the exact EvidenceIngestCommandV2 runtime guard and
the Gateway still independently:

- parses the embedded canonical payload;
- validates EvidenceSegmentV2;
- recomputes RFC 8785 JCS;
- compares exact wire canonical bytes;
- recomputes SHA-256 and byte length;
- compares descriptor semantics.

## Pre-storage idempotency recovery

A previously accepted request is looked up **before a second object upload**.

This matters if:

- the original HTTP response was lost;
- signing failed after metadata acceptance;
- signature persistence failed;
- the package was later closed to new evidence;
- the EvidenceProfile maximum changed later.

If the same principal/package/clientRequestId already identifies the same
descriptor, the exact existing pending/signed receipt is recovered. No new
acceptance time or receipt ID is minted.

New evidence still respects the package's current `accepts_evidence` and size
policy.

## Atomic chain reservation

For a new segment, `pisac_evidence_reserve` locks the package row
`FOR UPDATE`, then under that lock:

1. validates server document/profile context;
2. checks F1 owner defense-in-depth;
3. checks idempotency again;
4. checks current predecessor hash;
5. mints receipt ID and acceptance time;
6. inserts `pending_signature` metadata;
7. advances package head.

The metadata transition and head advance commit together.

## Storage / metadata failure boundary

The ordering remains:

~~~text
private object write
   -> atomic metadata reserve
   -> KMS/HSM signature
   -> signature attachment
~~~

If Storage succeeds and metadata fails, an unreferenced object may remain but
there is no receipt. A future cleanup job will delete aged unreferenced objects.

If metadata succeeds and signing fails, the row remains
`pending_signature`; retry finishes the same acceptance.

## Authorization

R2/OpenFGA remains the target.

R4's live shadow authorization adapter is deliberately F1-only:

~~~text
append_evidence
+ evidence_package
+ higher-consistency
+ current personal-workspace owner
~~~

Every other action is denied.

It exists only to prove production persistence before the institutional ReBAC
runtime is deployed.

## Live data state

At the R4 audit point the live Pisač project contains:

- 0 auth users;
- 0 workspaces;
- 0 projects;
- 0 documents;
- 0 EvidencePackages;
- 0 evidence acceptances.

No real student evidence has been uploaded.

Because there is no authenticated fixture, R4 does **not** insert synthetic
rows into Supabase Auth merely to manufacture a live concurrency test.

Concurrency is instead covered by:

- the executable Gateway/repository adversarial corpus;
- package-row `FOR UPDATE` serialization in the live SQL;
- unique idempotency and segment constraints.

A live two-session concurrency test becomes mandatory before the shadow feature
flag is enabled for any authenticated pilot user.

## Live rollback adversarial test

After applying the shadow migrations, R4 ran a real PostgreSQL state-machine
test inside one `BEGIN ... ROLLBACK` transaction using synthetic IDs only.

It exercised:

- package provisioning for the document owner;
- owner ALLOW and unrelated-principal DENY;
- initial idempotency lookup;
- first atomic reserve;
- duplicate-pending reserve;
- idempotency-key conflict;
- wrong-predecessor chain conflict;
- valid next-segment reserve;
- signature attachment;
- signed-receipt lookup;
- recovery lookup after package closure;
- rejection of new evidence after package closure.

The first run found a real PL/pgSQL defect: `COALESCE` had been incorrectly
schema-qualified as `pg_catalog.coalesce`. PostgreSQL permits the function
definition to be stored but fails when that expression executes. Migration
`20261003082618` corrects every affected Evidence RPC. The full rollback test
then passed.

After rollback, the live project again contained:

~~~text
pisac_evidence.packages     = 0
pisac_evidence.acceptances  = 0
~~~

This is now a mandatory pattern for future trust-plane migrations: creation
success is not sufficient evidence; critical RPCs must be invoked against a
synthetic rollback fixture before activation.

## Advisor state

After R4 shadow migrations:

- Evidence foreign-key index advisor findings were fixed;
- Evidence RLS-no-policy INFO findings were removed with explicit deny policies;
- no new Evidence security WARN remains;
- unused-index INFO on an empty database is expected and is not removed merely
  to silence the advisor.

## Environment contract

Production shadow activation requires, at minimum:

~~~text
PISAC_EVIDENCE_SHADOW_ENABLED=1
NEXT_PUBLIC_SITE_URL=https://...
PISAC_EVIDENCE_STORAGE_BUCKET=...
PISAC_EVIDENCE_SHADOW_PROFILE_ID=...
PISAC_EVIDENCE_SHADOW_MAX_PAYLOAD_BYTES=...
SUPABASE_SECRET_KEY=sb_secret_...
PISAC_EVIDENCE_SIGNER_MODE=azure-key-vault
PISAC_EVIDENCE_AZURE_KEY_URL=https://<vault>/keys/<name>/<version>
PISAC_EVIDENCE_SIGNING_KEY_ALIAS=...
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
~~~

For Azure-hosted deployments, Managed Identity / workload identity should
replace a long-lived client secret when the hosting environment supports it.

## Deliberately not activated

R4 does not yet enable:

- Evidence capture upload from the editor;
- automatic EvidencePackage creation;
- submission gating;
- mentor evidence reads;
- public proof verification;
- Tessera transparency publication;
- witness checkpoints;
- RFC3161/eIDAS timestamping;
- C2PA;
- raw-evidence retention/deletion jobs.

Those remain separate gates.

## Next gate

R5 can begin only after R4 code/CI is green.

Recommended R5 sequence:

1. create private Storage bucket with server secret;
2. provision versioned KMS/HSM signing key;
3. run authenticated synthetic vertical slice;
4. run real two-session concurrency/adversarial matrix;
5. keep user-facing capture disabled;
6. add transparency/Tessera publication as an asynchronous layer;
7. prove inclusion/consistency verification before any assurance badge uses it.
