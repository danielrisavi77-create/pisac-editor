# Ports / Adapters boundary for institution-ready Pisač

**Status:** architectural foundation only  
**Scope:** portable application contracts; no institution rollout in this change

## Decision

Pisač remains a modular monolith. The core must not depend directly on Supabase, AAI@EduHr, ISVU, Azure, Moodle or another external provider.

The dependency direction is:

~~~text
UI / server actions
        |
        v
application use cases
        |
        v
application ports
        |
        +---- DocumentRepository
        +---- EvidenceIngestPort
        +---- IdentityProvider
        +---- AcademicSystemProvider
        |
        v
provider adapters
        |
        +---- Supabase (today)
        +---- AAI@EduHr / eduGAIN (later)
        +---- ISVU / LMS (later)
        +---- Azure/Postgres or other storage (later)
~~~

This is a boundary decision, not a microservice decision. F1-F5 remain one deployable application unless a real security, scaling or operational boundary justifies another process.

## Revision vocabulary

Existing domain objects keep their current field names to avoid a risky broad rename.

New application and integration contracts use explicit names:

- DocumentRevision: canonical whole-document server revision; zero is valid.
- AcademicObjectRevision: revision of a claim/section/result/etc.; starts at one.
- API fields use names such as documentRevision, currentDocumentRevision and objectRevision.

The goal is to prevent a generic revision number from crossing an integration boundary without saying what was versioned.

## Document persistence

DocumentRepository is the application boundary for canonical document storage.

The first implementation is SupabaseDocumentRepository. It owns the current Supabase RPC names and maps their wire responses into provider-neutral application results.

This PR does not switch the existing server actions over to the adapter. That wiring should be a small follow-up after this contract is proven green, rather than mixing an architectural seam with runtime behavior changes.

A future Azure/Postgres implementation must preserve the same semantics:

- canonical server revision;
- compare-and-set;
- no silent last-write-wins;
- idempotent replay;
- explicit stale-base outcome;
- validation before treating provider bytes as a Pisač document.

## Evidence ingest / server receipt

Local process capture remains local evidence until a future server implementation accepts and anchors a segment.

EvidenceIngestPort defines the boundary now so the eventual implementation does not force provider details into forensic domain code.

A server receipt means only:

> Pisač accepted the segment identified by this hash from an authenticated principal at the recorded server time.

It does **not** mean:

- a human physically pressed the keys;
- the authenticated person personally authored every character;
- the device was uncompromised;
- no external AI/tool was used;
- the content is academically acceptable.

Those distinctions preserve the product rule: evidence is not judgment.

Expected future persistence shape:

~~~text
local verified segment
       |
       v
EvidenceIngestPort
       |
       +--> validate identity / authorization
       +--> validate chain / idempotency / limits
       +--> store payload in object storage
       +--> store receipt metadata in Postgres
       |
       v
server receipt
~~~

Large evidence payloads should not become one PostgreSQL row per editor event. Postgres should retain authoritative metadata/indexes; segment payloads can live in object storage.

## Identity provider boundary

IdentityProvider represents provider-supplied identity and affiliation facts.

Future adapters may include:

- current Pisač/Supabase auth;
- AAI@EduHr;
- eduGAIN federation;
- Microsoft Entra ID;
- university SAML/OIDC providers.

Provider affiliation is not authorization. An assertion that a person belongs to an institution or has a teacher/student affiliation never by itself grants access to a Pisač document.

Identity is not authorization.

## Academic system boundary

AcademicSystemProvider is read-only and provider-neutral.

Possible future adapters include ISVU, LMS/LTI integrations, Banner, PeopleSoft and other SIS systems.

ISVU or another SIS may be authoritative for facts such as enrollment, course membership and assignment context. Pisač remains authoritative for its own document/process/evidence records.

Therefore:

~~~text
SIS source of truth          Pisač source of truth
-------------------          ---------------------
institution                  project/document
course                       canonical revision
enrollment                   process evidence
teacher/student relation     mentor review
assignment metadata          Pisač submission state
~~~

Native ISVU/LMS schemas must not leak into Pisač domain objects.

## Deliberately out of scope

This architectural PR does **not** add:

- institution/tenant SQL tables;
- AAI@EduHr login;
- ISVU API calls;
- LTI integration;
- remote mentor routing;
- server evidence storage or signing;
- object-storage buckets;
- regional data cells;
- a second backend;
- microservices;
- consolidation of the existing Dexie evidence databases;
- a bulk rename of historic revision fields.

Those changes can be implemented incrementally behind these contracts.

## Next implementation order

1. Wire the existing canonical document server actions through DocumentRepository without behavior change.
2. Design server-side EvidenceIngestPort implementation plus authorization, idempotency and receipt persistence.
3. Add an explicit application authorization boundary before external identity/institution providers.
4. Add institution/course/assignment context only when the FPZG institutional pilot needs it.
5. Integrate AAI@EduHr/ISVU as adapters, never as dependencies of Pisač core.


---

## vNext refinement — 2026-10-02

The original port decision remains valid, but the greenfield/red-team architecture research narrows how two ports should evolve.

### IdentityProvider is the application seam, not one adapter per identity ecosystem

Do not let Pisač Core accumulate permanent branches such as AAIIdentityProvider, EduGainIdentityProvider, UniversitySamlIdentityProvider and EntraIdentityProvider.

The target is:

~~~text
AAI@EduHr ----\
eduGAIN -------\
University SAML ---> Federation Gateway ---> normalized Pisač Principal
University OIDC ---/
Entra ------------/
~~~

For the controlled FPZG pilot, direct AAI/Supabase integration is acceptable. A dedicated federation gateway is introduced only when multiple institutional identity sources make it operationally worthwhile.

Identity assertions remain inputs to authorization. They are not authorization decisions.

### AcademicSystemProvider is a transitional facade

The generic provider interface is useful while no real institutional integration exists, but the target protocol boundaries are more specific:

- LtiPlatformAdapter — LTI 1.3 / LTI Advantage launch, roles, NRPS, AGS and Deep Linking where required.
- HigherEdDataAdapter — Edu-API-style higher-education enterprise data exchange.
- LegacySisAdapter — narrow institution/country-specific mappings such as ISVU when standards do not expose the required facts.

Do not refactor the current interface only to match this naming. The first real integration should prove the exact contracts before runtime migration.

### DocumentRepository remains a strong permanent boundary

The red-team review strengthened, rather than weakened, the DocumentRepository decision. The canonical document service still needs explicit compare-and-set, idempotency and stale-base semantics that generic local-first sync products do not replace.

### EvidenceIngestPort becomes the entry to a dedicated Evidence Trust Plane

The target implementation is no longer just Postgres metadata plus object storage. It adds:

~~~text
EvidenceIngestPort
  -> validation / authorization / idempotency
  -> encrypted raw segment storage
  -> receipt metadata
  -> KMS/HSM signed receipt
  -> append receipt digest to transparency log
  -> signed/witnessed checkpoint
  -> trusted timestamp according to assurance profile
~~~

New evidence formats use versioned deterministic canonicalization (target: RFC 8785 JCS + SHA-256). Existing evidence remains verifiable under its historic format.

See:

- docs/REFERENCE_ARCHITECTURE_VNEXT.md
- docs/EVIDENCE_TRUST_MODEL_VNEXT.md
- docs/ARCHITECTURE_DECISION_REGISTER_VNEXT.md

These vNext documents are the target reference when this earlier foundation document and the target architecture differ.
