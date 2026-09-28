export type LineageConfidence = "declared" | "reproducible";
export type LineageStatus = "CURRENT" | "STALE";

export type DatasetArtifact = {
  id: string;
  version: string;
  fingerprint: string;
  label: string;
};

export type AnalysisSpec = {
  id: string;
  label: string;
  confidence: LineageConfidence;
};

export type AnalysisResult = {
  id: string;
  analysisId: string;
  datasetId: string;
  datasetVersion: string;
  datasetFingerprint: string;
  label: string;
  value: string;
  confidence: LineageConfidence;
};

export type ResultEvaluation =
  | { status: "CURRENT" }
  | { status: "STALE"; reason: "dataset-version-changed" | "dataset-fingerprint-changed" };

export function createAnalysisResult(input: AnalysisResult): AnalysisResult {
  if (!input.id || !input.analysisId || !input.datasetId || !input.datasetVersion || !input.datasetFingerprint || !input.value) {
    throw new Error("createAnalysisResult: required field missing");
  }
  if (input.confidence === "reproducible") {
    throw new Error("createAnalysisResult: reproducible status requires a verified execution record");
  }
  return { ...input };
}

export function evaluateAnalysisResult(result: AnalysisResult, current: DatasetArtifact): ResultEvaluation {
  if (current.id !== result.datasetId || current.version !== result.datasetVersion) {
    return { status: "STALE", reason: "dataset-version-changed" };
  }
  if (current.fingerprint !== result.datasetFingerprint) {
    return { status: "STALE", reason: "dataset-fingerprint-changed" };
  }
  return { status: "CURRENT" };
}

export function createReproducibleResult(
  input: Omit<AnalysisResult, "confidence">,
  execution: { verified: true; engine: string; executionId: string },
): AnalysisResult & { execution: typeof execution } {
  if (!execution.engine || !execution.executionId) throw new Error("createReproducibleResult: execution evidence missing");
  return { ...input, confidence: "reproducible", execution };
}
