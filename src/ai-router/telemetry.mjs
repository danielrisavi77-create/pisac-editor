export async function persistTelemetry(record, env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { stored: false, reason: "not-configured" };
  const endpoint = env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/ai_router_requests";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(record)
  });
  if (!response.ok) {
    const message = await response.text();
    console.error("AI router telemetry write failed", response.status, message.slice(0, 500));
    return { stored: false, reason: "write-failed" };
  }
  return { stored: true };
}

export function buildTelemetry({ requestId, mode, result, success = true, error = null }) {
  const selected = result?.routing?.recommended;
  const execution = result?.execution;
  return {
    request_id: requestId,
    mode,
    profile: result?.profile || null,
    task_type: result?.analysis?.taskType || null,
    complexity: result?.analysis?.complexity ?? null,
    risk: result?.analysis?.risk ?? null,
    provider: selected?.provider || null,
    model: selected?.model || null,
    reasoning_effort: selected?.effort || null,
    input_tokens_estimated: result?.inputTokens?.estimatedValue ?? (result?.inputTokens?.method === "heuristic" ? result.inputTokens.value : null),
    input_tokens_actual: result?.inputTokens?.method === "provider-exact" ? result.inputTokens.value : execution?.usage?.inputTokens || null,
    output_p50: selected?.tokenBudget?.totalBilledOutput?.p50 || null,
    output_p90: selected?.tokenBudget?.totalBilledOutput?.p90 || null,
    output_tokens_actual: execution?.usage?.outputTokens || null,
    reasoning_tokens_actual: execution?.usage?.reasoningTokens || null,
    estimated_cost_usd: selected?.estimatedCostUsd ?? null,
    actual_cost_usd: execution?.actualCostUsd ?? null,
    latency_ms: execution?.latencyMs ?? null,
    success,
    error: error ? String(error).slice(0, 1000) : null
  };
}
