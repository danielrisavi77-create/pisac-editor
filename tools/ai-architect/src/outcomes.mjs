import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { utility } from "./router.mjs";

const DEFAULT_BASELINES = {
  costUsd: 0.10,
  latencyMs: 30000,
  tokens: 12000
};

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

export function normalizeOutcome(input = {}, baselines = DEFAULT_BASELINES) {
  const quality = clamp01(input.quality);
  const cost = clamp01((Number(input.costUsd) || 0) / baselines.costUsd);
  const latency = clamp01((Number(input.latencyMs) || 0) / baselines.latencyMs);
  const tokens = clamp01((Number(input.tokens) || 0) / baselines.tokens);
  const failed = input.success === false || Boolean(input.failed);

  return {
    quality,
    cost,
    latency,
    tokens,
    failed
  };
}

export function outcomeKey(record) {
  return [
    record.task || "generic",
    record.workflow || "unknown-workflow",
    record.prompt || "unknown-prompt",
    record.model || record.modelSelector || "unknown-model"
  ].join("|");
}

export async function recordOutcome(record, repoRoot = process.cwd()) {
  if (!record || typeof record !== "object") throw new TypeError("record must be an object");
  const normalized = normalizeOutcome(record);
  const enriched = {
    timestamp: new Date().toISOString(),
    ...record,
    normalized,
    utility: utility(normalized),
    key: outcomeKey(record)
  };

  const path = resolve(repoRoot, ".ai", "runtime", "outcomes.jsonl");
  await mkdir(dirname(path), {recursive:true});
  await appendFile(path, JSON.stringify(enriched) + "\n", "utf8");
  return enriched;
}

export async function summarizeOutcomes(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, ".ai", "runtime", "outcomes.jsonl");
  let text = "";
  try { text = await readFile(path, "utf8"); } catch { return []; }

  const rows = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const groups = new Map();

  for (const row of rows) {
    const key = row.key || outcomeKey(row);
    const current = groups.get(key) || {key,count:0,totalUtility:0,totalQuality:0,failures:0};
    current.count += 1;
    current.totalUtility += Number(row.utility) || 0;
    current.totalQuality += Number(row.normalized?.quality) || 0;
    current.failures += row.normalized?.failed ? 1 : 0;
    groups.set(key,current);
  }

  return [...groups.values()]
    .map(g => ({
      ...g,
      meanUtility:g.totalUtility / g.count,
      meanQuality:g.totalQuality / g.count,
      failureRate:g.failures / g.count
    }))
    .sort((a,b) => b.meanUtility - a.meanUtility);
}
