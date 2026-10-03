import fc from "fast-check";

/**
 * Shared fast-check settings for the `property` Vitest project.
 *
 * FC_NUM_RUNS raises the run count for deep (nightly) runs without changing the
 * tests. FC_SEED replays a failure: fast-check prints `seed` and `path` when a
 * property fails, and the same seed reproduces the same counterexample.
 */
const numRuns = Number(process.env.FC_NUM_RUNS ?? 100);
if (!Number.isInteger(numRuns) || numRuns < 1) {
  throw new Error(`FC_NUM_RUNS must be a positive integer, got "${process.env.FC_NUM_RUNS}"`);
}

const seedEnv = process.env.FC_SEED;
const seed = seedEnv === undefined || seedEnv === "" ? undefined : Number(seedEnv);
if (seed !== undefined && !Number.isInteger(seed)) {
  throw new Error(`FC_SEED must be an integer, got "${seedEnv}"`);
}

fc.configureGlobal({
  numRuns,
  ...(seed !== undefined ? { seed } : {}),
});
