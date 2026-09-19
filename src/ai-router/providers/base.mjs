const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class ProviderError extends Error {
  constructor({ provider, operation, status = 500, code = "PROVIDER_ERROR", transient = false, retryAfterMs = null, message }) {
    super(message || provider + " " + operation + " failed.");
    this.name = "ProviderError";
    this.provider = provider;
    this.operation = operation;
    this.status = status;
    this.code = code;
    this.transient = transient;
    this.retryAfterMs = retryAfterMs;
    this.safe = true;
  }
}

export async function fetchJson({ provider, operation, url, headers, body, timeoutMs = 45000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === "AbortError") {
      throw new ProviderError({ provider, operation, status: 504, code: "PROVIDER_TIMEOUT", transient: true,
        message: provider + " request timed out." });
    }
    throw new ProviderError({ provider, operation, status: 503, code: "PROVIDER_NETWORK_ERROR", transient: true,
      message: provider + " network request failed." });
  }
  clearTimeout(timer);

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = {}; }

  if (!response.ok) {
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    throw new ProviderError({
      provider, operation, status: response.status,
      code: response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_HTTP_ERROR",
      transient: TRANSIENT_STATUSES.has(response.status),
      retryAfterMs,
      message: sanitizeProviderMessage(provider, response.status, data)
    });
  }
  return data;
}

export function normalizeUsage({
  inputTokens = 0, uncachedInputTokens = null, cachedInputTokens = 0, cacheWriteTokens = 0,
  outputTokens = 0, visibleOutputTokens = null, reasoningTokens = null, toolTokens = 0,
  totalTokens = null, providerCostUsd = null
} = {}) {
  return {
    inputTokens: integer(inputTokens),
    uncachedInputTokens: uncachedInputTokens == null ? null : integer(uncachedInputTokens),
    cachedInputTokens: integer(cachedInputTokens),
    cacheWriteTokens: integer(cacheWriteTokens),
    outputTokens: integer(outputTokens),
    visibleOutputTokens: visibleOutputTokens == null ? null : integer(visibleOutputTokens),
    reasoningTokens: reasoningTokens == null ? null : integer(reasoningTokens),
    toolTokens: integer(toolTokens),
    totalTokens: totalTokens == null ? integer(inputTokens) + integer(outputTokens) : integer(totalTokens),
    providerCostUsd: Number.isFinite(providerCostUsd) ? providerCostUsd : null
  };
}

export function extractResponseText(output = []) {
  const parts = [];
  for (const item of output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function sanitizeProviderMessage(provider, status, data) {
  const raw = data?.error?.message || data?.message || "";
  const cleaned = String(raw).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]");
  const suffix = cleaned ? ": " + cleaned.slice(0, 240) : "";
  return provider + " returned HTTP " + status + suffix;
}
function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
}
function integer(value) { return Math.max(0, Math.round(Number(value) || 0)); }
