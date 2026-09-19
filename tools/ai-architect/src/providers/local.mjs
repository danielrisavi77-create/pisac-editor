export function createLocalProvider(config = {}, runtime = {}) {
  return {
    id: "local",
    available(context = {}) {
      return config.enabled !== false && Boolean(runtime.allowMock || context.allowMock || context.mockResponse);
    },
    async execute({ model = "local/mock", context = {} }) {
      if (!(runtime.allowMock || context.allowMock || context.mockResponse)) {
        throw new Error("Local/mock provider is disabled outside explicit test/degraded contexts.");
      }
      const output = context.mockResponse || context.degradedOutput;
      if (!output) throw new Error("Mock provider requires context.mockResponse or context.degradedOutput.");
      return {
        provider: "local",
        requestedModel: model,
        actualModel: model,
        output: String(output),
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        costUsd: 0
      };
    }
  };
}
