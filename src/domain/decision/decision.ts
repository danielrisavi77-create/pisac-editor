import type { AcademicObjectRef } from "../dependency";

export type DecisionKind = "research" | "methodology" | "interpretation";
export type AcademicDecision = {
  id: string;
  documentId: string;
  revision: number;
  kind: DecisionKind;
  title: string;
  rationale: string;
  createdBy: string;
  createdAt: string;
  affects: readonly AcademicObjectRef[];
};

export function createAcademicDecision(input: AcademicDecision): AcademicDecision {
  if (!input.id || !input.documentId || !input.createdBy || !input.title.trim() || !input.rationale.trim()) {
    throw new Error("createAcademicDecision: required field missing");
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error("createAcademicDecision: invalid revision");
  if (Number.isNaN(Date.parse(input.createdAt))) throw new Error("createAcademicDecision: invalid createdAt");
  const seen=new Set<string>();
  const affects=input.affects.filter(ref=>{const k=`${ref.type}:${ref.id}`;if(!ref.id||seen.has(k))return false;seen.add(k);return true;});
  return {...input,title:input.title.trim(),rationale:input.rationale.trim(),affects};
}

export function decisionsAffecting(decisions: readonly AcademicDecision[], ref: AcademicObjectRef): AcademicDecision[] {
  return decisions.filter(d=>d.affects.some(x=>x.type===ref.type&&x.id===ref.id));
}
