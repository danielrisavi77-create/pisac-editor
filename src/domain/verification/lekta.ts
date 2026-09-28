import type { CanonicalDocument } from "../document";

export type LektaRequest = {
  document: CanonicalDocument;
  profileId: string;
  protectedFactIds: readonly string[];
};

export type LektaFinding = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  nodeId?: string;
};

export type LektaResult = {
  provider: "lekta";
  mode: "check" | "repair";
  inputFingerprint: string;
  outputDocument: CanonicalDocument;
  findings: readonly LektaFinding[];
};

/**
 * Boundary only. Implementations live outside the domain and must not mint
 * verification claims that the returned data cannot support.
 */
export interface LektaAdapter {
  check(request: LektaRequest): Promise<LektaResult>;
  repair(request: LektaRequest): Promise<LektaResult>;
}
