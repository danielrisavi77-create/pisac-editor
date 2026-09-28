import type { TextAnchor } from "../collaboration";
import type { NodeId } from "../document";
import { resolveTextAnchor } from "../collaboration";

export type ProtectedFactKind = "number" | "statistic" | "verbatim-quote" | "term";
export type ProtectedFact = {
  id: string;
  kind: ProtectedFactKind;
  target: TextAnchor;
  expectedText: string;
};

export type ProtectedFactEvaluation =
  | { status: "UNCHANGED"; resolution: "exact" | "moved" }
  | { status: "CHANGED"; before: string; after: string }
  | { status: "MISSING" }
  | { status: "AMBIGUOUS" };

export function createProtectedFact(input: ProtectedFact): ProtectedFact {
  if (!input.id || !input.expectedText) throw new Error("createProtectedFact: required field missing");
  if (input.expectedText !== input.target.quote) throw new Error("createProtectedFact: expected text must equal anchor quote");
  return { ...input };
}

export function evaluateProtectedFact(
  fact: ProtectedFact,
  nodeId: NodeId,
  currentNodeText: string,
): ProtectedFactEvaluation {
  const resolved=resolveTextAnchor(fact.target,nodeId,currentNodeText);
  if(resolved.status==="missing"){
    // If the node still exists but the exact quote does not, we can only call
    // this changed when the original hint still addresses a non-empty span.
    const candidate=currentNodeText.slice(fact.target.startHint,fact.target.endHint);
    if(candidate && candidate!==fact.expectedText) return {status:"CHANGED",before:fact.expectedText,after:candidate};
    return {status:"MISSING"};
  }
  if(resolved.status==="ambiguous") return {status:"AMBIGUOUS"};
  const current=currentNodeText.slice(resolved.start,resolved.end);
  if(current!==fact.expectedText) return {status:"CHANGED",before:fact.expectedText,after:current};
  return {status:"UNCHANGED",resolution:resolved.status};
}
