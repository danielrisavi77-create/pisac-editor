import { describe, expect, it } from "vitest";

import {
  requiredAuthorizationConsistency,
  requiresStepUpAuthentication,
  type AuthorizationAction,
  type AuthorizationResource,
} from "@/application/ports/authorization";
import {
  evaluateReferenceAuthorization,
  type ReferenceAuthorizationState,
} from "./reference-model";

const state: ReferenceAuthorizationState = {
  institutionRoles: [
    { userId: "alice", institutionId: "fpzg", role: "member" },
    { userId: "mentor", institutionId: "fpzg", role: "member" },
    { userId: "teacher", institutionId: "fpzg", role: "member" },
    { userId: "admin", institutionId: "fpzg", role: "admin" },
    { userId: "auditor", institutionId: "fpzg", role: "auditor" },
    { userId: "bob", institutionId: "other", role: "member" },
  ],
  courseRoles: [
    { userId: "teacher", courseId: "course-1", role: "teacher" },
    { userId: "assistant", courseId: "course-1", role: "assistant" },
    { userId: "alice", courseId: "course-1", role: "student" },
    { userId: "other-teacher", courseId: "course-2", role: "teacher" },
    { userId: "bob", courseId: "course-2", role: "student" },
  ],
  courseInstitution: [
    { courseId: "course-1", institutionId: "fpzg" },
    { courseId: "course-2", institutionId: "other" },
  ],
  assignmentCourse: [
    { assignmentId: "assignment-1", courseId: "course-1" },
    { assignmentId: "assignment-2", courseId: "course-2" },
  ],
  projectAssignment: [
    { projectId: "project-1", assignmentId: "assignment-1" },
    { projectId: "project-2", assignmentId: "assignment-2" },
  ],
  projectRoles: [
    { userId: "alice", projectId: "project-1", role: "student" },
    { userId: "mentor", projectId: "project-1", role: "mentor" },
    { userId: "reviewer", projectId: "project-1", role: "reviewer" },
    { userId: "bob", projectId: "project-2", role: "student" },
  ],
  documentProject: [
    { documentId: "doc-1", projectId: "project-1" },
    { documentId: "doc-2", projectId: "project-2" },
  ],
  submissionProject: [
    { submissionId: "submission-1", projectId: "project-1" },
    { submissionId: "submission-2", projectId: "project-2" },
  ],
  evidenceProject: [
    { evidencePackageId: "evidence-1", projectId: "project-1" },
    { evidencePackageId: "evidence-2", projectId: "project-2" },
  ],
  evidenceRoles: [
    { userId: "evidence-reviewer", evidencePackageId: "evidence-1", role: "viewer" },
    { userId: "evidence-exporter", evidencePackageId: "evidence-1", role: "exporter" },
  ],
  policyInstitution: [{ policyId: "policy-1", institutionId: "fpzg" }],
  auditInstitution: [{ auditRecordId: "audit-1", institutionId: "fpzg" }],
  breakGlass: [
    {
      userId: "support",
      resourceType: "project",
      resourceId: "project-1",
      grantTime: "2026-10-02T20:00:00.000Z",
      grantDurationMs: 10 * 60 * 1000,
    },
    {
      userId: "forensics",
      resourceType: "evidence_package",
      resourceId: "evidence-1",
      grantTime: "2026-10-02T20:00:00.000Z",
      grantDurationMs: 5 * 60 * 1000,
    },
  ],
};

function allowed(
  principalId: string,
  action: AuthorizationAction,
  resource: AuthorizationResource,
  currentTime = "2026-10-02T20:04:00.000Z",
) {
  return evaluateReferenceAuthorization({
    state,
    principalId,
    action,
    resource,
    currentTime,
  });
}

describe("Pisač vNext reference authorization", () => {
  it("gives the student authority over their own private authoring path", () => {
    expect(allowed("alice", "read_private_draft", { type: "document", id: "doc-1" })).toEqual({
      allowed: true,
      basis: "project-student",
    });
    expect(allowed("alice", "write_document", { type: "document", id: "doc-1" }).allowed).toBe(true);
    expect(allowed("alice", "submit", { type: "project", id: "project-1" }).allowed).toBe(true);
    expect(allowed("alice", "finalize_submission", { type: "submission", id: "submission-1" }).allowed).toBe(true);
    expect(allowed("alice", "append_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(true);
    expect(allowed("alice", "read_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(true);
    expect(allowed("alice", "export_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(true);
  });

  it("lets a mentor review shared academic state but not private drafts or raw evidence by role alone", () => {
    expect(allowed("mentor", "read_shared_revision", { type: "document", id: "doc-1" }).allowed).toBe(true);
    expect(allowed("mentor", "comment", { type: "document", id: "doc-1" }).allowed).toBe(true);
    expect(allowed("mentor", "request_revision", { type: "document", id: "doc-1" }).allowed).toBe(true);
    expect(allowed("mentor", "mark_reviewed", { type: "project", id: "project-1" }).allowed).toBe(true);
    expect(allowed("mentor", "read_private_draft", { type: "document", id: "doc-1" }).allowed).toBe(false);
    expect(allowed("mentor", "write_document", { type: "document", id: "doc-1" }).allowed).toBe(false);
    expect(allowed("mentor", "read_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(false);
    expect(allowed("mentor", "export_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(false);
  });

  it("keeps reviewer powers narrower than mentor powers", () => {
    expect(allowed("reviewer", "read_shared_revision", { type: "document", id: "doc-1" }).allowed).toBe(true);
    expect(allowed("reviewer", "comment", { type: "document", id: "doc-1" }).allowed).toBe(true);
    expect(allowed("reviewer", "mark_reviewed", { type: "project", id: "project-1" }).allowed).toBe(true);
    expect(allowed("reviewer", "request_revision", { type: "document", id: "doc-1" }).allowed).toBe(false);
    expect(allowed("reviewer", "read_private_draft", { type: "document", id: "doc-1" }).allowed).toBe(false);
  });

  it("does not turn a course teacher into a private-content reader", () => {
    expect(allowed("teacher", "manage_assignment", { type: "assignment", id: "assignment-1" }).allowed).toBe(true);
    expect(allowed("teacher", "view_roster", { type: "assignment", id: "assignment-1" }).allowed).toBe(true);
    expect(allowed("teacher", "read_private_draft", { type: "document", id: "doc-1" }).allowed).toBe(false);
    expect(allowed("teacher", "read_shared_revision", { type: "document", id: "doc-1" }).allowed).toBe(false);
    expect(allowed("teacher", "read_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(false);
  });

  it("does not turn an institution admin or auditor into a content superadmin", () => {
    expect(allowed("admin", "manage_policy", { type: "institution_policy", id: "policy-1" }).allowed).toBe(true);
    expect(allowed("admin", "read_audit", { type: "audit_record", id: "audit-1" }).allowed).toBe(true);
    expect(allowed("auditor", "read_policy", { type: "institution_policy", id: "policy-1" }).allowed).toBe(true);
    expect(allowed("auditor", "read_audit", { type: "audit_record", id: "audit-1" }).allowed).toBe(true);

    for (const user of ["admin", "auditor"]) {
      expect(allowed(user, "read_private_draft", { type: "document", id: "doc-1" }).allowed).toBe(false);
      expect(allowed(user, "read_shared_revision", { type: "document", id: "doc-1" }).allowed).toBe(false);
      expect(allowed(user, "read_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(false);
    }
  });

  it("requires explicit evidence-package relationships for third-party raw evidence access", () => {
    expect(allowed("evidence-reviewer", "read_evidence", { type: "evidence_package", id: "evidence-1" })).toEqual({
      allowed: true,
      basis: "evidence-viewer",
    });
    expect(allowed("evidence-reviewer", "export_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(false);

    expect(allowed("evidence-exporter", "read_evidence", { type: "evidence_package", id: "evidence-1" })).toEqual({
      allowed: true,
      basis: "evidence-exporter",
    });
    expect(allowed("evidence-exporter", "export_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(true);
  });

  it("makes break-glass temporary, read-only and narrowly scoped", () => {
    expect(allowed("support", "read_private_draft", { type: "document", id: "doc-1" })).toEqual({
      allowed: true,
      basis: "break-glass",
    });
    expect(allowed("support", "read_evidence", { type: "evidence_package", id: "evidence-1" })).toEqual({
      allowed: true,
      basis: "break-glass",
    });
    expect(allowed("support", "write_document", { type: "document", id: "doc-1" }).allowed).toBe(false);
    expect(allowed("support", "comment", { type: "document", id: "doc-1" }).allowed).toBe(false);
    expect(allowed("support", "export_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(false);

    expect(
      allowed(
        "support",
        "read_private_draft",
        { type: "document", id: "doc-1" },
        "2026-10-02T20:10:00.000Z",
      ).allowed,
    ).toBe(false);
    expect(
      allowed(
        "support",
        "read_private_draft",
        { type: "document", id: "doc-2" },
        "2026-10-02T20:04:00.000Z",
      ).allowed,
    ).toBe(false);
  });

  it("allows evidence-package-specific break-glass without widening the project", () => {
    expect(allowed("forensics", "read_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(true);
    expect(allowed("forensics", "read_private_draft", { type: "document", id: "doc-1" }).allowed).toBe(false);
    expect(allowed("forensics", "export_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(false);
  });

  it("prevents relationships from crossing projects or institutions", () => {
    expect(allowed("alice", "read_private_draft", { type: "document", id: "doc-2" }).allowed).toBe(false);
    expect(allowed("mentor", "read_shared_revision", { type: "document", id: "doc-2" }).allowed).toBe(false);
    expect(allowed("other-teacher", "manage_assignment", { type: "assignment", id: "assignment-1" }).allowed).toBe(false);
    expect(allowed("bob", "read_evidence", { type: "evidence_package", id: "evidence-1" }).allowed).toBe(false);
  });

  it("fails closed when a resource has ambiguous or missing parent relationships", () => {
    const ambiguous: ReferenceAuthorizationState = {
      ...state,
      documentProject: [
        ...state.documentProject,
        { documentId: "doc-1", projectId: "project-2" },
      ],
    };
    expect(
      evaluateReferenceAuthorization({
        state: ambiguous,
        principalId: "alice",
        action: "read_private_draft",
        resource: { type: "document", id: "doc-1" },
        currentTime: "2026-10-02T20:04:00.000Z",
      }).allowed,
    ).toBe(false);

    expect(
      allowed("alice", "read_private_draft", { type: "document", id: "missing" }).allowed,
    ).toBe(false);
  });

  it("loses mentor access as soon as the mentor relationship is removed in the reference state", () => {
    const revoked: ReferenceAuthorizationState = {
      ...state,
      projectRoles: state.projectRoles.filter(
        (row) => !(row.userId === "mentor" && row.projectId === "project-1"),
      ),
    };
    expect(
      evaluateReferenceAuthorization({
        state: revoked,
        principalId: "mentor",
        action: "read_shared_revision",
        resource: { type: "document", id: "doc-1" },
      }).allowed,
    ).toBe(false);
  });

  it("marks security-sensitive checks for stronger consistency and step-up where required", () => {
    for (const action of [
      "read_private_draft",
      "write_document",
      "finalize_submission",
      "append_evidence",
      "read_evidence",
      "export_evidence",
      "manage_policy",
    ] satisfies AuthorizationAction[]) {
      expect(requiredAuthorizationConsistency(action)).toBe("higher-consistency");
    }

    expect(requiredAuthorizationConsistency("read_shared_revision")).toBe(
      "higher-consistency",
    );
    expect(requiredAuthorizationConsistency("read_submission")).toBe(
      "higher-consistency",
    );
    expect(requiredAuthorizationConsistency("view_roster")).toBe(
      "higher-consistency",
    );
    expect(requiredAuthorizationConsistency("manage_course")).toBe(
      "minimize-latency",
    );
    expect(requiresStepUpAuthentication("finalize_submission")).toBe(true);
    expect(requiresStepUpAuthentication("export_evidence")).toBe(true);
    expect(requiresStepUpAuthentication("manage_policy")).toBe(true);
    expect(requiresStepUpAuthentication("write_document")).toBe(false);
  });
});
