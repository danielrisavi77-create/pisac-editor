function finite(value) {
  return Number.isFinite(Number(value));
}

export function candidateKey(candidate) {
  return `${candidate.provider}|${candidate.model}`;
}

function sameTools(a = [], b = []) {
  return [...a].sort().join(",") === [...b].sort().join(",");
}

function matchesDecisionContext(row, ctx = {}) {
  if (ctx.taskClass && row.taskClass !== ctx.taskClass) return false;
  if (ctx.workflow?.id && row.workflow?.id !== ctx.workflow.id) return false;
  if (ctx.workflow?.version && row.workflow?.version !== ctx.workflow.version) return false;
  if (ctx.prompt?.id && row.prompt?.id !== ctx.prompt.id) return false;
  if (ctx.prompt?.version && row.prompt?.version !== ctx.prompt.version) return false;
  if (ctx.reasoningLevel && row.reasoningLevel !== ctx.reasoningLevel) return false;
  if (ctx.tools && !sameTools(row.tools || [], ctx.tools)) return false;
  return true;
}

export function selectAdaptiveCandidate(candidates = [], stats = [], {
  qualityGate = 0,
  minSamples = 3,
  taskClass = null,
  workflow = null,
  prompt = null,
  reasoningLevel = null,
  tools = null
} = {}) {
  const byCandidate = new Map();
  for (const row of stats || []) {
    if (!row?.provider || !row?.actualModel) continue;
    if (!matchesDecisionContext(row, { taskClass, workflow, prompt, reasoningLevel, tools })) continue;
    const key = `${row.provider}|${row.actualModel}`;
    const prev = byCandidate.get(key);
    if (!prev || (row.evaluatedCount || 0) > (prev.evaluatedCount || 0)) {
      byCandidate.set(key, row);
    }
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
      stat.meanQuality >= qualityGate &&
      finite(stat.meanUtility)
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
        meanUtility: eligible[0].stat.meanUtility,
        matchedDecisionContext: true
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
