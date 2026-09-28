import type { ReviewBasisEvaluation } from "../review";
import type { SharePackage } from "../collaboration";

export type Viewer =
  | { kind: "owner"; userId: string }
  | { kind: "recipient"; userId: string };

export type ReviewAttentionInput = {
  requestId: string;
  documentId: string;
  currentRevision: number;
  evaluation: ReviewBasisEvaluation;
  ownerId: string;
  sharePackages: readonly SharePackage[];
};

export type AttentionItem = {
  id: string;
  kind: "REVIEW_REREQUIRED";
  requestId: string;
  revision: number;
  reason: "missing" | "ambiguous" | "changed";
  visibility: "private-owner" | "shared-recipient";
};

function sharedWithRecipient(
  input: ReviewAttentionInput,
  recipientId: string,
): boolean {
  return input.sharePackages.some(
    (pkg) =>
      pkg.documentId === input.documentId &&
      pkg.recipientId === recipientId &&
      pkg.revokedAt === null &&
      pkg.scope.revision === input.currentRevision &&
      pkg.scope.visibility === "review",
  );
}

export function projectReviewAttention(
  input: ReviewAttentionInput,
  viewer: Viewer,
): AttentionItem[] {
  if (input.evaluation.status === "VALID") return [];

  const base = {
    id: `review:${input.requestId}:r${input.currentRevision}`,
    kind: "REVIEW_REREQUIRED" as const,
    requestId: input.requestId,
    revision: input.currentRevision,
    reason: input.evaluation.reason,
  };

  if (viewer.kind === "owner") {
    if (viewer.userId !== input.ownerId) return [];
    return [{ ...base, visibility: "private-owner" }];
  }

  if (!sharedWithRecipient(input, viewer.userId)) return [];
  return [{ ...base, visibility: "shared-recipient" }];
}
