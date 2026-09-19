import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { privacyEnvelope } from "./context.mjs";

const DEFAULT_BASELINES = {
  costUsd: 0.10,
  latencyMs: 30000,
  tokens: 12000
};

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

export function normalizedUtility(record = {}, baselines = DEFAULT_BASELINES, weights = {}) {
  const hasQuality = record.qualityScore !== null && record.qualityScore !== undefined && record.qualityScore !== "";
  const quality = hasQuality && Number.isFinite(Number(record.qualityScore)) ? clamp01(record.qualityScore) : null;
  if (quality == null) return null;
  const hasCost = record.costUsd !== null && record.costUsd !== undefined && record.costUsd !== "";
  const cost = hasCost && Number.isFinite(Number(record.costUsd))
    ? clamp01(Number(record.costUsd) / baselines.costUsd)
    : null;
  if (cost == null) return null;
  const latency = clamp01((Number(record.latencyMs) || 0) / baselines.latencyMs);
  const tokens = clamp01((Number(record.usage?.totalTokens) || 0) / baselines.tokens);
  const failure = record.success === false ? 1 : 0;
  const w = { quality:0.62, cost:0.12, latency:0.08, tokens:0.06, failure:0.12, ...weights };
  return w.quality * quality - w.cost * cost - w.latency * latency - w.tokens * tokens - w.failure * failure;
}

export function outcomeKey(record) {
  return [
    record.taskClass || "generic",
    `${record.workflow?.id || "workflow"}@${record.workflow?.version || "unknown"}`,
    `${record.prompt?.id || "prompt"}@${record.prompt?.version || "unknown"}`,
    record.provider || "provider",
    record.actualModel || record.requestedModel || "model",
    record.reasoningLevel || "reasoning",
    (record.tools || []).slice().sort().join(",")
  ].join("|");
}

export function sanitizeOutcome(record = {}) {
  const privacy = privacyEnvelope(record.taskText || "", record.outputText, {});
  const clean = {
    project: record.project || null,
    feature: record.feature || null,
    taskClass: record.taskClass || "generic",
    workflow: record.workflow || null,
    prompt: record.prompt || null,
    provider: record.provider || null,
    requestedModel: record.requestedModel || null,
    actualModel: record.actualModel || null,
    reasoningLevel: record.reasoningLevel || null,
    tools: Array.isArray(record.tools) ? record.tools : [],
    usage: {
      inputTokens: Number(record.usage?.inputTokens) || 0,
      outputTokens: Number(record.usage?.outputTokens) || 0,
      totalTokens: Number(record.usage?.totalTokens) || 0
    },
    costUsd: record.costUsd !== null && record.costUsd !== undefined && record.costUsd !== "" && Number.isFinite(Number(record.costUsd))
      ? Number(record.costUsd)
      : null,
    latencyMs: Number(record.latencyMs) || 0,
    retries: Number(record.retries) || 0,
    fallbacks: Array.isArray(record.fallbacks) ? record.fallbacks : [],
    validation: record.validation || null,
    verification: record.verification || null,
    qualityScore: record.qualityScore !== null && record.qualityScore !== undefined && record.qualityScore !== "" && Number.isFinite(Number(record.qualityScore))
      ? Number(record.qualityScore)
      : null,
    success: record.success !== false,
    failureReason: record.failureReason || null,
    timestamp: record.timestamp || new Date().toISOString(),
    privacy
  };
  clean.utility = normalizedUtility(clean);
  clean.key = outcomeKey(clean);
  clean.eligibleForLearning = clean.qualityScore != null && clean.utility != null;
  return clean;
}

export async function recordOutcome(record, repoRoot = process.cwd(), sink = null) {
  const clean = sanitizeOutcome(record);
  if (typeof sink === "function") {
    await sink(clean);
    return clean;
  }
  const path = resolve(repoRoot, ".ai", "runtime", "outcomes.jsonl");
  await mkdir(dirname(path), { recursive:true });
  await appendFile(path, JSON.stringify(clean) + "\n", "utf8");
  return clean;
}

export async function readOutcomes(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, ".ai", "runtime", "outcomes.jsonl");
  let text = "";
  try { text = await readFile(path, "utf8"); } catch { return []; }
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function summarizeOutcomes(repoRoot = process.cwd()) {
  const rows = await readOutcomes(repoRoot);
  const groups = new Map();

  for (const row of rows) {
    const current = groups.get(row.key) || {
      key: row.key,
      taskClass: row.taskClass,
      workflow: row.workflow,
      prompt: row.prompt,
      provider: row.provider,
      actualModel: row.actualModel,
      reasoningLevel: row.reasoningLevel,
      tools: row.tools || [],
      count:0,
      evaluatedCount:0,
      totalUtility:0,
      totalQuality:0,
      failures:0
    };
    current.count += 1;
    current.failures += row.success ? 0 : 1;
    if (row.qualityScore != null && row.utility != null) {
      current.evaluatedCount += 1;
      current.totalUtility += Number(row.utility);
      current.totalQuality += Number(row.qualityScore);
    }
    groups.set(row.key, current);
  }

  return [...groups.values()].map((g) => ({
    key:g.key,
    taskClass:g.taskClass,
    workflow:g.workflow,
    prompt:g.prompt,
    provider:g.provider,
    actualModel:g.actualModel,
    reasoningLevel:g.reasoningLevel,
    tools:g.tools,
    count:g.count,
    evaluatedCount:g.evaluatedCount,
    meanUtility:g.evaluatedCount ? g.totalUtility / g.evaluatedCount : null,
    meanQuality:g.evaluatedCount ? g.totalQuality / g.evaluatedCount : null,
    failureRate:g.count ? g.failures / g.count : 0
  })).sort((a,b) => (b.meanUtility ?? -Infinity) - (a.meanUtility ?? -Infinity));
}
