# Pisač Architecture Decision Register vNext

**Purpose:** prevent greenfield research, current implementation and future target from drifting into different products.

## Status vocabulary

- **KEEP** — current architecture is the target unless new evidence overturns it.
- **EVOLVE** — keep semantics, improve implementation/boundary.
- **ADD** — target capability not yet implemented.
- **PROVE** — candidate looks stronger but requires a spike/benchmark before adoption.
- **WATCH** — standard/technology is promising but not mature or required enough to adopt now.
- **DEFER** — valid future capability, deliberately not in near-term path.
- **REJECT** — do not adopt under current requirements.

## Decision table

| ID | Area | Current | vNext decision | Status | Adoption proof / kill criterion |
| --- | --- | --- | --- | --- | --- |
| ADR-VN-001 | Product claim | anti-AI framing appears in historical language | verifiable academic provenance / observed process evidence | EVOLVE | all product surfaces avoid unsupported authorship/AI-absence claims |
| ADR-VN-002 | Editor | Tiptap/ProseMirror | keep Tiptap/ProseMirror | KEEP | replacement must beat structured schema, transaction observability, extension ecosystem and interoperability |
| ADR-VN-003 | Canonical document state | Postgres current document + immutable revisions | regional PostgreSQL | KEEP | replace only if measured requirements cannot be met with regional PostgreSQL |
| ADR-VN-004 | Canonical write | CAS + idempotency | keep explicit CAS; no silent LWW | KEEP | every alternative must pass existing conflict/idempotency fixtures |
| ADR-VN-005 | Local authoring journal | Dexie/IndexedDB | semantic journal remains dedicated; storage engine may evolve | EVOLVE | migration must prove crash/multitab/offline behavior before replacement |
| ADR-VN-006 | Generic local-first state | custom/local scattered stores | PowerSync/SQLite leading candidate | PROVE | reject if it cannot reduce complexity without weakening authorization/conflict semantics |
| ADR-VN-007 | Evidence local storage | multiple related Dexie DBs | converge related evidence lifecycle into transactional evidence store | PROVE | prove migration and atomicity; do not merge authoring durability with evidence durability |
| ADR-VN-008 | Collaboration | asynchronous mentor flow | Yjs only for future working collaboration state | DEFER | adopt only for real simultaneous-editing requirement; never canonical history |
| ADR-VN-009 | Revision vocabulary | generic revision fields in historic domain | explicit documentRevision/objectRevision at new boundaries | EVOLVE | no broad risky rename; enforce in new APIs/contracts |
| ADR-VN-010 | Identity | Supabase + generic IdentityProvider | normalized Principal; federation gateway when multi-IdP complexity justifies it | EVOLVE | direct AAI is fine for pilot; broker introduced only with ≥2 meaningful institutional federation sources |
| ADR-VN-011 | Federation | none | AAI@EduHr / eduGAIN / university SAML/OIDC | ADD | sandbox then production federation tests |
| ADR-VN-012 | Authorization | owner-only RLS / role checks | ReBAC/OpenFGA-style fine-grained authorization | ADD | adversarial cross-user/course/institution suite; high-consistency fail-closed evidence/private checks; revoke proven before access is considered removed; RLS remains defence-in-depth |
| ADR-VN-012A | Enterprise provisioning | none | optional SCIM 2.0 for account/group lifecycle | ADD WHEN REQUIRED | adopt only for institutional directory provisioning; never substitute SCIM groups for academic course truth by default |
| ADR-VN-013 | Academic policy | domain-specific policies planned | separate Policy Engine | KEEP/EVOLVE | do not encode academic policy as access-control tuples |
| ADR-VN-014 | LMS integration | none | LTI 1.3 Advantage first | ADD | certified/reference-platform interoperability tests |
| ADR-VN-015 | Higher-ed SIS integration | generic AcademicSystemProvider / ISVU interest | Edu-API-oriented higher-ed adapter + ISVU fallback | WATCH/ADD | Edu-API maturity/institution support; ISVU used only for missing Croatia-specific facts |
| ADR-VN-016 | OneRoster | not used | do not make higher-ed core dependency | REJECT | reconsider only for a concrete customer with OneRoster as source |
| ADR-VN-017 | Evidence canonicalization | custom canonicalize() | RFC 8785 JCS for new Evidence v2 | ADD | cross-language deterministic test vectors; legacy verifier preserved |
| ADR-VN-018 | Evidence hashing | SHA-256 in local process | SHA-256 over versioned canonical bytes | KEEP/EVOLVE | algorithm agility encoded in schema |
| ADR-VN-019 | Server evidence | none | Evidence Gateway + signed receipts | ADD | threat model + idempotency + authz + storage-failure matrix |
| ADR-VN-020 | Receipt keys | none | KMS/HSM asymmetric signing | ADD | rotation/revocation/public-key verification test |
| ADR-VN-021 | Transparency | hash chains only | external-verifiable append-only tlog | ADD | Tessera/RFC9162-style spike with inclusion + consistency proof |
| ADR-VN-022 | Transparency implementation | none | Tessera/equivalent; never home-grown Merkle implementation | KEEP TARGET | reject candidate if witness/proof/export story is weaker |
| ADR-VN-023 | Trusted time | server timestamps | RFC3161; qualified eIDAS timestamp for EU high assurance | ADD | validate independent timestamp token + EU QTSP trust chain |
| ADR-VN-024 | Raw evidence retention | local-only / incomplete policy | EvidenceProfile + RetentionProfile | ADD | privacy review and deletion tests before server evidence rollout |
| ADR-VN-025 | WORM | none | policy-specific only | DEFER/ADD | never default raw draft retention; final/legal hold use cases only |
| ADR-VN-026 | Final provenance | none | C2PA 2.4 Content Credential | PROVE | DOCX/OOXML spike must validate independently and survive Word compatibility tests |
| ADR-VN-027 | Provenance interchange | custom only | W3C PROV export | ADD LATER | export roundtrip/consumer usefulness before product surface |
| ADR-VN-028 | Learning analytics | custom UI | optional 1EdTech Caliper export | OPTIONAL | no raw evidence leakage; only if institution requests analytics interoperability |
| ADR-VN-029 | DOCX | JS docx subset | dedicated Open XML conversion service for high fidelity | PROVE | golden Word roundtrip/fidelity matrix must beat JS subset |
| ADR-VN-030 | WordReplica | local Word compatibility work | compatibility oracle / golden verifier | KEEP | not canonical serializer |
| ADR-VN-031 | Application architecture | modular monolith | modular monolith | KEEP | split process only at real trust/scale boundary |
| ADR-VN-032 | Microservices | minimal | no governance-per-service decomposition | REJECT | service split requires measurable scaling/security/operational justification |
| ADR-VN-033 | Distributed SQL | PostgreSQL | regional PostgreSQL per tenant home region | REJECT DEFAULT | revisit only for same-tenant active multi-region writes |
| ADR-VN-034 | Regional scale | designed | tenant home-region cells | ADD LATER | region placement/migration/runbook before expansion |
| ADR-VN-035 | Cloudflare Durable Objects | none | possible future per-document realtime coordinator | DEFER | reconsider only if simultaneous collaboration becomes central and Postgres/Yjs coordination is insufficient |
| ADR-VN-036 | Kafka/EventStore | none | not required | REJECT | reconsider only when measured event throughput/consumer topology demands it |
| ADR-VN-037 | Full event sourcing | selective history | selective journals + relational current state | KEEP | no full-system event sourcing |
| ADR-VN-038 | Blockchain | none | no blockchain provenance | REJECT | Merkle transparency + signatures + trusted timestamp already cover requirement with less complexity |
| ADR-VN-039 | Object storage | Supabase/object storage direction | provider-neutral object store | KEEP/EVOLVE | content/evidence lifecycle and retention must be portable |
| ADR-VN-040 | AI runtime | provider-neutral direction | isolated AI Gateway | KEEP/EVOLVE | AI outage must not block core academic workflow |
| ADR-VN-041 | AI evidence | forensic events exist | Assistance Ledger distinct from integrity judgment | KEEP/EVOLVE | final disclosure policy maps to C2PA where applicable |
| ADR-VN-042 | Audit | partial | dedicated security/admin Audit Log | ADD | evidence/audit/telemetry data classes must remain separate |
| ADR-VN-043 | Observability | incomplete | OpenTelemetry-compatible traces/metrics/logs | ADD | production SLO + alert + drill evidence |
| ADR-VN-044 | Backup/DR | incomplete | per-cell PITR + zone HA + residency-safe DR + restore drills | ADD | restore evidence, not configuration screenshots |
| ADR-VN-045 | Control plane | none | global content-free control plane | ADD LATER | no ordinary student text/evidence permitted |
| ADR-VN-046 | Tenant isolation | personal workspace now | tenant_id + ReBAC + RLS; dedicated cell optional enterprise tier | EVOLVE | cross-tenant adversarial tests |
| ADR-VN-047 | Evidence public identifiers | local IDs | opaque/hash-only transparency leaves | ADD | privacy inspection proves no direct PII |
| ADR-VN-048 | Background workflows | ordinary app jobs | simple durable queue first; Temporal only if justified | KEEP TARGET | adopt Temporal only for long-running multi-step durable workflows materially hard to model otherwise |

## Supersession rules

This register supersedes architecture preferences when a newer accepted ADR explicitly references the same decision ID.

Historical implementation documents remain useful evidence of why code exists; they do not override the current target.

## Proof-before-adoption template

Every PROVE decision gets a file or PR section with:

1. hypothesis;
2. current baseline;
3. candidate implementation;
4. fixture/adversarial corpus;
5. correctness result;
6. failure/recovery result;
7. privacy/security impact;
8. interoperability result;
9. operational complexity;
10. migration/rollback plan;
11. adoption or rejection;
12. exact SHA and environment.

## Near-term gates

### Gate VN-EV

Evidence v2 format, server receipt, transparency and timestamp architecture proven with synthetic data.

### Gate VN-C2PA

C2PA OOXML prototype independently validates and passes Word golden compatibility.

### Gate VN-LOCAL

PowerSync/local SQLite candidate is benchmarked against current Dexie behavior.

### Gate VN-AUTHZ

ReBAC authorization model passes cross-user/course/institution adversarial tests.

### Gate VN-LTI

LTI 1.3 launch/context/role integration works against a reference platform without leaking LMS-native schema into core.

## Merge discipline

Do not merge a greenfield replacement directly into production behavior in the same PR that introduces its abstraction.

Preferred sequence:

~~~text
architecture/contract
 -> spike
 -> independent review
 -> shadow adapter
 -> differential tests
 -> migration PR
 -> rollout gate
~~~

This keeps architectural discovery reversible.