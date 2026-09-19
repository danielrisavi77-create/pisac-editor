function finite(value) {
  return Number.isFinite(Number(value));
}

export function candidateKey(candidate) {
  return `${candidate.provider}|${candidate.model}`;
}

export function selectAdaptiveCandidate(candidates = [], stats = [], {
  qualityGate = 0,
  minSamples = 3
} = {}) {
  const byCandidate = new Map();
  for (const row of stats || []) {
    if (!row?.provider || !row?.actualModel) continue;
    const key = `${row.provider}|${row.actualModel}`;
    byCandidate.set(key, row);
  }

  const eligible = candidates
    .map((candidate, index) => {
      const stat = byCandidate.get(candidateKey(candidate));
      return { candidate, stat, index };
    })
    .filter(({ stat }) =>
      stat &&
      stat.evaluatedCount >= minSamples &&
      finite(stat.meanQuality) &&
      stat.meanQuality >= qualityGate
    )
    .sort((a, b) =>
      (b.stat.meanUtility - a.stat.meanUtility) ||
      (b.stat.meanQuality - a.stat.meanQuality) ||
      (a.index - b.index)
    );

  if (eligible.length) {
    return {
      candidate: eligible[0].candidate,
      basis: "project-outcomes",
      evidence: {
        evaluatedCount: eligible[0].stat.evaluatedCount,
        meanQuality: eligible[0].stat.meanQuality,
        meanUtility: eligible[0].stat.meanUtility
      }
    };
  }

  return {
    candidate: candidates[0] || null,
    basis: candidates.length ? "configured-priority" : "none",
    evidence: null
  };
}

export function qualityGateAllows(stat, qualityGate, minSamples = 3) {
  return Boolean(
    stat &&
    stat.evaluatedCount >= minSamples &&
    finite(stat.meanQuality) &&
    stat.meanQuality >= qualityGate
  );
}
