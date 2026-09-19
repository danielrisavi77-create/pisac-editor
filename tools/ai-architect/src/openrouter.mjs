import { createOpenRouterProvider } from "./providers/openrouter.mjs";

/**
 * Backward-compatible v0.1 helper.
 * New code should use AIArchitect.execute() so routing, validation, fallback,
 * verification and telemetry cannot be bypassed.
 */
export async function routeAndExecute({
  messages,
  model = "openrouter/auto",
  apiKey = process.env.OPENROUTER_API_KEY
}) {
  const provider = createOpenRouterProvider(
    { keyEnv:"OPENROUTER_API_KEY" },
    { env:{ ...process.env, OPENROUTER_API_KEY:apiKey } }
  );
  const system = messages?.find((m) => m.role === "system")?.content || "";
  const user = messages?.filter((m) => m.role !== "system").map((m) => m.content).join("\n") || "";
  const result = await provider.execute({
    model,
    system,
    user,
    plan:{ budgets:{ maxLatencyMs:30000 } }
  });
  return {
    requestedModel:result.requestedModel,
    selectedModel:result.actualModel,
    usage:result.usage,
    output:result.output
  };
}
