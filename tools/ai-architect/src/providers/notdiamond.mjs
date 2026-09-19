export function createNotDiamondSelector(config = {}, runtime = {}) {
  const env = runtime.env || process.env;
  return {
    id: "notdiamond",
    kind: "selector",
    available() {
      return Boolean(config.enabled && env[config.keyEnv || "NOTDIAMOND_API_KEY"]);
    },
    readiness(stats = []) {
      const evaluated = (stats || []).reduce((sum, row) => sum + (row.evaluatedCount || 0), 0);
      const required = Number(config.minOutcomes || 50);
      return {
        ready: this.available() && evaluated >= required,
        evaluated,
        required,
        reason: !config.enabled
          ? "disabled"
          : !env[config.keyEnv || "NOTDIAMOND_API_KEY"]
            ? "missing-key"
            : evaluated < required
              ? "insufficient-project-evals"
              : "ready"
      };
    },
    async select() {
      throw new Error("Not Diamond selection is intentionally not active until project-specific eval readiness is satisfied.");
    }
  };
}
