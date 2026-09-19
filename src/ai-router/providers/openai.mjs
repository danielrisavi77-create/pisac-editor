const OPENAI_BASE = "https://api.openai.com/v1";

export async function countOpenAIInput({ apiKey, model, prompt, context = "", instructions = "" }) {
  requireKey(apiKey);
  const input = buildInput(prompt, context);
  const response = await fetch(OPENAI_BASE + "/responses/input_tokens", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input,
      ...(instructions ? { instructions } : {})
    })
  });
  const data = await readJson(response);
  if (!response.ok) throw providerError("OpenAI token count", response.status, data);
  return { inputTokens: data.input_tokens, raw: data };
}

export async function generateOpenAI({
  apiKey, model, prompt, context = "", instructions = "", effort = "medium", maxOutputTokens
}) {
  requireKey(apiKey);
  const body = {
    model,
    input: buildInput(prompt, context),
    max_output_tokens: maxOutputTokens,
    store: false
  };
  if (instructions) body.instructions = instructions;
  if (effort && effort !== "provider-default") body.reasoning = { effort };

  const started = Date.now();
  const response = await fetch(OPENAI_BASE + "/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await readJson(response);
  const latencyMs = Date.now() - started;
  if (!response.ok) throw providerError("OpenAI response", response.status, data);

  return {
    text: extractText(data),
    status: data.status || "completed",
    latencyMs,
    usage: normalizeUsage(data.usage),
    responseId: data.id || null
  };
}

function buildInput(prompt, context) {
  if (!context) return String(prompt || "");
  return [
    { role: "user", content: [{ type: "input_text", text: "CONTEXT\n" + String(context) }] },
    { role: "user", content: [{ type: "input_text", text: "TASK\n" + String(prompt || "") }] }
  ];
}

function normalizeUsage(usage = {}) {
  return {
    inputTokens: usage.input_tokens || 0,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens || 0,
    cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens || 0,
    totalTokens: usage.total_tokens || 0
  };
}

function extractText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function requireKey(apiKey) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { return { message: text }; }
}

function providerError(label, status, data) {
  const message = data?.error?.message || data?.message || "Unknown provider error";
  const error = new Error(label + " failed (" + status + "): " + message);
  error.status = status;
  return error;
}
