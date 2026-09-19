export async function persistTelemetryBundle(bundle, env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { stored: false, reason: "not-configured" };
  }
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
    Prefer: "return=minimal"
  };
  const requestResponse = await fetch(base + "/rest/v1/ai_router_requests_v2", {
    method: "POST", headers, body: JSON.stringify(bundle.request)
  });
  if (!requestResponse.ok) {
    console.error("AI router request telemetry write failed", requestResponse.status);
    return { stored: false, reason: "request-write-failed" };
  }
  if (bundle.attempts?.length) {
    const attemptsResponse = await fetch(base + "/rest/v1/ai_router_attempts", {
      method: "POST", headers, body: JSON.stringify(bundle.attempts)
    });
    if (!attemptsResponse.ok) {
      console.error("AI router attempt telemetry write failed", attemptsResponse.status);
      return { stored: false, reason: "attempt-write-failed", requestStored: true };
    }
  }
  return { stored: true, attempts: bundle.attempts?.length || 0 };
}

export function buildTelemetryBundle({ requestId, mode, result = null, promptFingerprint = null, error = null }) {
  const execution = result?.execution || {};
  const routing = result?.routing || {};
  const request = {
    request_id: requestId,
    mode,
    profile: result?.profile || null,
    task_type: result?.analysis?.taskType || null,
    complexity: result?.analysis?.complexity ?? null,
    risk: result?.analysis?.risk ?? null,
    context_tokens_before: result?.contextOptimization?.tokensBefore ?? null,
    context_tokens_after: result?.contextOptimization?.tokensAfter ?? null,
    context_tokens_saved: result?.contextOptimization?.tokensSaved ?? null,
    context_saved_pct: result?.contextOptimization?.percentageSaved ?? null,
    input_tokens_estimated: result?.inputTokens?.estimatedValue ?? result?.inputTokens?.value ?? null,
    final_provider: execution.provider || routing.recommended?.provider || null,
    final_model: execution.model || routing.recommended?.model || null,
    final_reasoning_effort: execution.effort || routing.recommended?.effort || null,
    routing_method: routing.selectionMethod || null,
    routing_reason: routing.recommended?.selectionReason || routing.noCandidateReason || null,
    estimated_baseline_cost_usd: result?.simulator?.baseline?.estimatedP90CostUsd ?? null,
    estimated_routed_cost_usd: result?.simulator?.recommended?.estimatedP90CostUsd ?? null,
    estimated_savings_usd: result?.simulator?.estimatedSavings?.usd ?? null,
    estimated_savings_pct: result?.simulator?.estimatedSavings?.pct ?? null,
    total_actual_cost_usd: execution.totalActualCostUsd ?? null,
    total_actual_tokens: execution.totalActualTokens ?? null,
    total_latency_ms: execution.latencyMs ?? null,
    retry_count: execution.retryCount || 0,
    escalation_count: execution.escalationCount || 0,
    fallback_count: execution.fallbackCount || 0,
    first_pass_success: execution.firstPassSuccess ?? null,
    final_success: execution.finalSuccess ?? null,
    prompt_fingerprint: promptFingerprint,
    error_type: error?.code || null
  };

  const attempts = (result?.attempts || []).map((attempt) => ({
    request_id: requestId,
    attempt_number: attempt.attemptNumber,
    attempt_kind: attempt.attemptKind,
    provider: attempt.provider,
    model: attempt.model,
    reasoning_effort: attempt.effort,
    input_token_method: attempt.inputTokenMethod,
    input_tokens_estimated: attempt.inputTokensEstimated ?? null,
    input_tokens_actual: attempt.usage?.inputTokens ?? null,
    output_p50: attempt.outputP50 ?? null,
    output_p90: attempt.outputP90 ?? null,
    output_p95: attempt.outputP95 ?? null,
    reasoning_p90_predicted: attempt.predictedReasoningP90 ?? null,
    output_tokens_actual: attempt.usage?.outputTokens ?? null,
    visible_output_tokens_actual: attempt.usage?.visibleOutputTokens ?? null,
    reasoning_tokens_actual: attempt.usage?.reasoningTokens ?? null,
    cache_read_tokens: attempt.usage?.cachedInputTokens ?? null,
    cache_write_tokens: attempt.usage?.cacheWriteTokens ?? null,
    estimated_cost_usd: attempt.estimatedCostUsd ?? null,
    actual_cost_usd: attempt.actualCostUsd ?? null,
    actual_cost_source: attempt.actualCostSource || null,
    latency_ms: attempt.latencyMs ?? null,
    verifier_score: attempt.verifierScore ?? null,
    verifier_passed: attempt.verifierPassed ?? null,
    verifier_failures: attempt.verifierFailures || [],
    success: Boolean(attempt.success),
    error_type: attempt.errorType || null,
    transient_error: attempt.transient ?? null
  }));
  return { request, attempts };
}

// Compatibility wrappers retained for V1 callers.
export async function persistTelemetry(record, env = process.env) {
  return persistTelemetryBundle({ request: record, attempts: [] }, env);
}
export function buildTelemetry(args) {
  return buildTelemetryBundle(args).request;
}
