# Pisač Reference Architecture vNext

**Status:** TARGET REFERENCE ARCHITECTURE — not an implementation claim  
**Date:** 2026-10-02  
**Scope:** greenfield target + convergence target for the existing Pisač codebase  
**Rule:** no component enters the production path merely because it appears in this document; every replacement still passes proof-before-adoption gates.

## 1. Product definition

Pisač is a verifiable academic writing and provenance platform. It is not an AI detector and it must not present process telemetry as proof of human authorship.

The strongest honest claim the system is designed to support is:

> Pisač can provide cryptographically verifiable evidence that specific document states and observed writing-process segments were recorded, accepted, anchored and linked to a final academic artifact under a defined assurance and retention policy.

The architecture deliberately separates:

- identity from authorization;
- evidence from judgment;
- observed process from claims about human intent;
- local durable state from canonical server state;
- working collaboration state from canonical academic history;
- operational audit from academic evidence;
- institutional policy from access-control relationships;
- final artifact provenance from raw process telemetry.

## 2. Non-negotiable invariants

1. No silent last-write-wins for canonical academic document commits.
2. A document revision and an academic-object revision are different concepts and must remain explicitly named at application boundaries.
3. The server never invents missing authoring history.
4. Restore creates a new canonical transition; it never rewrites history.
5. Evidence receipts never claim that a human physically typed the text or that external AI was absent.
6. AI is not in the availability-critical authoring or submission path.
7. Institution identity assertions do not themselves grant Pisač access.
8. Raw evidence, audit logs, telemetry and analytics are different data classes with different retention rules.
9. The final submitted artifact must be bindable to its provenance without requiring trust in the live Pisač database.
10. Multi-region scale is achieved primarily by tenant home-region placement, not by globally synchronous writes.

## 3. System topology

~~~text
                               GLOBAL CONTROL PLANE
                          (no student document content)

        institution registry / tenant placement / integrations /
        public verification keys / product configuration / billing
                                      |
                    +-----------------+-----------------+
                    |                                   |
                    v                                   v
               EU DATA CELL                         US DATA CELL
               tenant.home_region=eu                tenant.home_region=us
                    |                                   |
        +-----------+-----------+             +---------+---------+
        |                       |             |                   |
  Application Plane      Evidence Trust Plane      Application Plane ...
        |                       |
        v                       v
   PostgreSQL               Evidence Gateway
   Object Storage           Signed Receipts
   Workers/Jobs             Transparency Log
   AuthZ tuples             Trusted Timestamp
        |
        v
      Clients
~~~

Default deployment remains a modular monolith plus narrowly separated trust/worker processes. Governance concepts are not translated into one microservice each.

## 4. Client architecture

### 4.1 Editor

**Target:** Tiptap / ProseMirror remains the preferred editor engine.

Rationale:

- schema-controlled structured documents;
- all document mutations flow through inspectable transactions;
- ProseMirror transformations are naturally compatible with deterministic replay and provenance;
- mature Tiptap integration surface;
- future Yjs collaboration is available without making Yjs the canonical academic history.

Greenfield competitors may still be benchmarked, but replacement requires a material correctness or interoperability advantage, not aesthetic preference.

### 4.2 Local storage is split by semantics

Do not use one generic local database abstraction for every Pisač responsibility.

~~~text
                     CLIENT LOCAL STATE
                            |
          +-----------------+-----------------+
          |                                   |
          v                                   v
  AUTHORING / EVIDENCE                GENERIC APP STATE
  semantic transaction journal        projects metadata
  canonical candidate                 sources metadata
  pending document commits            comments
  process segments                    mentor queue
  evidence upload outbox              institution context
          |                                   |
          v                                   v
  transactional local store            local-first sync layer
  (current Dexie; target SQL             PowerSync candidate
   persistence spike required)          for greenfield generic state
~~~

### 4.3 Local-first decision

Current Pisač Dexie authoring journal is retained until a measured replacement wins.

Greenfield target:

- PowerSync is the leading candidate for generic structured app state because its client reads/writes a local SQLite database and maintains an upload queue.
- PowerSync does **not** become the canonical academic document commit protocol.
- Canonical document commits continue through Pisač domain-specific compare-and-set semantics.
- Evidence payloads do not travel through the generic sync engine.

Candidate experiment must compare current Dexie against PowerSync / SQLite and, where justified, RxDB or PGlite on:

- offline durability;
- crash recovery;
- multi-tab correctness;
- Safari/iOS behavior;
- schema migration;
- queue recovery after rejected writes;
- debugging and observability;
- storage/bundle cost;
- exact preservation of Pisač no-silent-LWW semantics.

### 4.4 Collaboration

Yjs is allowed only as a future **working collaboration state**.

~~~text
Yjs / realtime working state
           |
           v
validated Pisač semantic mutation batch
           |
           v
canonical Postgres document commit
~~~

CRDT convergence must never replace revision semantics used for mentor review, submission, evidence or audit.

## 5. Application plane

### 5.1 Command gateway

All state-changing operations enter through an authenticated application command boundary:

~~~text
request
  -> authentication
  -> fine-grained authorization
  -> academic policy
  -> rights / data governance
  -> validation
  -> domain operation
  -> canonical persistence
  -> audit event
~~~

Do not expose storage primitives as product APIs.

### 5.2 Canonical document service

**Target:** PostgreSQL compare-and-set document persistence.

Required properties:

- server-minted canonical document revision;
- idempotency key scoped to document + actor + client transaction;
- row/stream serialization at the database boundary;
- explicit stale-base response;
- immutable revision records;
- bounded payload validation;
- no direct table path capable of bypassing the commit protocol.

Existing F1 semantics are therefore preserved. The new DocumentRepository port remains the portability boundary; Supabase is an adapter, not the architecture.

### 5.3 Relational database choice

**Default target:** regional managed PostgreSQL.

Do not adopt globally synchronous distributed SQL by default.

Reasoning:

- Pisač writes are naturally tenant/document homed;
- regional databases keep authoring writes low-latency;
- institutional data-residency is easier to explain and verify;
- ordinary managed PostgreSQL already provides zone HA, PITR, read replicas and cross-region DR options;
- distributed SQL region-survival adds cross-region coordination cost to writes and additional operational semantics.

Distributed SQL is reconsidered only if measured requirements demand active writes to the same tenant data from multiple regions.

## 6. Identity, federation and authorization

### 6.1 Normalized Principal

Pisač Core receives one provider-neutral principal:

~~~text
Principal
- pisačPrincipalId
- externalSubject
- issuer
- verified attributes
- affiliations
- authentication context
~~~

The core does not branch on AAI vs Entra vs eduGAIN.

### 6.2 Federation Gateway

Pilot:

- Supabase/local account where appropriate;
- direct AAI@EduHr integration is acceptable.

Multi-institution/global target:

~~~text
AAI@EduHr ----\
eduGAIN -------\
University SAML ---> Federation Gateway ---> normalized Principal ---> Pisač
University OIDC ---/
Entra ID ----------/
~~~

SATOSA or an equivalent standards-based broker is a candidate implementation. It is not mandatory until multiple serious institutional identity providers justify an operational broker.

### 6.4 Enterprise identity lifecycle (optional SCIM 2.0)

For institutions that require central account/group provisioning from enterprise directories, expose an optional SCIM 2.0 service boundary (RFC 7643 / RFC 7644).

SCIM is for lifecycle provisioning such as:

- creating/deactivating Pisač institutional identities;
- synchronizing enterprise groups;
- updating directory attributes under an explicit mapping.

SCIM is **not** the source of truth for academic enrollment unless an institution explicitly models that information there. Course/assignment context remains LTI/Edu-API/SIS territory.

A deprovisioned external account triggers relationship re-evaluation/revocation; it does not directly rewrite academic history.

### 6.5 Fine-grained authorization

Owner-only RLS is not sufficient for the target product.

Target access model is relationship-based authorization (ReBAC), conceptually OpenFGA-style:

~~~text
institution:fpzg#member@user:daniel
course:cp#teacher@user:mentor
assignment:a1#course@course:cp
project:p1#student@user:daniel
project:p1#mentor@user:mentor
document:d1#project@project:p1
~~~

Operations such as read-private-draft, read-shared-revision, read-evidence, comment, request-revision, submit and export-evidence are evaluated against relationships and conditions.

PostgreSQL RLS remains defence-in-depth and tenant containment. It is not the complete authorization model.

#### Authorization consistency and revocation

Security-critical access cannot rely on stale authorization cache state.

For operations such as READ_PRIVATE_DRAFT, READ_EVIDENCE, EXPORT_EVIDENCE and privileged administration:

- request the authorization service's higher/strongest available consistency mode;
- fail closed when the authorization service cannot establish the required relationship;
- never allow a stale positive cache entry to preserve evidence access after an intended revocation.

Relationship lifecycle is ordered for safety:

~~~text
GRANT:
domain grant PENDING
 -> write authorization relationship
 -> verify visibility
 -> grant ACTIVE

REVOKE:
mark relationship REVOKING / stop issuing new share capability
 -> remove authorization relationship
 -> verify denial using high-consistency check
 -> mark domain grant REVOKED
~~~

A grant may be delayed by an authorization outage. A revoke must prefer temporary denial over continued sensitive access.

#### Break-glass access

There is no hidden content-reading superadmin role.

Exceptional support/security access requires:

- an explicit BREAK_GLASS relationship/capability;
- step-up authentication;
- a structured reason/ticket reference;
- narrow resource scope;
- automatic expiration;
- immutable audit event;
- optional institution/student notification according to incident policy.

Normal support tooling operates on diagnostics and metadata without raw document/evidence access.

If an outbox/projection is used between application state and an external ReBAC store, it may not be the only enforcement mechanism for immediate revocation of evidence/private-content access.

### 6.6 Academic Policy Engine is separate

Access control answers **who may perform an operation**.

Academic policy answers questions such as:

- is AI assistance permitted for this assignment?
- which evidence profile is required?
- may a mentor view deleted text?
- is a source recheck required before submission?
- what retention applies?
- what constitutes a valid submission package?

Do not collapse these into the authorization relationship graph.

## 7. Higher-education integration plane

### 7.1 Standard-first hierarchy

Target order:

1. **LTI 1.3 / LTI Advantage** — LMS launch, context, roles, roster via NRPS, assignment/grade services where appropriate, deep linking.
2. **Edu-API** — higher-education enterprise data exchange when the standard and institutional implementation are mature enough.
3. **AAI@EduHr / eduGAIN** — federated identity.
4. **ISVU adapter** — Croatia-specific SIS integration where standards do not provide the required facts.
5. Vendor-specific adapters only as narrowly scoped fallbacks.

ISVU remains authoritative for the Croatian administrative facts it owns; it never becomes the Pisač data model.

### 7.2 Existing AcademicSystemProvider

The current generic AcademicSystemProvider introduced in the Foundation remains a compatibility facade, but the target architecture separates protocol responsibilities:

- LtiPlatformAdapter;
- HigherEdDataAdapter (Edu-API-style);
- LegacySisAdapter (ISVU and other SIS-specific mappings).

Do not refactor the existing port merely for naming. Replace it only when the first real integration demonstrates the better boundary.

## 8. Evidence Trust Plane

This is a separate trust boundary from ordinary application persistence.

~~~text
Editor transactions
       |
       v
Evidence Segment Builder
       |
       v
local durable Evidence Outbox
       |
       v
Evidence Gateway
  - authenticate
  - authorize
  - validate schema/version
  - verify canonical bytes/hash
  - verify predecessor
  - enforce size/rate/retention profile
  - idempotency
       |
       +---------------------+
       |                     |
       v                     v
encrypted object        Postgres receipt
storage payload         metadata
       |                     |
       +----------+----------+
                  v
           KMS/HSM signature
                  |
                  v
          signed server receipt
                  |
                  v
    append receipt digest to transparency log
                  |
                  v
      signed checkpoint + witnesses
                  |
                  v
       trusted time-stamp on checkpoint
~~~

Detailed normative rules live in EVIDENCE_TRUST_MODEL_VNEXT.md.

### 8.1 Evidence canonicalization

New evidence schema versions use RFC 8785 JSON Canonicalization Scheme (JCS) before SHA-256 hashing.

Existing v1/custom-canonicalized evidence remains permanently verifiable under its declared schema/canonicalization version. Never silently reinterpret old evidence using a new canonicalizer.

### 8.2 Transparency

Do not implement a custom Merkle tree.

Target implementation is a standards-compatible append-only transparency log using Tessera or an equivalent production-ready RFC 9162/C2SP-style system.

The transparency log receives compact receipt digests / opaque identifiers only — never raw student text or directly identifying personal data.

### 8.3 Trusted time

Assurance tiers:

- Standard: server-observed time + signed receipt;
- Enhanced: transparency inclusion + signed checkpoint;
- EU High Assurance: periodic RFC 3161 timestamp from a trusted TSA, preferably an eIDAS qualified electronic time stamp from an EU Trusted List QTSP, applied to checkpoint roots rather than individual keystrokes.

### 8.4 Signing keys

Production evidence and final-artifact signing keys live in managed KMS/HSM, not environment variables.

Signing API is provider-neutral:

~~~text
SigningKeyProvider
  sign(bytes, keyVersion)
  publicKey(keyVersion)
  keyStatus(keyVersion)
~~~

Every receipt records key ID/version and signature algorithm. Key rotation must not invalidate historical verification.

## 9. Evidence and privacy profiles

There is no universal 'record everything forever' mode.

Each assignment/institution chooses an EvidenceProfile and RetentionProfile.

| Profile | Server evidence | Typical use |
| --- | --- | --- |
| Minimal | canonical checkpoints + hashes/receipts | low-risk coursework |
| Standard | semantic mutation batches + signed receipts | ordinary assessed work |
| Review | replay-capable process segments for a bounded review window | thesis / mentor workflow |
| High Assurance | Review + transparency inclusion + trusted/eIDAS timestamp + stronger session controls | high-stakes submission |
| Controlled | managed institutional environment/device controls in addition to High Assurance | future controlled examinations |

Profiles control:

- event granularity;
- deleted-text capture;
- server upload;
- mentor visibility;
- retention duration;
- raw payload deletion;
- transparency anchoring;
- timestamp level;
- submission gate requirements.

Long-lived cryptographic proofs may remain after raw evidence deletion where the lawful retention policy allows, but proofs must avoid embedding unnecessary personal data.

## 10. Evidence vs audit vs telemetry

### Evidence

Observed process and provenance relevant to an academic artifact.

### Audit

Security/administrative activity: mentor opened evidence, admin changed policy, role changed, export occurred, retention hold applied.

### Telemetry

Operational metrics, traces and failures. Must not contain raw academic content by default.

### Analytics

Aggregated learning/product signals. Optional Caliper export can be supported for institutional interoperability.

These stores and retention schedules stay separate.

## 11. Provenance and final artifacts

### 11.1 Internal model

Pisač retains its domain-specific provenance/evidence representation because generic standards are not precise enough for forensic replay and academic revision semantics.

### 11.2 W3C PROV export

Provide a projection/export:

~~~text
Student / Institution     -> Agent
Writing session           -> Activity
Canonical revision        -> Entity
Submission                -> Entity
AI assistance interaction -> Activity / related entity
~~~

W3C PROV is an interoperability view, not the canonical internal store.

### 11.3 C2PA final artifact

Target final DOCX/PDF submission can carry a C2PA Content Credential.

Desired C2PA content:

- artifact hard binding;
- high-level creation/edit actions;
- canonical Pisač document revision;
- submission identifier;
- AI disclosure using standard C2PA AI-disclosure structures where applicable;
- repository/provenance receipt or a namespaced Pisač assertion pointing to the evidence checkpoint/root and verification endpoint;
- timestamp/signature chain.

Raw detailed replay is not embedded into the final document.

Important implementation gate: the C2PA specification supports OOXML embedding, but current open-source C2PA SDK format support must be proven for DOCX before adoption. The first spike must build, sign, reopen and independently validate an OOXML artifact without damaging Word compatibility.

## 12. Document interoperability service

Long-term high-fidelity DOCX is separated from the web application process:

~~~text
Pisač canonical document
       |
       v
Document Conversion Service
       |
       +--> DOCX (Open XML)
       +--> PDF
       +--> accessibility/fidelity report
       +--> C2PA packaging/signing
~~~

Candidate production implementation: .NET + Open XML SDK for high-fidelity OOXML, with WordReplica retained as compatibility/golden-verification infrastructure rather than canonical serializer.

JavaScript docx export remains acceptable for the explicitly supported F1 subset.

## 13. Research, rights, search and citation plane

### 13.1 Canonical research objects

Pisač stores a provider-neutral research model:

~~~text
SourceRecord
  -> SourceVersion
       -> metadata
       -> content/blob reference
       -> rights/provenance
       -> derived text/chunks
       -> embeddings/search projections
~~~

A DOI/provider record is evidence about metadata, not a universal truth source. Provider-native payloads are preserved where useful but do not become the canonical domain model.

### 13.2 Operation-level Rights Engine

Rights are evaluated per operation, not as one boolean on a source.

Examples:

- LOCAL_PARSE;
- STORE_PRIVATE_COPY;
- EXTRACT_TEXT;
- EMBEDDING;
- SEND_TO_EXTERNAL_AI;
- SHARE_WITH_MENTOR;
- EXPORT_EXCERPT;
- PUBLISH_PROVENANCE_METADATA.

Possible decisions:

~~~text
ALLOW
ALLOW_WITH_CONDITIONS
REVIEW
DENY
UNKNOWN
~~~

UNKNOWN does not silently become ALLOW for external processing.

Rights decisions are versioned and explainable: source/version + operation + rule/policy basis + time.

### 13.3 Search / RAG

Initial search stack remains deliberately simple:

- PostgreSQL full-text search;
- pgvector where semantic retrieval is justified;
- hybrid lexical/vector retrieval;
- fusion/reranking only after the authorized candidate set is known.

Security order is mandatory:

~~~text
Principal
 -> Authorization
 -> Rights
 -> permitted SourceVersions
 -> lexical/vector retrieval
 -> fusion/rerank
 -> bounded context
 -> AI Gateway
~~~

Never retrieve globally, send content to a model, and filter permissions afterward.

A dedicated search engine/vector service is adopted only when measured corpus/query scale or ranking quality exceeds what the regional PostgreSQL cell can provide.

### 13.4 Citation engine

Citation formatting is deterministic infrastructure, not an LLM task.

Target:

- canonical citation/source object model;
- CSL/citeproc-based formatting;
- institution/faculty styles as configuration/profile;
- explicit provenance of imported metadata;
- validation separate from formatting.

An LLM may help explain or suggest metadata corrections, but it does not become the citation formatter or source-verification authority.

### 13.5 Research provider adapters

Federated adapters may include Crossref, DataCite, OpenAlex, Semantic Scholar, Europe PMC, Unpaywall and Zotero where useful.

No provider is treated as a universal truth source. Merge logic retains provider/source provenance and conflicts rather than silently choosing one value.

## 14. AI plane

AI remains optional infrastructure:

~~~text
AIActionRequest
   -> authorization
   -> academic policy
   -> rights
   -> data-governance filter
   -> eligible provider/model routes
   -> context assembly
   -> model
   -> output validation
   -> Assistance Ledger
~~~

Requirements:

- provider-neutral model registry;
- institutional allow/deny and region policies;
- task-specific routing;
- explicit cost/latency budgets;
- AI failure cannot block writing, saving, replay or submission;
- AI assistance records are distinct from AI-presence judgments;
- final artifact may expose relevant disclosure through C2PA.

## 15. Multi-tenancy and regionalization

### 15.1 Tenant hierarchy

~~~text
Institution
  -> Membership
  -> Course
  -> Assignment
  -> ProjectContext
       -> Personal/Student Project
~~~

Personal Pisač remains a valid mode. Institution context is attached rather than replacing the user's personal workspace concept.

### 15.2 Home region

Each institutional tenant has a home region:

~~~text
tenant.home_region = eu-central
~~~

Student content, canonical documents, evidence payloads and authorization data remain in the home-region cell unless an explicit lawful migration is performed.

### 15.3 Global control plane

May contain:

- tenant identity and region placement;
- integration configuration metadata;
- public signing keys;
- product/feature configuration;
- licensing/billing;
- global service discovery.

Must not contain ordinary student document bodies or raw process evidence.

### 15.4 Isolation tiers

Default shared regional cell:

- tenant_id on application tables;
- ReBAC relationships;
- RLS tenant containment;
- encryption at rest;
- per-tenant quotas.

Dedicated database/storage cell is an enterprise/compliance tier, not the default one-database-per-university model.

## 16. Object storage and immutability

Object storage holds:

- evidence segment payloads;
- imported source files;
- export artifacts;
- final submissions;
- large immutable snapshots.

Use content hashes and deduplication where privacy boundaries permit.

WORM/object-lock is **policy-specific**, not universal:

- appropriate for final submissions, legal holds or specific regulated retention;
- inappropriate as a default for every deleted draft because privacy and storage-limitation obligations still apply.

## 17. Background jobs

Keep asynchronous work outside request/commit critical paths:

- document conversion;
- OCR/parsing;
- C2PA generation/validation;
- transparency-log publication;
- trusted timestamp requests;
- source metadata refresh;
- notifications;
- retention deletion;
- backup verification;
- AI workloads.

A simple durable queue is the default. Temporal-class workflow infrastructure is justified only when long-running, multi-step institutional workflows with retries/human approval become materially hard to model with the normal job system.

## 18. Observability and operations

Use OpenTelemetry-compatible traces/metrics/logs.

Minimum SLO domains:

- authoring local durability;
- canonical sync acknowledgment;
- evidence upload/anchor lag;
- authorization availability;
- submission finalization;
- artifact verification;
- identity federation;
- background-job backlog.

Security-sensitive audit events are immutable domain records, not merely application logs.

No raw student document text in ordinary logs.

## 19. Backup and disaster recovery

Per regional cell:

- PostgreSQL PITR;
- zone-redundant HA where supported;
- cross-region replica/backup appropriate to residency rules;
- object-storage versioning/replication where policy allows;
- transparency-log checkpoint backup and public verification material;
- KMS/HSM key lifecycle and documented disaster procedure;
- regular restore drills.

DR target is explicitly defined per service. A green dashboard is not evidence of recoverability; restore drills are required.

Tenant failover must not silently move regulated data outside the permitted jurisdiction.

## 20. Security boundaries

### 20.1 Key and secret separation

Do not use one key hierarchy for every cryptographic purpose.

At minimum separate:

- application secrets/session credentials;
- data-encryption key-encryption keys;
- evidence-receipt signing keys;
- transparency-log/checkpoint signing keys;
- final C2PA signing credentials.

Raw evidence objects use provider-standard encryption at rest plus regional KMS-backed envelope encryption when the evidence profile requires application-managed protection. Signing private keys are non-exportable KMS/HSM keys where supported.

Keys are region-scoped by default. Enterprise customer-managed keys may be offered as an isolation tier only when lifecycle, recovery and revocation semantics are fully defined.

A compromise of an application runtime credential must not automatically yield the long-term receipt-signing key.

Secrets are held in a managed secret system and never shipped in client bundles.

### 20.2 Trust boundaries

High-value boundaries are separated even inside the modular monolith:

1. AuthN / federation.
2. AuthZ relationships.
3. Academic policy.
4. Canonical document commit.
5. Evidence ingest/trust.
6. Document parser/converter sandbox.
7. AI provider gateway.
8. Admin/support tooling.

Service-role credentials never reach browsers. Parser and AI worker identities have least privilege and no broad production database access.

Do not invent custom encryption primitives. Provider KMS/HSM and established envelope-encryption patterns are the default.

### 20.3 Protocol and schema evolution

Offline clients make backwards compatibility a correctness requirement, not a convenience.

Rules:

- every durable client/server payload declares a schema/protocol version;
- Evidence schemas are immutable once receipts exist; new meaning requires a new version;
- server changes follow expand -> migrate -> contract rather than destructive same-release changes;
- local database migrations are explicit and recoverable;
- an offline client reconnecting after a long period is either upgraded/migrated safely or rejected with a recoverable upgrade-required state;
- unknown enum/status/schema values fail closed when guessing could alter academic state;
- minSupportedClientVersion and compatibility windows are explicit deployment configuration;
- canonical document commits are validated by the current server regardless of client version;
- no server deploy may reinterpret already-persisted bytes under changed semantics.

Compatibility tests include at least N-1 clients and any still-supported long-offline client version against the current server.

## 21. Target component map

| Capability | Target choice | Status |
| --- | --- | --- |
| Editor | Tiptap / ProseMirror | KEEP |
| Canonical document DB | regional PostgreSQL | KEEP |
| Canonical commit | explicit CAS + idempotency | KEEP |
| Generic local-first app state | PowerSync/SQLite candidate | PROVE |
| Authoring semantic journal | dedicated transactional local store | KEEP/EVOLVE |
| Collaboration | Yjs working state only | DEFER |
| Fine-grained authorization | ReBAC / OpenFGA semantics | ADD |
| Defence-in-depth data isolation | PostgreSQL RLS | KEEP |
| Academic policy | dedicated Policy Engine | KEEP/EVOLVE |
| Identity | Federation Gateway + normalized Principal | ADD WHEN NEEDED |
| Croatian identity | AAI@EduHr | ADD |
| Enterprise identity provisioning | SCIM 2.0 (optional) | ADD WHEN REQUIRED |
| LMS integration | LTI 1.3 Advantage | ADD |
| Higher-ed SIS standard | Edu-API | WATCH/ADD |
| Croatia SIS fallback | ISVU adapter | ADD LATER |
| Evidence canonicalization | JCS RFC 8785 + SHA-256 for v2 | ADD |
| Evidence receipt signing | KMS/HSM asymmetric signatures | ADD |
| Transparency log | Tessera / RFC9162-style | ADD |
| External trusted time | RFC3161; eIDAS qualified timestamp for high assurance | ADD |
| Final artifact provenance | C2PA 2.4 | PROVE |
| Provenance interchange | W3C PROV export | ADD LATER |
| Learning analytics interchange | Caliper optional export | OPTIONAL |
| High-fidelity DOCX | isolated Open XML conversion service | PROVE |
| AI | isolated provider-neutral gateway | KEEP/EVOLVE |
| Global data model | tenant home-region cells | ADD WHEN SCALE REQUIRES |
| Distributed SQL | no default adoption | REJECT FOR NOW |
| Kafka/full event sourcing | no default adoption | REJECT FOR NOW |
| Blockchain provenance | no adoption | REJECT |

## 22. Critical end-to-end flows

### 22.1 Student authoring

~~~text
edit -> ProseMirror transaction
     -> atomic local authoring transaction
          - canonical candidate
          - pending semantic commit
          - local sequence
          - sync state
          - optional evidence segment/outbox
     -> LOCAL_DURABLE
     -> canonical server CAS
     -> ACK / explicit conflict
     -> SYNCED
~~~

### 22.2 Evidence anchoring

~~~text
local verified segment
 -> JCS canonical bytes + SHA-256
 -> authenticated evidence upload
 -> server revalidation
 -> object storage + receipt metadata
 -> KMS/HSM signed receipt
 -> transparency leaf digest
 -> signed/witnessed checkpoint
 -> periodic trusted timestamp
 -> inclusion proof available
~~~

### 22.3 Mentor review

~~~text
student shares exact revision
 -> ReBAC grants mentor relationship
 -> mentor sees only permitted revision/evidence profile
 -> ReviewCoverage pins objectRevision + binding
 -> later student change invalidates exact coverage
 -> student/mentor next-action projection
~~~

### 22.4 Submission

~~~text
submission request
 -> authorization
 -> academic policy gate
 -> required evidence anchors confirmed
 -> canonical revision frozen as submission snapshot
 -> final DOCX/PDF generated
 -> C2PA credential binds artifact to provenance anchor
 -> final artifact stored under submission retention policy
 -> receipt returned to student/institution
~~~

## 23. What Pisač must never claim

Pisač does not claim:

- that a browser event proves a physical key press;
- that the authenticated student was the only person near the device;
- that a second device or external AI was absent;
- that a cryptographically valid history proves academic integrity;
- that a source supports a claim merely because the source was attached;
- that an AI model output is authoritative.

Product language uses:

- observed process;
- verified internal consistency;
- server-anchored evidence;
- provenance;
- declared/recorded assistance;
- exact revision reviewed;
- evidence available / unavailable / incomplete.

## 24. Greenfield vs current code

The existing codebase is not discarded. It is the executable semantic baseline against which greenfield candidates are tested.

Migration rule:

~~~text
candidate
 -> spike
 -> same fixture/adversarial corpus
 -> correctness test
 -> failure/rollback test
 -> privacy/threat-model review
 -> operational review
 -> migration design
 -> shadow/differential validation
 -> adoption or rejection
~~~

No big-bang rewrite.

## 25. Immediate implementation sequence

### R0 — Canonical architecture

- merge this reference architecture and decision register;
- keep large new architecture-changing features paused until their target boundary is proven.

### R1 — Evidence format v2 spike

- RFC 8785 JCS canonicalization;
- versioned EvidenceSegment envelope;
- SHA-256 vectors;
- backward-verification fixtures for current local process bundles;
- no server change yet.

### R2 — Evidence Trust Plane spike

- provider-neutral receipt-signing contract;
- local/dev signer;
- Tessera-compatible transparency spike;
- inclusion/consistency verification;
- RFC3161/eIDAS timestamp integration test against synthetic checkpoint;
- no real student data.

### R3 — C2PA / OOXML spike

- generate canonical test DOCX;
- embed C2PA 2.4 manifest following OOXML rules;
- include synthetic academic provenance anchor;
- validate independently;
- open/resave in Microsoft Word golden test;
- prove no content corruption before adoption.

### R4 — Local-first benchmark

- current Dexie vs PowerSync/SQLite on generic structured state;
- crash/offline/multitab/Safari matrix;
- retain custom canonical document CAS regardless unless evidence proves otherwise.

### R5 — Authorization model

- define canonical relationships/actions;
- implement ReBAC authorization port;
- adversarial cross-student/cross-course/cross-institution matrix;
- retain RLS as a second line of defence.

### R6 — Institutional integration

- LTI 1.3 launch spike first;
- AAI federation pilot;
- Edu-API compatibility mapping;
- ISVU adapter only for missing Croatian administrative facts.

## 26. Sources and standards baseline

Primary references for this architecture:

- ProseMirror guide: https://prosemirror.net/docs/guide/
- PowerSync client architecture: https://docs.powersync.com/architecture/client-architecture
- PowerSync consistency: https://docs.powersync.com/architecture/consistency
- RFC 8785 JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785
- RFC 9162 Certificate Transparency v2: https://www.rfc-editor.org/rfc/rfc9162
- RFC 3161 Time-Stamp Protocol: https://www.rfc-editor.org/rfc/rfc3161
- Tessera: https://transparency.dev/
- C2PA 2.4 specification: https://spec.c2pa.org/specifications/specifications/2.4/
- W3C PROV: https://www.w3.org/TR/prov-overview/
- 1EdTech LTI 1.3 / Advantage: https://www.1edtech.org/standards/lti
- 1EdTech Edu-API: https://www.1edtech.org/standards/edu-api
- 1EdTech Caliper Analytics: https://www.1edtech.org/standards/caliper
- AAI@EduHr: https://www.aaiedu.hr/
- eduGAIN: https://edugain.org/
- OpenFGA documentation: https://openfga.dev/docs
- Citation Style Language: https://citationstyles.org/
- RFC 7643 / RFC 7644 SCIM 2.0: https://www.rfc-editor.org/rfc/rfc7643 and https://www.rfc-editor.org/rfc/rfc7644
- EU Trusted List/QTSP information: https://digital-strategy.ec.europa.eu/en/policies/eu-trusted-lists
- GDPR Article 5: https://eur-lex.europa.eu/eli/reg/2016/679/oj

## 27. Final architecture judgment

The best target is **not** a maximally distributed, microservice-heavy system.

It is a deliberately layered system in which:

- PostgreSQL owns authoritative academic state;
- local-first technology improves user availability without owning academic truth;
- exact document CAS preserves review/submission semantics;
- a separate Evidence Trust Plane upgrades observed process into externally verifiable provenance;
- open standards handle federation, LMS integration and final-artifact provenance;
- raw evidence is privacy-bounded while cryptographic proofs are independently verifiable;
- institutional growth happens through tenant home-region cells, not global synchronous writes;
- greenfield improvements replace current code only after differential proof.

This architecture optimizes for correctness, trust, interoperability and long-term evolvability rather than for the number of technologies used.