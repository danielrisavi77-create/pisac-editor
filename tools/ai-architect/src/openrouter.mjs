const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export async function routeAndExecute({messages, model="openrouter/auto-beta", apiKey=process.env.OPENROUTER_API_KEY}) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");

  const response = await fetch(ENDPOINT, {
    method:"POST",
    headers:{
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":"application/json",
      "HTTP-Referer": process.env.AI_ARCHITECT_SITE_URL || "https://github.com/danielrisavi77-create/pisac-editor",
      "X-Title": process.env.AI_ARCHITECT_APP_NAME || "AI Architect"
    },
    body:JSON.stringify({model,messages})
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`OpenRouter error ${response.status}: ${JSON.stringify(json)}`);
  }

  return {
    requestedModel:model,
    selectedModel:json.model || null,
    usage:json.usage || null,
    output:json.choices?.[0]?.message?.content ?? null,
    raw:json
  };
}
