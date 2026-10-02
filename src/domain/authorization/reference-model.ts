import type {
  AuthorizationAction,
  AuthorizationResource,
} from "@/application/ports/authorization";

export type InstitutionRole = "member" | "admin" | "auditor";
export type CourseRole = "teacher" | "assistant" | "student";
export type ProjectRole = "student" | "mentor" | "co_mentor" | "reviewer";
export type EvidenceRole = "viewer" | "exporter";

export type TimedGrant = {
  userId: string;
  resourceType: "project" | "evidence_package";
  resourceId: string;
  grantTime: string;
  grantDurationMs: number;
};

export type ReferenceAuthorizationState = {
  institutionRoles: ReadonlyArray<{
    userId: string;
    institutionId: string;
    role: InstitutionRole;
  }>;
  courseRoles: ReadonlyArray<{
    userId: string;
    courseId: string;
    role: CourseRole;
  }>;
  courseInstitution: ReadonlyArray<{
    courseId: string;
    institutionId: string;
  }>;
  assignmentCourse: ReadonlyArray<{
    assignmentId: string;
    courseId: string;
  }>;
  projectAssignment: ReadonlyArray<{
    projectId: string;
    assignmentId: string;
  }>;
  projectRoles: ReadonlyArray<{
    userId: string;
    projectId: string;
    role: ProjectRole;
  }>;
  documentProject: ReadonlyArray<{
    documentId: string;
    projectId: string;
  }>;
  submissionProject: ReadonlyArray<{
    submissionId: string;
    projectId: string;
  }>;
  evidenceProject: ReadonlyArray<{
    evidencePackageId: string;
    projectId: string;
  }>;
  evidenceRoles: ReadonlyArray<{
    userId: string;
    evidencePackageId: string;
    role: EvidenceRole;
  }>;
  policyInstitution: ReadonlyArray<{
    policyId: string;
    institutionId: string;
  }>;
  auditInstitution: ReadonlyArray<{
    auditRecordId: string;
    institutionId: string;
  }>;
  breakGlass: ReadonlyArray<TimedGrant>;
};

export type ReferenceDecisionBasis =
  | "project-student"
  | "project-mentor"
  | "project-co-mentor"
  | "project-reviewer"
  | "course-teacher"
  | "course-assistant"
  | "institution-admin"
  | "institution-auditor"
  | "evidence-viewer"
  | "evidence-exporter"
  | "break-glass"
  | "none";

export type ReferenceAuthorizationDecision = {
  allowed: boolean;
  basis: ReferenceDecisionBasis;
};

const resourceId = (
  resource: AuthorizationResource,
  expected: AuthorizationResource["type"],
): string | null => (resource.type === expected ? resource.id : null);

function hasRole<T extends string>(
  rows: ReadonlyArray<{ userId: string; role: T }>,
  userId: string,
  ...roles: readonly T[]
): boolean {
  return rows.some(
    (row) => row.userId === userId && roles.includes(row.role),
  );
}

function oneParent<T extends Record<string, string>>(
  rows: ReadonlyArray<T>,
  childKey: keyof T,
  childId: string,
  parentKey: keyof T,
): string | null {
  const matching = rows.filter((row) => row[childKey] === childId);
  if (matching.length !== 1) return null;
  return matching[0][parentKey] ?? null;
}

function projectForResource(
  state: ReferenceAuthorizationState,
  resource: AuthorizationResource,
): string | null {
  if (resource.type === "project") return resource.id;
  if (resource.type === "document") {
    return oneParent(
      state.documentProject,
      "documentId",
      resource.id,
      "projectId",
    );
  }
  if (resource.type === "submission") {
    return oneParent(
      state.submissionProject,
      "submissionId",
      resource.id,
      "projectId",
    );
  }
  if (resource.type === "evidence_package") {
    return oneParent(
      state.evidenceProject,
      "evidencePackageId",
      resource.id,
      "projectId",
    );
  }
  return null;
}

function projectRole(
  state: ReferenceAuthorizationState,
  projectId: string,
  userId: string,
  role: ProjectRole,
): boolean {
  return state.projectRoles.some(
    (row) =>
      row.projectId === projectId &&
      row.userId === userId &&
      row.role === role,
  );
}

function activeBreakGlass(
  state: ReferenceAuthorizationState,
  userId: string,
  resource: AuthorizationResource,
  currentTime?: string,
): boolean {
  if (!currentTime) return false;
  const now = Date.parse(currentTime);
  if (!Number.isFinite(now)) return false;

  const direct = state.breakGlass.some((grant) => {
    if (
      grant.userId !== userId ||
      grant.resourceType !== resource.type ||
      grant.resourceId !== resource.id ||
      !Number.isSafeInteger(grant.grantDurationMs) ||
      grant.grantDurationMs <= 0
    ) {
      return false;
    }
    const start = Date.parse(grant.grantTime);
    return (
      Number.isFinite(start) &&
      now >= start &&
      now < start + grant.grantDurationMs
    );
  });
  if (direct) return true;

  const projectId = projectForResource(state, resource);
  if (!projectId || resource.type === "project") return false;
  return state.breakGlass.some((grant) => {
    if (
      grant.userId !== userId ||
      grant.resourceType !== "project" ||
      grant.resourceId !== projectId ||
      !Number.isSafeInteger(grant.grantDurationMs) ||
      grant.grantDurationMs <= 0
    ) {
      return false;
    }
    const start = Date.parse(grant.grantTime);
    return (
      Number.isFinite(start) &&
      now >= start &&
      now < start + grant.grantDurationMs
    );
  });
}

function projectDecision(
  state: ReferenceAuthorizationState,
  userId: string,
  projectId: string,
  action: AuthorizationAction,
  breakGlass: boolean,
): ReferenceAuthorizationDecision {
  const student = projectRole(state, projectId, userId, "student");
  const mentor = projectRole(state, projectId, userId, "mentor");
  const coMentor = projectRole(state, projectId, userId, "co_mentor");
  const reviewer = projectRole(state, projectId, userId, "reviewer");

  if (
    action === "read_private_draft" &&
    (student || breakGlass)
  ) {
    return {
      allowed: true,
      basis: student ? "project-student" : "break-glass",
    };
  }

  if (
    action === "read_shared_revision" &&
    (student || mentor || coMentor || reviewer || breakGlass)
  ) {
    return {
      allowed: true,
      basis: student
        ? "project-student"
        : mentor
          ? "project-mentor"
          : coMentor
            ? "project-co-mentor"
            : reviewer
              ? "project-reviewer"
              : "break-glass",
    };
  }

  if (
    ["write_document", "submit", "manage_sharing"].includes(action) &&
    student
  ) {
    return { allowed: true, basis: "project-student" };
  }

  if (
    ["comment", "mark_reviewed"].includes(action) &&
    (mentor || coMentor || reviewer)
  ) {
    return {
      allowed: true,
      basis: mentor
        ? "project-mentor"
        : coMentor
          ? "project-co-mentor"
          : "project-reviewer",
    };
  }

  if (action === "request_revision" && (mentor || coMentor)) {
    return {
      allowed: true,
      basis: mentor ? "project-mentor" : "project-co-mentor",
    };
  }

  return { allowed: false, basis: "none" };
}

function courseForAssignment(
  state: ReferenceAuthorizationState,
  assignmentId: string,
): string | null {
  return oneParent(
    state.assignmentCourse,
    "assignmentId",
    assignmentId,
    "courseId",
  );
}

function courseDecision(
  state: ReferenceAuthorizationState,
  userId: string,
  courseId: string,
  action: AuthorizationAction,
): ReferenceAuthorizationDecision {
  const rows = state.courseRoles.filter((row) => row.courseId === courseId);
  if (
    ["manage_course", "manage_assignment", "view_roster"].includes(action) &&
    hasRole(rows, userId, "teacher", "assistant")
  ) {
    const teacher = hasRole(rows, userId, "teacher");
    return {
      allowed: true,
      basis: teacher ? "course-teacher" : "course-assistant",
    };
  }
  return { allowed: false, basis: "none" };
}

function institutionDecision(
  state: ReferenceAuthorizationState,
  userId: string,
  institutionId: string,
  action: AuthorizationAction,
): ReferenceAuthorizationDecision {
  const rows = state.institutionRoles.filter(
    (row) => row.institutionId === institutionId,
  );
  if (
    ["manage_policy", "read_policy", "read_audit"].includes(action) &&
    hasRole(rows, userId, "admin")
  ) {
    return { allowed: true, basis: "institution-admin" };
  }
  if (
    ["read_policy", "read_audit"].includes(action) &&
    hasRole(rows, userId, "auditor")
  ) {
    return { allowed: true, basis: "institution-auditor" };
  }
  return { allowed: false, basis: "none" };
}

/**
 * Executable reference semantics for the vNext authorization model.
 *
 * This is deliberately not a production policy engine. The future OpenFGA
 * adapter must be cross-tested against the same scenario corpus before it may
 * replace this reference in runtime decisions.
 */
export function evaluateReferenceAuthorization(input: {
  state: ReferenceAuthorizationState;
  principalId: string;
  action: AuthorizationAction;
  resource: AuthorizationResource;
  currentTime?: string;
}): ReferenceAuthorizationDecision {
  const { state, principalId, action, resource, currentTime } = input;
  if (!principalId.trim() || !resource.id.trim()) {
    return { allowed: false, basis: "none" };
  }

  if (resource.type === "course") {
    return courseDecision(state, principalId, resource.id, action);
  }

  if (resource.type === "assignment") {
    const courseId = courseForAssignment(state, resource.id);
    return courseId
      ? courseDecision(state, principalId, courseId, action)
      : { allowed: false, basis: "none" };
  }

  if (resource.type === "institution") {
    return institutionDecision(state, principalId, resource.id, action);
  }

  if (resource.type === "institution_policy") {
    const institutionId = oneParent(
      state.policyInstitution,
      "policyId",
      resource.id,
      "institutionId",
    );
    return institutionId
      ? institutionDecision(state, principalId, institutionId, action)
      : { allowed: false, basis: "none" };
  }

  if (resource.type === "audit_record") {
    const institutionId = oneParent(
      state.auditInstitution,
      "auditRecordId",
      resource.id,
      "institutionId",
    );
    return institutionId
      ? institutionDecision(state, principalId, institutionId, action)
      : { allowed: false, basis: "none" };
  }

  const projectId = projectForResource(state, resource);
  if (!projectId) return { allowed: false, basis: "none" };

  const breakGlass = activeBreakGlass(
    state,
    principalId,
    resource,
    currentTime,
  );

  if (resource.type === "submission") {
    if (action === "read_submission") {
      return projectDecision(
        state,
        principalId,
        projectId,
        "read_shared_revision",
        breakGlass,
      );
    }
    if (action === "finalize_submission") {
      return projectDecision(
        state,
        principalId,
        projectId,
        "submit",
        false,
      );
    }
    if (action === "review_submission") {
      return projectDecision(
        state,
        principalId,
        projectId,
        "mark_reviewed",
        false,
      );
    }
    return { allowed: false, basis: "none" };
  }

  if (resource.type === "evidence_package") {
    const rows = state.evidenceRoles.filter(
      (row) => row.evidencePackageId === resource.id,
    );
    const student = projectRole(state, projectId, principalId, "student");
    const viewer = hasRole(rows, principalId, "viewer");
    const exporter = hasRole(rows, principalId, "exporter");

    if (action === "append_evidence" && student) {
      return { allowed: true, basis: "project-student" };
    }
    if (
      action === "read_evidence" &&
      (student || viewer || exporter || breakGlass)
    ) {
      return {
        allowed: true,
        basis: student
          ? "project-student"
          : viewer
            ? "evidence-viewer"
            : exporter
              ? "evidence-exporter"
              : "break-glass",
      };
    }
    if (action === "export_evidence" && (student || exporter)) {
      return {
        allowed: true,
        basis: student ? "project-student" : "evidence-exporter",
      };
    }
    return { allowed: false, basis: "none" };
  }

  return projectDecision(
    state,
    principalId,
    projectId,
    action,
    breakGlass,
  );
}
