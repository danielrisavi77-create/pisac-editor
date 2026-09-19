<!-- Source: self-sent Gmail, 2026-09-19 11:42 UTC. Verbatim copy. Not a governance amendment. -->
<!-- Thread: 1a0b979a3b55a4b4 -->
<!-- Subject: Pisač — kompletni Architecture Dossier (19.09.2026.) -->
# Pisač — Architecture Dossier
**Datum:** 19. rujna 2026.

Ovo je konsolidirani zapis svega što smo u ovom razgovoru zaključili nakon ponovnog pregleda Google Drive governancea, Foundation zapisa, F1 plana, GitHuba i aktualnog industry researcha.

## 1. Executive assessment

Pisač treba tretirati kao **Academic Project Operating System**, ne kao editor, AI chat ili LMS.

Najvažnije granice koje vrijedi zadržati:
- identity ≠ authorship
- evidence ≠ judgment
- retrieval relevance ≠ truth
- citation formatting ≠ source verification
- role ≠ authorization
- access ≠ rights
- payment ≠ academic permission
- model output ≠ authority
- local durable state ≠ canonical server state
- deployment success ≠ semantic correctness

Glavni rizik više nije nedostatak arhitekture, nego **architecture paralysis**: governance je toliko detaljan da ga ne smijemo 1:1 preslikati u runtime.

Preporučeni cilj:
> mali executable kernel + modularni monolit + nekoliko odvojenih worker/plane servisa samo gdje security/trust boundary to opravdava.

## 2. Canonical governance

Hijerarhija:
**Product Constitution → locked architecture → accepted scope → approved build baseline → stage-bound ADR/profile → implementation → conformance evidence**

Canonical slojevi:
1. Product Vision
2. Product Constitution + Amendment 001
3. FPZG Pilot PRD
4. Evidence Architecture
5. Policy Engine
6. Authorization & Permissions
7. Data Governance & Privacy
8. Security & Trust
9. AI Runtime & Provider
10. Core Domain & Data
11. Collaboration & Mentor
12. Document / Editor & DOCX Roundtrip
13. Search / RAG / Personal Research Library
14. Integration / LMS
15. Deployment / Operations / Reliability
16. Plans / Entitlements / Billing
17. Client / Web / Desktop / Offline
18. Workflow / Tasks / Deadlines / Notifications
19. Citation / Bibliography
20. Research Content Rights & Permissions

Foundation stanje:
- Foundation Build Approval = APPROVED_FOR_FOUNDATION_BUILD
- Constitution Gate = PASS
- Independent Beta = NOT_ISSUED
- production rollout = nije odobren
- Security Gate = nije PASS
- Reliability Gate = nije PASS
- Beta DG Gate = nije PASS
- AI Quality runtime = nije izvršen
- QA Manifest = 53 fixture grupe / 106 pozitivnih+adverse grana
- F1 = 15 fixture grupa / 30 grana
- F1 plan = 14 taskova / 7 PR-ova
- target repo = private danielrisavi77-create/Pisac

LOCKED ≠ IMPLEMENTED.
Build Approved ≠ Beta Ready ≠ Production Ready.

## 3. GitHub reconciliation

### pisac-editor
Aktualni repo je public i služi kao statički demo/prototype.

Otvoreni PR-ovi:
- PR #1 — student + mentor design
- PR #2 — AI Router V1 token/cost optimizer

### Drift
**P0:** F1 cilja private `Pisac`, ali canonical repo još ne postoji.
**P1:** public pisac-editor počinje dobivati backend eksperimente.
**P1:** PR #1 uvodi mentorstvo prije F1 authoring kernela.
**P1:** PR #2 uvodi AI prije F1 completiona i prije PROFILE-AI-001.
**P2:** stari F1 migration sequence je zastario jer je Lekta migration history već znatno dalje.

### Repo odluka
- `danielrisavi77-create/Pisac` = private canonical product
- `danielrisavi77-create/pisac-editor` = public demo/prototype
- poželjno kasnije public repo preimenovati u `pisac-demo`

PR #1 sačuvati kao F2 design input.
PR #2 sačuvati kao experimental AI routing spike, ne canonical AI runtime.

## 4. Target architecture

```text
PISAČ CLIENT
Next.js / React / Tiptap
Local Durable Journal (IndexedDB / Dexie)
        │
        ▼
APPLICATION API / COMMAND GATEWAY
Auth → Authorization → Policy → Rights → DG → Security
        │
        ├──────────────┐
        ▼ ▼
CORE DOMAIN ASYNC JOB PLANE
Project parse/OCR
Document indexing
Revision notifications
CanonicalCommit export
Source
Submission
        │ │
        ▼ ▼
POSTGRES/SUPABASE OBJECT STORAGE
        │
        ├──────────────┐
        ▼ ▼
SEARCH PLANE EVIDENCE PLANE
FTS + pgvector lineage/manifests
        │
        ▼
AI GATEWAY
Provider registry
Model registry
Routing/evals/budgets
Tool authorization
        │
        ├─ OpenAI
        ├─ Anthropic
        ├─ Google
        ├─ xAI
        ├─ Mistral
        └─ self-hosted
```

F2 realtime, ako ikada bude potreban:
```text
Yjs/realtime working state
→ validated canonical mutation batch
→ Core Domain canonical commit
```

Realtime history nikad ne postaje academic canonical history.

## 5. Core Domain

F1 ostaje na `REPLACE_DOCUMENT`.

Dugoročno:
- INSERT_TEXT
- DELETE_TEXT
- SET_MARK
- INSERT_NODE
- DELETE_NODE
- MOVE_NODE
- SET_NODE_ATTR
- REPLACE_SUBTREE

Ne bilježiti svaki keystroke. Editor transakcije grupirati u logical mutation batches.

Ne full event sourcing za cijeli sustav.

Preporuka:
- relational current state
- append-only document journal
- immutable revisions
- selective evidence/submission journals
- periodic materialized snapshots

Snapshot obavezno na:
- checkpoint
- named version
- share
- submission
- major import

Project Graph: Postgres relational model + derived graph projection. Ne graph DB sada.

## 6. Editor

F1: zadržati Tiptap / ProseMirror.

Stable structural node ID = opaque UUID.

F1:
- paragraph
- headings 1–3
- text
- bold/italic
- checkpoint
- basic DOCX export

F2:
- lists
- comments
- diff
- suggestions
- mentor sharing

F3:
- tables
- figures/captions
- citations/bibliography
- footnotes/endnotes
- equations
- cross-references

## 7. Local-first / save / sync

```text
editor intent
→ canonical candidate
→ atomic IndexedDB transaction
→ LOCAL_DURABLE
→ editor projection
→ pending queue
→ server CAS
→ canonical revision
→ ACK
→ SYNCED
```

User-visible states:
EDITING / SAVING_LOCAL / LOCAL_DURABLE / SYNCING / SYNCED / CONFLICT / ERROR / RECOVERY_REQUIRED

Nikad samo generički "Saved".

Atomic local transaction mora zajedno spremiti:
- snapshot
- pending transaction
- local sequence
- sync state

Idempotency:
(document_id, actor_id, client_transaction_id)

Conflict:
- bez silent LWW
- explicit rebase
- explicit discard
- original conflict ostaje zabilježen

## 8. CRDT

F1: ne.
F2 mentor comments/version sharing: još uvijek ne treba.

Ako jednog dana uvedemo simultano pisanje više korisnika:
- Yjs je prirodan kandidat uz Tiptap
- canonical Pisač commit history ostaje zasebna

## 9. Version model

Odvojiti:
- undo stack
- local pending ops
- canonical revisions
- named versions
- checkpoints
- share snapshot
- submission snapshot
- export artifact

Restore uvijek stvara novu canonical transition. Nikad ne briše kasniju povijest.

## 10. Collaboration / mentor

F2 asynchronous-first.

```text
Private draft
→ Named Revision
→ SharePackage
→ Mentor projection
→ comment/suggestion
→ Student private revision
→ New SharePackage
```

SharePackage mora pinati:
- recipient
- revision IDs
- visibility
- comment/suggestion scope
- created/revoked state

Nova studentova revizija nije automatski mentor-visible.

Mentor role sama ne daje:
- edit
- submit
- private history
- institution-wide visibility

## 11. DOCX / Word

F1:
- docx JS samo za mali eksplicitni subset

Dugoročno:
- dedicated document conversion service
- preferirati .NET + Open XML SDK za high-fidelity path

ONLYOFFICE:
- mogući rendering/interoperability layer
- ne canonical source

WordReplica:
- compatibility oracle
- Windows/Word golden verifier
- QA comparator
- eventualno repair bridge
- ne canonical serializer

Fidelity vocabulary:
SUPPORTED_EXACT / PRESERVED_EXACT / SEMANTIC_EQUIVALENT / LAYOUT_EQUIVALENT / APPROXIMATED / LOSSY / UNKNOWN / BLOCKED

## 12. Evidence / provenance

Pisač nije AI detector.

Pratiti observable facts:
editor input / paste / import / AI suggestion / accepted AI / external AI declaration / mentor / proofreader / translator / source insertion / stats tool / code/tool / unknown origin

Odvojiti:
- Evidence Basis
- Observation Context
- Integrity State
- Attestation Context
- Policy Interpretation

Nikad spajati u jedan "AI %" ili misconduct score.

AIInteractionRecord ≠ AIContribution ≠ AITextPresentInFinalSubmission.

## 13. AI Runtime

```text
AIActionRequest
→ capability classification
→ Policy
→ Authorization
→ Rights
→ Data Governance
→ Security
→ eligible routes
→ task/quality/latency/cost selection
→ context assembly
→ model
→ validation
→ optional tool proposal
→ independent tool authorization
→ action
→ AI Assistance Event
```

Model registry:
provider, model/version, capabilities, context, structured output, tools, modality, region, processing, training/retention, cost, latency, eval, freshness.

Routing:
eligibility → security/privacy/policy → quality → task fit → latency → cost

Fallback ne smije širiti context/data/tools/permissions/region.

Task strategy:
- grammar → cheap fast model
- rewrite → fast/medium
- outline → reasoning
- brainstorming → conversational frontier
- source discovery → research system
- source-grounded QA → RAG + reasoning
- argument critique → stronger reasoning
- statistics explanation → reasoning, no grading
- citation formatting → deterministic CSL
- policy question → Policy Engine + explanation
- research synthesis → authorized RAG + frontier reasoning

## 14. Search / RAG

Početni stack:
- Postgres FTS
- pgvector
- hybrid retrieval
- RRF/fusion
- optional reranker

Pipeline:
Authorization → Rights → allowed SourceVersions → FTS/vector → fusion → rerank → context.

Nikad global retrieval pa naknadno filter nakon LLM-a.

## 15. Research providers

Federirano:
- Crossref
- DataCite
- Semantic Scholar
- Europe PMC
- Unpaywall
- Zotero
- OpenAlex gdje koristan

Nijedan provider nije univerzalni truth.

## 16. Citation engine

Koristiti CSL/citeproc.
Pisač čuva canonical citation/source object model, ali ne izmišlja vlastiti formatter.

FPZG = configuration/profile, ne hardcoded branch.

## 17. Policy Engine

Prvi executable subset:
- PolicySource
- PolicyRuleVersion
- PolicyPack
- PolicyBundleSnapshot
- PolicyDecision
- PolicyExplanation
- AuthorizedException

AI može predložiti rule; ne može ga objaviti.

Trust statusi ostaju odvojeni:
official_source_derived / pisac_reviewed / institution_approved / institution_issued

## 18. Rights Engine

Operation-level.

Primjer:
LOCAL_PARSE → ALLOW
EMBEDDING → REVIEW
SEND_TO_EXTERNAL_AI → DENY
SHARE_WITH_MENTOR → ALLOW_WITH_CONDITIONS

UNKNOWN ≠ ALLOW.

## 19. Backend

F1: zadržati Supabase/Postgres.

Razlog:
- shared auth.users.id
- academic_projects.id
- Lekta canonical migration history
- RLS
- pinani F1 plan

RLS = defense-in-depth, ne cijeli auth engine.

Domain/repository API držati portable da ne veže core na Supabase.

## 20. Runtime topology

F1–F3 = modular monolith.

Odvojeni procesi samo:
1. document parser/converter worker
2. AI gateway/worker
3. background job worker
4. later realtime coordinator

Ne pretvarati 20 governance slojeva u 20 mikroservisa.

## 21. ADR backlog

Existing Foundation:
ADR-AUTH-001
ADR-EDITOR-001
PROFILE-SYNC-001
PROFILE-DOCX-001
PROFILE-A11Y-001
PROFILE-FPZG-POLICY-001
PROFILE-FPZG-CITATION-001
PROFILE-RIGHTS-001
PROFILE-AI-001
PROFILE-DG-BETA-001
PLAN-SEC-001
PLAN-REL-001
PROFILE-EVIDENCE-001
PROFILE-E2E-001
PROFILE-CRYPTO-001

Dodatni:
ADR-REPO-001
ADR-DOC-MUTATION-002
ADR-COLLAB-001
ADR-REALTIME-001
ADR-DOCX-SERVICE-001
ADR-RAG-001
ADR-JOBS-001
ADR-OBS-001
ADR-ANALYTICS-001

## 22. Roadmap

F1 — Authoring Kernel
Auth → Workspace → Document → local durability → sync → recovery/conflict → checkpoint → DOCX

F2 — Mentor/Collaboration
invite → share exact versions → comments → diff → suggestions → revocation → multi-mentor

F3 — Research/Citations
library → sources → metadata → hybrid retrieval → CSL → rights → richer DOCX

F4 — AI
provider registry → gateway → eval routing → policy gating → grounded assistance → Assistance Ledger → tools

F5 — Institution
Institution Workspace → SSO → LMS → assignments → submission → institutional licensing

## 23. PR roadmap

F1 originalnih 7 PR-ova zadržati:
1. tooling/governance
2. auth/workspace
3. canonical document/editor
4. local durability/server sync
5. recovery/conflict/checkpoints
6. DOCX
7. fixtures/browser E2E

Aktualni Lekta migration broj provjeriti neposredno prije implementacije; ne koristiti zastarjeli hardcoded sequence.

## 24. AI development model

- Governance/spec: čovjek + Drive
- Primary implementation: Codex
- Independent reviewer: Claude Code
- Human cockpit: Cursor
- Design: Claude Design/Figma
- Staging black-box QA: Grok Bot/Manus
- Research: Perplexity/Deep Research/web

Agents = least privilege.
Nema production superusera.
Nema real student docs za QA agente.

## 25. Security

P0:
- cross-student access
- cross-institution leak
- service-role leak
- durable data loss
- silent conflict overwrite
- malicious document parser
- macro/OLE/external relationship
- agent privilege widening
- prompt injection → tool widening
- incorrect submission
- duplicate side effect

P1:
XSS / CSRF / SSRF / vector poisoning / webhook forgery / replay / stale auth cache / support abuse / backup leak / provider leakage / dependency compromise / CI secret exfiltration

## 26. Privacy

Data classes:
academic content / deleted drafts / comments / AI prompts+responses / sources / evidence / telemetry / analytics / auth / billing / support

Svaka mora imati:
purpose / retention / recipients / provider / transfer / deletion / export / visibility.

Foundation development/testing = synthetic/non-formal by default.

## 27. QA

Accepted manifest:
53 groups / 106 branches.

F1:
FX-FR-001-001
FX-FR-002-001
FX-FR-004-001
FX-FR-020-001
FX-FR-021-001
FX-FR-022-001
FX-FR-023-001
FX-FR-024-001
FX-FR-025-001
FX-FR-075-001
FX-X-A11Y-001
FX-X-REL-001
FX-X-CLIENT-001
FX-X-DG-001
FX-X-SEC-001

Fixture evidence mora vezati:
fixture → executable test → exact SHA → environment → result → artifact.

Definition ≠ PASS.

## 28. Scale

100–1k:
Next.js + Supabase/Postgres + IndexedDB + object storage + one worker.

1k–10k:
queue / doc worker / search worker / pooling / AI gateway / observability.

10k–100k:
worker autoscaling / partitioning / realtime plane / HNSW tuning / quotas / safe replicas.

100k–1m:
tenant placement / institutional partitions / dedicated search if needed / multi-region reads / AI budgets / cold archive.

## 29. Cost drivers

1. AI
2. OCR/document processing
3. source storage
4. embeddings
5. realtime
6. observability

Principles:
deterministic before AI / small model before frontier / cache stable context / embed once / deduplicate blobs / async batch / minimum context.

## 30. Do not build yet

U F1 odgoditi:
- AI tutor
- production AI Router
- RAG
- vector infrastructure
- policy runtime
- citation engine
- full DOCX import
- PDF/A
- realtime multiplayer
- CRDT
- Institution Workspace
- LMS
- billing
- graph DB
- Kubernetes
- microservices
- multi-region writes
- custom crypto
- blockchain provenance
- AI percentage

## 31. Final verdict

Zadržati:
Constitution, Personal Workspace, evidence-without-judgment, provider neutrality, operation-level Rights, policy authority, local/server distinction, exact submission/export, canonical owner model.

Promijeniti:
runtime simplification, repo structure, later document mutation model, high-fidelity DOCX layer, collaboration sequence, AI timing.

Ukinuti:
ideju da svaki governance record mora odmah postati SQL tablica/service/endpoint/UI.

Najbolji sljedeći potez:
**PISAČ EXECUTABLE FOUNDATION PROFILE v1**
zatim
**private danielrisavi77-create/Pisac → F1 PR-1.**

## Key source links

Product Governance Index:
https://docs.google.com/document/d/1h-s2L1Zts5Ow_lC3C8zVYDPHpYcOUc06/edit

Product Vision:
https://docs.google.com/document/d/1S0k5PAkLvli9uuSS5nlymkBpvrO5gvNh/edit

Product Constitution:
https://docs.google.com/document/d/1Q3cSsJKcQxFiyEIPCOS2FxPk5k-fOGxk/edit

FPZG Pilot PRD:
https://docs.google.com/document/d/1Q0roTuU761i1GdQ6xbBCvmpFjOD3xOvk/edit

Foundation Build Approval:
https://drive.google.com/file/d/1LNW_y74tD6zfCCr0mLxowxbI0HBgTegA/view

Foundation Kickoff:
https://drive.google.com/file/d/1v6M6MiaykfDOjVvuYYs_y7VAZSc6y85V/view

F1 Authoring Kernel:
https://drive.google.com/file/d/12mvgPqZnJF_fPIS5yRHtUFb_7G9dI5ii/view

GitHub public demo:
https://github.com/danielrisavi77-create/pisac-editor

Lekta:
https://github.com/danielrisavi77-create/Lekta

WordReplica:
https://github.com/danielrisavi77-create/WordReplica-Automation

Katedra:
https://github.com/danielrisavi77-create/katedra

---
Napomena: ovaj mail je konsolidirani architecture dossier iz razgovora. Nije novi governance amendment; zaključane semantičke promjene i dalje zahtijevaju versioned change-control.