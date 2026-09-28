import type { NodeId } from "../document";
import { resolveTextAnchor, type TextAnchor } from "../collaboration";

export type ReviewBasis = {
  requestId: string;
  acceptedRevision: number;
  target: TextAnchor;
  reviewedText: string;
  fingerprint: string;
};

export type ReviewBasisEvaluation =
  | { status: "VALID"; resolution: "exact" | "moved" }
  | { status: "REREVIEW_REQUIRED"; reason: "changed" | "missing" | "ambiguous" };

function hashText(value: string): string {
  // FNV-1a 32-bit: deterministic change detector, not a security signature.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createReviewBasis(input: {
  requestId: string;
  acceptedRevision: number;
  target: TextAnchor;
  reviewedText: string;
}): ReviewBasis {
  if (!input.requestId || !Number.isSafeInteger(input.acceptedRevision) || input.acceptedRevision < 0) {
    throw new Error("createReviewBasis: invalid identity or revision");
  }
  if (input.reviewedText !== input.target.quote) {
    throw new Error("createReviewBasis: reviewed text must equal anchor quote");
  }
  return { ...input, fingerprint: hashText(input.reviewedText) };
}

export function evaluateReviewBasis(
  basis: ReviewBasis,
  nodeId: NodeId,
  currentNodeText: string,
): ReviewBasisEvaluation {
  const resolved = resolveTextAnchor(basis.target, nodeId, currentNodeText);
  if (resolved.status === "missing") return { status: "REREVIEW_REQUIRED", reason: "missing" };
  if (resolved.status === "ambiguous") return { status: "REREVIEW_REQUIRED", reason: "ambiguous" };

  const current = currentNodeText.slice(resolved.start, resolved.end);
  if (hashText(current) !== basis.fingerprint || current !== basis.reviewedText) {
    return { status: "REREVIEW_REQUIRED", reason: "changed" };
  }
  return { status: "VALID", resolution: resolved.status };
}
