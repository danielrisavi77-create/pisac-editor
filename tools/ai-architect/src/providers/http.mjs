export async function fetchJson(url, options = {}, {
  timeoutMs = 30000,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation available.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; }
    catch { json = { rawText: text }; }
    if (!response.ok) {
      const error = new Error(`Provider HTTP ${response.status}`);
      error.status = response.status;
      error.code = "PROVIDER_HTTP_ERROR";
      throw error;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeUsage({
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = null
} = {}) {
  const input = Number(inputTokens) || 0;
  const output = Number(outputTokens) || 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: Number(totalTokens) || input + output
  };
}
