export async function loadCalibrationStats({ taskType }, env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !taskType) return {};
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const query = new URLSearchParams({
    select: "*",
    task_type: "eq." + taskType,
    sample_count: "gte.20",
    limit: "200"
  });
  const response = await fetch(base + "/rest/v1/ai_router_calibration_stats?" + query.toString(), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
  if (!response.ok) return {};
  const rows = await response.json();
  const result = {};
  for (const row of rows || []) {
    const key = [row.task_type, row.provider, row.model, row.reasoning_effort || "provider-default"].join("|");
    result[key] = {
      sampleCount: Number(row.sample_count || 0),
      initialSampleCount: Number(row.initial_sample_count || 0),
      outputMedian: nullableNumber(row.output_median),
      outputP90: nullableNumber(row.output_p90),
      outputP95: nullableNumber(row.output_p95),
      reasoningMedian: nullableNumber(row.reasoning_median),
      reasoningP90: nullableNumber(row.reasoning_p90),
      reasoningP95: nullableNumber(row.reasoning_p95),
      successRate: nullableNumber(row.success_rate),
      firstPassSuccessRate: nullableNumber(row.first_pass_success_rate),
      retryRate: nullableNumber(row.retry_rate),
      escalationRate: nullableNumber(row.escalation_rate),
      expectedQualityScore: nullableNumber(row.expected_quality_score),
      medianLatencyMs: nullableNumber(row.median_latency_ms),
      costPerSuccessUsd: nullableNumber(row.cost_per_success_usd)
    };
  }
  return result;
}
function nullableNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
