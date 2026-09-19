function estimateTokens(text) {
  return Math.max(0, Math.ceil(String(text || "").length / 3.6));
}
function normalize(text) {
  return String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
}
function queryTerms(prompt) {
  return new Set(String(prompt || "").toLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu)?.slice(0, 80) || []);
}
function segmentScore(segment, terms, index, total) {
  let score = Number(segment.priority || 0);
  if (segment.pinned) score += 1000;
  if (["security", "policy", "instruction"].includes(segment.type)) score += 900;
  if (["error", "test", "stack_trace"].includes(segment.type)) score += 850;
  if (["system", "project"].includes(segment.type)) score += 500;
  if (["previous_failure", "verification"].includes(segment.type)) score += 450;
  const text = String(segment.text || "").toLowerCase();
  let matches = 0;
  for (const term of terms) if (text.includes(term)) matches += 1;
  score += Math.min(160, matches * 16);
  score += total > 1 ? Math.round((index / (total - 1)) * 20) : 20;
  return score;
}

export function optimizeContext({ prompt, context = "", contextSegments = [], maxContextTokens = 32000 }) {
  const source = [];
  if (context) {
    String(context).split(/\n{2,}/).filter(Boolean).forEach((text, index) => {
      source.push({ text, type: "legacy", source: "context", index });
    });
  }
  contextSegments.forEach((segment, index) => {
    if (segment?.text) source.push({ type: "user", ...segment, index: source.length + index });
  });
  const beforeTokens = source.reduce((sum, segment) => sum + estimateTokens(segment.text), 0);
  const seen = new Set();
  const deduped = [];
  for (const segment of source) {
    const key = normalize(segment.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(segment);
  }
  const terms = queryTerms(prompt);
  const ranked = deduped.map((segment, index) => ({
    ...segment, estimatedTokens: estimateTokens(segment.text), score: segmentScore(segment, terms, index, deduped.length)
  })).sort((a, b) => b.score - a.score || a.estimatedTokens - b.estimatedTokens);
  const selected = [];
  let used = 0;
  for (const segment of ranked) {
    const mandatory = segment.pinned || ["security", "policy", "instruction", "error", "test", "stack_trace"].includes(segment.type);
    if (mandatory || used + segment.estimatedTokens <= maxContextTokens) {
      selected.push(segment);
      used += segment.estimatedTokens;
    }
  }
  selected.sort((a, b) => (a.index || 0) - (b.index || 0));
  const text = selected.map((x) => x.text).join("\n\n");
  const afterTokens = estimateTokens(text);
  return {
    text,
    segments: selected.map(({ text: _text, ...meta }) => meta),
    stats: {
      tokensBefore: beforeTokens, tokensAfter: afterTokens, tokensSaved: Math.max(0, beforeTokens - afterTokens),
      percentageSaved: beforeTokens > 0 ? round2(((beforeTokens - afterTokens) / beforeTokens) * 100) : 0,
      sourceSegments: source.length, selectedSegments: selected.length,
      duplicateSegmentsRemoved: source.length - deduped.length, truncated: selected.length < deduped.length
    },
    method: "deterministic-relevance-v1"
  };
}
export function roughInputTokens({ prompt = "", context = "", instructions = "" }) {
  return Math.max(1, estimateTokens(String(instructions) + "\n" + String(context) + "\n" + String(prompt)) + 24);
}
function round2(value) { return Math.round(value * 100) / 100; }
