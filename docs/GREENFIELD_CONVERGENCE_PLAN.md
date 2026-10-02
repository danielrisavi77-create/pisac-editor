# Pisač Greenfield Convergence Plan

**Goal:** build the best possible Pisač without either protecting legacy code by default or throwing away working, tested semantics.

## 1. Operating model

Two engineering tracks converge into one product:

~~~text
TRACK A — GREENFIELD                  TRACK B — CURRENT PRODUCT
best architecture from first          executable baseline
principles + current standards         real fixtures + CI + pilot behavior
        |                                      |
        +------------------+-------------------+
                           v
                    CONVERGENCE GATE
                           |
              adopt only proven improvements
                           v
                         MAIN
~~~

Greenfield does not get authority merely because it is newer. Current code does not get authority merely because it already exists.

## 2. Convergence states

Every architecture area is tracked as:

~~~text
CURRENT
 -> GREENFIELD CANDIDATE
 -> SPIKE
 -> MEASURED
 -> DECISION
 -> SHADOW / COMPATIBILITY
 -> MIGRATION
 -> VERIFIED
~~~

Rejected candidates are documented so the same debate is not repeated without new evidence.

## 3. Workstream A — Evidence format v2

### Hypothesis

RFC 8785 JCS + explicit schema/canonicalization identifiers provide a safer long-term evidence format than extending the current custom canonicalizer.

### Build

- EvidenceSegmentV2 pure TypeScript contract;
- JCS implementation/library evaluation;
- SHA-256 deterministic vectors;
- cross-runtime vectors where possible;
- legacy v1 verifier preserved untouched;
- conversion/projection utilities must never relabel v1 digest as v2.

### Acceptance

- identical canonical bytes/hash across test implementations;
- malformed/non-finite/unsupported values fail closed;
- all existing v1 fixtures still verify;
- no production capture switch in the contract PR.

## 4. Workstream B — Evidence Trust Plane

### Hypothesis

Signed server receipts + append-only transparency + trusted checkpoint time provide materially stronger and independently verifiable integrity than database-stored hashes alone.

### Build

1. development receipt signer;
2. provider-neutral SigningKeyProvider;
3. synthetic Evidence Gateway;
4. object-store/metadata failure matrix;
5. Tessera transparency spike;
6. inclusion/consistency verifier;
7. witness/checkpoint spike;
8. RFC3161 timestamp test;
9. eIDAS qualified timestamp provider feasibility/test;
10. portable proof package.

### Acceptance

- attacker with database write access cannot silently replace an anchored receipt without proof failure;
- log leaf has no raw PII/student text;
- historical key rotation verification passes;
- transparency unavailable state is distinguished from server-signed state;
- no real student data used before privacy/retention gate.

## 5. Workstream C — C2PA / final academic artifact

### Hypothesis

C2PA can turn the final DOCX/PDF into a portable verifiable artifact linked to Pisač provenance without embedding private replay data.

### Build

- synthetic DOCX fixture;
- C2PA 2.4 OOXML packaging spike;
- high-level c2pa.actions mapping;
- AI disclosure mapping;
- repository/provenance assertion mapping;
- independent validation;
- Microsoft Word open/save compatibility;
- C2PA PDF path as fallback/parallel artifact.

### Kill criteria

Reject or defer DOCX embedding if:

- current SDK path cannot implement OOXML correctly without a disproportionately fragile custom package writer;
- Word roundtrip corrupts package content/credential unexpectedly;
- credential cannot be independently verified;
- native OOXML signature/C2PA ordering cannot be made deterministic.

Even if DOCX C2PA is deferred, retain external proof package and C2PA PDF exploration.

## 6. Workstream D — Local-first baseline challenge

### Hypothesis

PowerSync/SQLite can reduce custom synchronization and multi-tab complexity for generic application state while the authoring journal keeps domain-specific CAS semantics.

### Baseline

Current Dexie implementation is the control.

### Candidate

PowerSync JS/Web + local SQLite for a bounded set of generic entities:

- project metadata;
- source metadata;
- mentor comments/test fixtures;
- institution context.

Do not put canonical document commits or evidence payloads in the first spike.

### Test matrix

- offline create/update;
- crash during write;
- reconnect;
- rejected backend mutation;
- multi-tab;
- Safari/iOS;
- Chrome/Edge;
- storage upgrade;
- 10k/100k local rows;
- sync cancellation;
- auth expiry;
- tenant filter changes;
- bundle/startup impact.

### Adoption rule

Adopt only where it deletes more correctness-sensitive code than it adds and does not weaken explicit failure semantics.

## 7. Workstream E — Authorization

### Hypothesis

ReBAC models Pisač institutional sharing/mentoring more safely than expanding owner-only RLS into a web of ad-hoc policies.

### Canonical relationship model spike

Resources:

- institution;
- course;
- assignment;
- project;
- document;
- submission;
- evidence package.

Relations:

- member;
- teacher;
- assistant;
- student;
- mentor;
- co_mentor;
- reviewer;
- owner;
- institution_admin;
- auditor.

Actions:

- read_private_draft;
- read_shared_revision;
- read_evidence;
- comment;
- request_revision;
- mark_reviewed;
- submit;
- finalize_submission;
- export_evidence;
- administer_policy.

### Adversarial matrix

- Student A cannot read Student B private project;
- mentor sees only assigned/shared project;
- course teacher does not automatically see private drafts unless policy/relationship grants it;
- revoked mentor loses evidence access;
- evidence/private-content checks use high-consistency/fail-closed mode;
- grant may remain pending if authz propagation fails, but revoke must deny first and only then finalize the domain relationship;
- support operator has no content access by default;
- institution admin powers are explicit, not implied by tenancy;
- cross-institution IDs cannot collide into access.

### Implementation

Evaluate OpenFGA first. A temporary Postgres-backed adapter with identical semantics is acceptable if it reduces pilot infrastructure, but authorization model and tests remain vendor-neutral.

## 8. Workstream F — LTI 1.3

### Goal

Prove Pisač can launch as an external Tool from an LMS without custom LMS schemas leaking into core.

### Spike

- OIDC third-party login initiation;
- signed LTI launch validation;
- issuer/client/deployment registration;
- normalized course/user/role context;
- NRPS roster read where authorized;
- Deep Linking if Pisač creates assignment/resource links;
- AGS only if returning grade/status is a real requirement.

### Acceptance

- replay/nonce/issuer/audience validation;
- multiple LMS deployments do not collide;
- roles map to Pisač relationships, not direct privileges;
- minimal attribute collection.

## 9. Workstream G — AAI / federation

### Pilot

Direct AAI@EduHr SAML/OIDC integration against sandbox, with exact attribute-purpose documentation.

### Scale trigger for broker

Introduce federation gateway when at least two material institutional identity ecosystems create duplicated protocol/configuration complexity.

### Broker candidate

SATOSA/equivalent standards-based federation proxy.

### Acceptance

- persistent/stable external subject mapping;
- institution affiliation refresh;
- logout/session behavior understood;
- revoked/changed affiliation does not silently preserve stale Pisač authorization;
- eduGAIN path proven separately from local AAI where required.

### Optional enterprise provisioning

If an institution requires directory-driven lifecycle provisioning, add a separate SCIM 2.0 spike for Users/Groups. SCIM account/group lifecycle is not allowed to silently become the academic enrollment source; LTI/Edu-API/SIS mappings remain explicit.

## 10. Workstream H — DOCX fidelity

### Baseline

Current JS DOCX F1 subset.

### Candidate

Dedicated .NET/Open XML conversion service.

### Corpus

- headings;
- bold/italic;
- lists;
- tables;
- figures/captions;
- footnotes/endnotes;
- citations/bibliography;
- equations;
- comments/revisions;
- page breaks/sections;
- headers/footers;
- Unicode/Croatian diacritics;
- accessibility metadata.

### Acceptance

Define fidelity statuses:

- SUPPORTED_EXACT;
- PRESERVED_EXACT;
- SEMANTIC_EQUIVALENT;
- LAYOUT_EQUIVALENT;
- APPROXIMATED;
- LOSSY;
- BLOCKED.

WordReplica/real Word is the golden verifier where necessary.

## 11. Workstream I — regional cell prototype

Do not build multi-region now. Produce a deployment-ready cell contract.

A cell owns:

- regional Postgres;
- object storage;
- background workers;
- authorization tuples/model cache;
- evidence payload storage;
- evidence gateway/signing key;
- regional transparency log or defined regional shard;
- observability;
- backup/restore.

Control plane owns only routing/configuration/public metadata.

Test future tenant migration as an explicit maintenance operation, not implicit multi-master behavior.

## 12. Current-to-target matrix

| Current component | Target | Action |
| --- | --- | --- |
| Tiptap/ProseMirror | Tiptap/ProseMirror | keep |
| Dexie authoring journal | dedicated transactional authoring store | benchmark before storage-engine change |
| multiple Dexie evidence DBs | consolidated evidence-lifecycle store | design migration after evidence v2 |
| Supabase/Postgres | regional PostgreSQL via repository ports | keep semantics |
| public Supabase RPCs | narrow application/storage adapter boundary | gradually route through repository/application layer |
| owner-only RLS | ReBAC + RLS | add authorization service before institutional mentor backend |
| local process hash chain | v2 JCS segments + signed server anchoring | evolve, preserve v1 verifier |
| no transparency | Tessera-style transparency | add after signed receipt spike |
| no trusted timestamp | RFC3161/eIDAS checkpoint time | add by assurance profile |
| no C2PA | final-artifact Content Credential | spike before adoption |
| generic IdentityProvider | normalized Principal + future federation gateway | evolve without premature broker |
| generic AcademicSystemProvider | LTI / Edu-API / Legacy SIS boundaries | prove on first integrations |
| JS DOCX | high-fidelity conversion service | preserve F1; benchmark Open XML path |
| mentor demo/local persistence | authorized institution mentor workflow | build only after ReBAC + backend evidence boundaries |

## 13. Branch/PR discipline

Recommended branch families:

~~~text
research/vnext-evidence-format
research/vnext-transparency
research/vnext-c2pa-docx
research/vnext-powersync
research/vnext-authz
research/vnext-lti
research/vnext-aai
research/vnext-openxml
~~~

Spikes do not target main production paths by default.

Each spike PR includes:

- exact hypothesis;
- what it is allowed to modify;
- what it must not claim;
- tests/measurements;
- rollback/removal plan;
- final ADOPT / REJECT / DEFER recommendation.

## 14. Immediate priority

Recommended order:

1. Evidence v2 format;
2. ReBAC model;
3. transparency + receipt signing;
4. C2PA OOXML spike;
5. local-first PowerSync benchmark;
6. LTI launch spike;
7. AAI sandbox integration;
8. Open XML service spike;
9. regional cell design validation.

Reason: Evidence and authorization define the trust boundary. C2PA and local-first can then build on a stable trust model. Institutional protocols follow without forcing their schemas into the core.

## 15. No-big-bang rule

At no point is the existing Pisač replaced wholesale.

For each adopted candidate:

~~~text
existing path
   + shadow candidate
   + differential fixtures
   + migration tooling
   + rollback
   -> controlled cutover
~~~

The current product is valuable test infrastructure even when a greenfield component eventually replaces its implementation.