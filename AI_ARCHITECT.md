# AI Architect v0.1

AI Architect is a repo-native decision layer that answers four questions for each AI task:

1. What kind of task is this?
2. What workflow should execute it?
3. What prompt policy should be used?
4. What model-selection strategy should be used?

The v0.1 pilot is intentionally provider-light. Task classification, risk/complexity assessment, prompt selection and workflow selection work locally without API keys. When `OPENROUTER_API_KEY` is present, execution can use `openrouter/auto-beta` and record the exact model returned by OpenRouter.

## Structure

- `.ai/project.json` — product-level quality/cost/risk priorities.
- `.ai/routing.json` — task → workflow/prompt/reasoning/quality-gate policy.
- `.ai/models.json` — model-selector configuration.
- `.ai/prompts.json` — system prompt policies.
- `.ai/workflows.json` — workflow step definitions.
- `.ai/evals/golden.json` — deterministic routing regression set.
- `tools/ai-architect/` — zero-dependency Node CLI and tests.

## Run

Requires Node 20+.

```bash
cd tools/ai-architect
npm test
npm run scan
npm run recommend -- "Provjeri DOI-jeve i citate u radu"
```

Optional live routing/execution:

```bash
export OPENROUTER_API_KEY=...
node src/cli.mjs execute "Sažmi ovaj zadatak..."
```

## Decision output

A recommendation contains:

- task class;
- complexity 1–5;
- risk level;
- workflow;
- prompt policy;
- reasoning level;
- quality gate;
- capability tier;
- model selector;
- whether independent verification is mandatory.

The system deliberately separates **workflow selection** from **model selection**. A stronger model is not used as a substitute for missing retrieval, verification, testing or document-fidelity checks.

## Next learning layer

v0.2 should persist outcome records with quality, cost, latency, token usage and failures, then compare route variants using a normalized utility function. Once enough project-specific eval data exists, enable the Not Diamond selector in `.ai/models.json` and train a custom router instead of relying only on aggregate routing.

Promptfoo should be added as the external-model evaluation layer after secrets and a stable golden dataset exist; deterministic routing tests remain mandatory and free.
