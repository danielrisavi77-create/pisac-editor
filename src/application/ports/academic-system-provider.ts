/**
 * Read-only, provider-neutral academic-system boundary.
 *
 * ISVU, Banner, PeopleSoft, Moodle/LTI and other systems are adapters behind
 * this contract. Their native schemas must not leak into Pisač core objects.
 */
export type AcademicPersonRef = {
  providerId: string;
  externalPersonId: string;
};

export type AcademicMembership = {
  institutionExternalId: string;
  courseExternalId: string;
  personExternalId: string;
  role: "student" | "teacher" | "assistant" | "other";
  active: boolean;
};

export type AcademicCourse = {
  institutionExternalId: string;
  courseExternalId: string;
  code?: string;
  title: string;
  academicYear?: string;
};

export type AcademicAssignment = {
  institutionExternalId: string;
  courseExternalId: string;
  assignmentExternalId: string;
  title: string;
  dueAt?: string | null;
};

export interface AcademicSystemProvider {
  readonly providerId: string;
  getCourse(courseExternalId: string): Promise<AcademicCourse | null>;
  listMemberships(person: AcademicPersonRef): Promise<readonly AcademicMembership[]>;
  listAssignments(courseExternalId: string): Promise<readonly AcademicAssignment[]>;
}
