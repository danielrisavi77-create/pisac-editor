/**
 * F2 SharePackage domain — exact-revision mentor share.
 *
 * Pure TypeScript: no Next, Dexie, or Supabase. A SharePackage pins a
 * recipient to exact revision IDs. A later student revision is a different
 * document and stays private until the author issues a new package.
 */

import { isPlainObject, ownProperty } from "../json";

export const SHARE_VISIBILITIES = ["mentor-read", "mentor-comment"] as const;
export type ShareVisibility = (typeof SHARE_VISIBILITIES)[number];

export const SHARE_SCOPES = ["comments", "suggestions", "comments+suggestions"] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

export const SHARE_PACKAGE_STATES = ["active", "revoked"] as const;
export type SharePackageState = (typeof SHARE_PACKAGE_STATES)[number];

export const COMMENT_KINDS = ["comment", "suggestion"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type SharePackage = {
  id: string;
  documentId: string;
  projectId: string;
  authorId: string;
  recipientId: string;
  revisionIds: string[];
  visibility: ShareVisibility;
  scope: ShareScope;
  state: SharePackageState;
  createdAt: string;
  revokedAt: string | null;
};

export type ShareComment = {
  id: string;
  packageId: string;
  revisionId: string;
  nodeId: string | null;
  authorId: string;
  kind: CommentKind;
  body: string;
  createdAt: string;
};

export type ShareValidationCode =
  | "not_object"
  | "invalid_id"
  | "invalid_document"
  | "invalid_project"
  | "invalid_author"
  | "invalid_recipient"
  | "self_share"
  | "empty_revisions"
  | "invalid_revision"
  | "duplicate_revision"
  | "invalid_visibility"
  | "invalid_scope"
  | "invalid_state"
  | "revoked_without_timestamp"
  | "active_with_revoked_at"
  | "invalid_created_at";

export type ShareValidationResult =
  | { ok: true; value: SharePackage }
  | { ok: false; code: ShareValidationCode };

function isIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validateSharePackage(input: unknown): ShareValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, code: "not_object" };
  }
  const id = ownProperty(input, "id");
  const documentId = ownProperty(input, "documentId");
  const projectId = ownProperty(input, "projectId");
  const authorId = ownProperty(input, "authorId");
  const recipientId = ownProperty(input, "recipientId");
  const revisionIdsRaw = ownProperty(input, "revisionIds");
  const visibility = ownProperty(input, "visibility");
  const scope = ownProperty(input, "scope");
  const state = ownProperty(input, "state");
  const createdAt = ownProperty(input, "createdAt");
  const revokedAt = ownProperty(input, "revokedAt");

  if (!isUuid(id)) return { ok: false, code: "invalid_id" };
  if (!isUuid(documentId)) return { ok: false, code: "invalid_document" };
  if (!isUuid(projectId)) return { ok: false, code: "invalid_project" };
  if (!isUuid(authorId)) return { ok: false, code: "invalid_author" };
  if (!isUuid(recipientId)) return { ok: false, code: "invalid_recipient" };
  if (authorId === recipientId) return { ok: false, code: "self_share" };
  if (!Array.isArray(revisionIdsRaw) || revisionIdsRaw.length === 0) {
    return { ok: false, code: "empty_revisions" };
  }
  const revisionIds: string[] = [];
  const seen = new Set<string>();
  for (const rev of revisionIdsRaw) {
    if (!isUuid(rev)) return { ok: false, code: "invalid_revision" };
    if (seen.has(rev)) return { ok: false, code: "duplicate_revision" };
    seen.add(rev);
    revisionIds.push(rev);
  }
  if (!SHARE_VISIBILITIES.includes(visibility as ShareVisibility)) {
    return { ok: false, code: "invalid_visibility" };
  }
  if (!SHARE_SCOPES.includes(scope as ShareScope)) {
    return { ok: false, code: "invalid_scope" };
  }
  if (!SHARE_PACKAGE_STATES.includes(state as SharePackageState)) {
    return { ok: false, code: "invalid_state" };
  }
  if (!isIso(createdAt)) return { ok: false, code: "invalid_created_at" };
  if (state === "revoked") {
    if (!isIso(revokedAt)) return { ok: false, code: "revoked_without_timestamp" };
  } else if (revokedAt !== null) {
    return { ok: false, code: "active_with_revoked_at" };
  }

  return {
    ok: true,
    value: {
      id,
      documentId,
      projectId,
      authorId,
      recipientId,
      revisionIds,
      visibility: visibility as ShareVisibility,
      scope: scope as ShareScope,
      state: state as SharePackageState,
      createdAt,
      revokedAt: state === "revoked" ? (revokedAt as string) : null,
    },
  };
}

export function mentorCanSeeRevision(
  pkg: SharePackage,
  revisionId: string,
): boolean {
  return pkg.state === "active" && pkg.revisionIds.includes(revisionId);
}

export function revokeSharePackage(
  pkg: SharePackage,
  revokedAt: string,
): ShareValidationResult {
  return validateSharePackage({
    ...pkg,
    state: "revoked",
    revokedAt,
  });
}

/**
 * A later student revision is never appended onto an existing package.
 * Visibility of new work requires a new package (or an explicit reissue).
 */
export function reissueSharePackage(args: {
  previous: SharePackage;
  newId: string;
  revisionIds: string[];
  createdAt: string;
}): ShareValidationResult {
  return validateSharePackage({
    ...args.previous,
    id: args.newId,
    revisionIds: args.revisionIds,
    state: "active",
    createdAt: args.createdAt,
    revokedAt: null,
  });
}
