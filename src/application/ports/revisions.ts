/**
 * Explicit revision vocabulary at application boundaries.
 *
 * The existing domain model intentionally keeps its historic "revision" field
 * names. New application/integration contracts must say WHAT is being
 * versioned so document revisions and academic-object revisions cannot be
 * accidentally compared.
 */
export type DocumentRevision = number & { readonly __brand: "DocumentRevision" };
export type AcademicObjectRevision = number & { readonly __brand: "AcademicObjectRevision" };

export function asDocumentRevision(value: number): DocumentRevision {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("revision: invalid document revision");
  }
  return value as DocumentRevision;
}

export function asAcademicObjectRevision(value: number): AcademicObjectRevision {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("revision: invalid academic object revision");
  }
  return value as AcademicObjectRevision;
}
