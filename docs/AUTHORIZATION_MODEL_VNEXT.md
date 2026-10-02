# Pisač vNext Authorization Model

**Status:** R2 executable reference model. Not yet wired to production requests.

## Purpose

Pisač authorization is relationship-based. Identity/federation establishes who a principal is; authorization answers what that principal may do to a specific Pisač resource.

The model follows least privilege:

- mentor is not document owner;
- course teacher is not automatically a private-draft reader;
- institution admin is not a content superadmin;
- auditor is not automatically a raw-evidence reader;
- raw evidence access is separately granted;
- break-glass is temporary, narrow and read-only by default.

## Resource hierarchy

~~~text
Institution
  -> Course
       -> Assignment
            -> Project
                 -> Document
                 -> Submission
                 -> EvidencePackage
~~~

Policy and audit resources are institution-scoped but deliberately separate from student content.

## Built-in relationships

### Institution

- member
- admin
- auditor

Admin can manage/read institution policy and read security/admin audit records. Auditor can read policy/audit. Neither role inherits access to drafts, submissions or evidence.

### Course

- teacher
- assistant
- student

Teacher/assistant can manage the course/assignment and view roster information. These roles do not automatically grant project content access.

### Project

- student
- mentor
- co_mentor
- reviewer
- conditional break_glass

Permissions:

| Relationship | Private draft | Shared revision | Write document | Comment | Request revision | Mark reviewed | Submit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| student | yes | yes | yes | no by role | no by role | no by role | yes |
| mentor | no | yes | no | yes | yes | yes | no |
| co_mentor | no | yes | no | yes | yes | yes | no |
| reviewer | no | yes | no | yes | no | yes | no |
| break_glass | temporary yes | temporary yes | no | no | no | no | no |

## EvidencePackage

Evidence is intentionally stricter than ordinary mentor review.

- project student: append/read/export;
- explicit evidence viewer: read only;
- explicit evidence exporter: read + export;
- project/evidence break-glass: temporary read only;
- mentor/reviewer status alone: no raw evidence access.

This prevents a broad mentor relationship from silently exposing deleted text or process replay.

## Submission

- project student can finalize;
- mentor/co-mentor/reviewer can review;
- everyone who can read the project's shared revision can read the submission.

Finalization still requires the separate step-up authentication/policy gate defined by the application layer.

## Break-glass

The OpenFGA target model uses a conditional relationship with a grant time and duration.

Break-glass is not a hidden support/admin role. Issuance is a separate sensitive workflow requiring:

- step-up authentication;
- structured reason/ticket;
- exact project or evidence-package scope;
- bounded duration;
- immutable audit;
- explicit removal/revocation.

Missing `current_time` must fail closed for conditional checks.

## Consistency

OpenFGA's default query mode may use cache. Its `HIGHER_CONSISTENCY` mode bypasses the cache and queries the backing database.

The application port therefore marks sensitive operations such as:

- private and shared academic-content reads;
- mentor/reviewer content actions;
- document writes and submission actions;
- roster reads;
- evidence append/read/export;
- policy/audit reads and institution policy changes

for higher-consistency checks.

Grant/revoke lifecycle remains safety-biased:

~~~text
grant:
PENDING -> write authz relation -> verify -> ACTIVE

revoke:
stop new capability -> delete authz relation
-> verify denial with higher consistency -> REVOKED
~~~

Temporary denial is preferable to continued sensitive access after an intended revoke. The initial model therefore prefers higher consistency on revocable content paths; latency optimization requires a later measured design that preserves immediate revocation.

## Provider-neutral boundary

`AuthorizationPort` exposes:

~~~text
principal + action + resource + consistency + request context
  -> ALLOW | DENY | UNAVAILABLE
~~~

`UNAVAILABLE` is intentionally different from `DENY`. Calling application code chooses fail-closed behavior for sensitive operations while still preserving observability of infrastructure failure.

## OpenFGA target

`authz/pisac-vnext.fga` is the target schema 1.1 model. It mirrors the executable TypeScript reference semantics.

The TypeScript evaluator is **not** intended to become a second production policy engine. It is an executable specification and adversarial corpus. A future OpenFGA adapter must run the same scenarios against OpenFGA before becoming authoritative.

## R2 adversarial corpus

Tests prove at minimum:

- student owns only their own private authoring path;
- mentor cannot read private draft;
- mentor cannot read/export raw evidence without an evidence relationship;
- reviewer cannot request revisions by reviewer role alone;
- course teacher can manage assignment but cannot read project content;
- institution admin/auditor have no hidden content access;
- evidence viewer and exporter are different capabilities;
- break-glass is expiring, scoped and read-only;
- cross-project/cross-institution relationships do not leak;
- ambiguous parent topology fails closed;
- removing mentor relation removes reference-model access;
- sensitive operations request stronger consistency;
- submission/evidence export/policy management are step-up operations.

## Next gate

R2 does not yet:

- run OpenFGA in production;
- add the OpenFGA SDK;
- write relationship tuples from product flows;
- replace Supabase RLS;
- add tenant/institution SQL migrations.

The next authorization step is an OpenFGA adapter/shadow spike that validates the DSL model and executes the same adversarial corpus against a real OpenFGA store. Only after differential parity should production routes begin using the external authorization service.
