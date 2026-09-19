<!-- Source: self-sent Gmail, 2026-09-19 11:42 UTC. Verbatim copy. Not a governance amendment. -->
<!-- Thread: 1a0b979aa522aaf9 -->
<!-- Subject: Pisač — Master Architecture Prompt za nastavak rada -->
# Pisač — Master prompt za nastavak arhitektonskog rada

Koristi ovaj prompt kada želiš ponovno učitati cijeli projekt i izvesti novu, potpuno verificiranu arhitektonsku iteraciju.

## Cilj
Rekonstruiraj cijelo postojeće znanje o Pisaču → provjeri ga → pronađi rupe, kontradikcije i slabe točke → istraži aktualna najbolja rješenja → predloži poboljšanja → razradi svaki sloj → spoji sve u jednu implementabilnu cjelinu.

Ne favoriziraj unaprijed OpenAI, Anthropic, Google, xAI, Supabase, Vercel, AWS, Microsoft, Figma, Linear, Codex, Claude Code, Grok Bot, Manus ili bilo kojeg providera.

Za svaku odluku razdvoji:
1. locked governance
2. trenutni implementation slice
3. open ADR/profile
4. aktualnu preporuku
5. dugoročno najbolju opciju

## 1. Učitaj Google Drive governance
Prouči:
- Product Governance Index
- Word Archive Index
- Governance Reconciliation
- Product Vision
- Product Constitution + amandmane
- FPZG Pilot PRD
- Evidence
- Policy
- Authorization
- Data Governance
- Security
- AI Runtime
- Core Domain
- Collaboration/Mentor
- Editor/DOCX
- Search/RAG
- LMS Integration
- Operations/Reliability
- Billing
- Client/Offline
- Workflow
- Citation
- Rights

Foundation:
- F0 Scope
- Owner
- QA Manifest
- Design Gates
- Implementation Profile Register
- Prebuild Openings
- Constitution Gate
- Build Approval
- Test Data Handling
- AI Intended Use
- Kickoff
- F1 Authoring Kernel
- verification/self-review

Hijerarhija:
Constitution → locked architecture → accepted scope → approved build baseline → stage-bound ADR/profile → implementation → conformance evidence.

## 2. GitHub
Pregledaj:
- pisac-editor
- Pisac
- Lekta
- WordReplica
- Katedra
- Academic Suite/relevant repos

Provjeri visibility, branches, PRs, issues, code, CI, deploy, migrations, integracije i drift.

Klasificiraj:
aligned / compatible extension / stale / implementation drift / governance conflict / undocumented decision / potential improvement.

## 3. Industry research
Editor:
ProseMirror, Tiptap, Lexical, Slate, CodeMirror, Yjs, Automerge, Liveblocks, PartyKit.

Local-first:
IndexedDB, journal, optimistic concurrency, event sourcing, op-log, CRDT/OT, branch/rebase, multi-device conflict.

Backend:
Supabase/Postgres, Neon, PlanetScale, Convex, Firebase, Cloudflare, AWS.

AI:
OpenAI, Anthropic, Google, xAI, Mistral, self-hosted, embeddings, rerankers, OCR.

Agents:
Codex, Claude Code, Cursor, Devin, Grok, Manus, Gemini, OpenAI Agents, MCP.

DOCX:
OOXML, docx JS, docx4j, Open XML SDK, LibreOffice, ONLYOFFICE, Office APIs, Word automation, WordReplica.

Research/citations:
CSL, citeproc, Zotero, Crossref, OpenAlex, Semantic Scholar, Unpaywall, Europe PMC, DataCite.

## 4. Constitution
Preserve:
student-first; facts not misconduct scores; no AI percentage; no automatic misconduct verdict; no formal grading/ranking/pass-fail; identity ≠ authorship; evidence ≠ judgment; unknown ≠ guilt; minimum evidence; no keylogger; private history boundaries; no retroactive widening; role ≠ auth; possession ≠ rights; model output ≠ authority; tool proposal ≠ authority; external ID ≠ canonical identity; local ≠ server truth; deploy ≠ semantic correctness; citation format ≠ verification; retrieval relevance ≠ truth; payment ≠ academic permission.

Ako mijenjaš locked semantic:
GOVERNANCE CHANGE REQUIRED.

## 5. Product model
Definiraj:
User/Principal, Workspace, Institution, Course, Assignment, AcademicProject, Document, DocumentRevision, DocumentNode, Operation, Transaction, CanonicalCommit, Checkpoint, Source, SourceVersion, Citation, Claim, ResearchLibraryItem, AIInteraction, Contribution, MentorRelationship, ReviewThread, Comment, Suggestion, PolicyRule, PolicyBundle, RightsDecision, Submission, DisclosureSnapshot, EvidenceClaim, EvidenceManifest, ExportArtifact, Task, Deadline, Notification, Integration, Entitlement.

Za svaki:
owner, IDs, mutability, lifecycle, auth, privacy, evidence, retention/deletion, offline, versions.

## 6. Core Domain
Analiziraj:
REPLACE_DOCUMENT vs typed ops; migration; replay; batching; stable IDs; snapshots; event sourcing; project graph.

## 7. Editor
Razradi schema, IDs, transakcije, undo/redo, paste, import, IME, dictation, accessibility, mobile, long docs, pagination, headings, lists, tables, figures, captions, footnotes, equations, citations, comments, track changes, suggestions, styles.

Odredi F1/F2/F3/later.

## 8. Local-first
intent → durable local → queue → server validation → canonical commit → ack → reconciliation.

Cover crash, quota, IndexedDB unavailable, offline, sessions, account switch, tabs/devices, stale base, retry, lost response, conflict, migration, browser eviction, corruption.

States:
editing / saving locally / local durable / syncing / synced / conflict / error / recovery required.

## 9. Versions
Odvoji undo, pending, revisions, named versions, checkpoints, share snapshot, submission snapshot, export artifact.
Restore = nova transition.

## 10. Collaboration
Async-first F2.
Invite, accept, revoke, version visibility, comments, stale anchors, suggestions, private notes, presence, realtime, multi-mentor.

## 11. DOCX
Define fidelity taxonomy.
Pipeline:
sanitize → canonicalize → map → unsupported detection → serialize → reparse → backward verify → WordReplica QA.

## 12. Evidence
Track editor/paste/import/AI/mentor/external declarations/tools.
Separate Evidence Basis, Observation Context, Integrity State, Attestation Context, Policy Interpretation.
No confidence score.

## 13. AI Runtime
request → capability → Policy → Auth → Rights → DG → Security → eligible routes → context → model → validation → tool auth → action → Assistance Event.

Registry:
provider/model/capability/context/tools/modality/region/processing/training/cost/latency/eval/freshness.

Routing:
eligibility → security/privacy/policy → quality → task fit → latency → cost.

## 14. RAG
Research Library, ingestion, metadata, PDF/OCR, chunking, embeddings, FTS, vector, reranking, citations, source versions, invalidation.
Auth/Rights prije model contexta.

## 15. Citations
Canonical citation model + CSL.
FPZG = config.

## 16. Policy
Source, Rule, Authority, Trust, Applicability, Conditions, Exceptions, Capability, Enforcement, Coverage, Freshness, Decision, Explanation.
AI može predložiti; ne publishati.

## 17. Rights
Operation-level.
UNKNOWN ≠ ALLOW.

## 18. Security
Threats:
cross-tenant, IDOR, RLS, service role, XSS, CSRF, SSRF, prompt injection, malicious documents, ZIP bomb, OLE/macros, supply chain, CI secrets, excessive agency, MCP, provider compromise, cache/vector poisoning, webhooks, replay, idempotency, billing bypass, admin abuse, backup leakage.

Za svaki:
asset, boundary, threat, control, detection, recovery, test.

## 19. Privacy
Data classes:
academic content, deleted drafts, comments, prompts/responses, sources, evidence, telemetry, analytics, auth, billing, support.
Za svaki:
purpose, retention, recipients, provider, transfer, deletion, export, visibility.

## 20. QA
Unit, integration, golden, browser, security, AI.
Mapiraj:
fixture → executable test → exact build → result.
Definition ≠ PASS.

## 21. Development agents
Razdvoji:
builders / reviewers / QA / in-product agents.
Least privilege.

## 22. CI/CD
baseline integrity / lockfile / typecheck / lint / unit / domain replay / auth-RLS adverse / integration / fixtures / Playwright / DOCX / accessibility / security / secrets / SBOM / migrations / staging smoke.

## 23. Observability
Minimized telemetry.
Operational telemetry ≠ Evidence.

## 24. Analytics
Allowed:
project_created / editor_opened / local_save_success / sync_failure / checkpoint_created / export_success.
Nikad full_document_text.

## 25. Scale
100 / 1k / 10k / 100k / 1m.
Architecture, bottlenecks, triggers, costs.

## 26. Billing
Free / Student Pro / Institution.
Entitlement ≠ Authorization ≠ academic permission.

## 27. FPZG
Configuration #1.
Second-institution test.

## 28. Integrations
Lekta, Katedra, WordReplica, Drive, OneDrive, Zotero, LMS, Moodle/Merlin, Turnitin gdje dozvoljeno, ORCID, Crossref, SSO.

## 29. UX
onboarding → Personal Workspace → project → assignment → research → sources → outline → write → cite → AI → mentor → revision → readiness → disclosure → submit/export.

## 30. Accessibility
keyboard / screen reader / IME / dictation / reduced motion / reflow / contrast / focus / comments / diff / error recovery.

## 31. Required output
A Executive assessment
B Source-of-truth map
C Conflict/drift
D Target diagram
E Domain architecture
F Technology matrix
G ADR backlog
H Roadmap
I PR roadmap
J AI dev operating model
K Security/privacy
L QA matrix
M Scale
N Costs
O Do not build
P Final verdict

## 32. Critical thinking
Traži:
overengineering, duplication, coupling, premature abstractions, lock-in, impossible guarantees, privacy conflicts, security gaps, performance traps, ops complexity, UX friction, testing blind spots, unclear ownership.

Format:
problem → evidence → consequence → alternative → recommendation.

## 33. Source labels
[DRIVE — CANONICAL]
[GITHUB — CURRENT IMPLEMENTATION]
[WEB — CURRENT EXTERNAL FACT]
[ANALYSIS]
[PROPOSAL]

## 34. North Star
Optimiziraj za:
**najbolji studentski academic-workflow proizvod koji može pošteno, sigurno i auditabilno povezati akademski rad, izvore, AI pomoć, mentorstvo, pravila i predaju bez pretvaranja provenance podataka u automatsku presudu o studentu.**

Rezultat mora biti dovoljno dobar za target architecture, ADRs, implementation plan, GitHub issues, agent instructions, QA plan, release plan i production Pisač.