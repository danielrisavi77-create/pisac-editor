# AI Router V1

AI Router sits between Pisač and model providers. V1 optimizes for the cheapest configured model that satisfies a bootstrap capability tier, while collecting the data needed for a later empirical quality predictor.

## Modes

- `preview`: no provider call. Uses a clearly labelled heuristic input-token estimate and returns candidate P50/P90 budgets and predicted P90 cost.
- `count`: protected. Uses the provider token-count endpoint for the selected model, then reruns routing with the exact input count.
- `execute`: protected. Performs exact counting, routes, calls the selected model, and returns actual usage, cost, latency and prediction error.

Endpoint after Netlify deploy: `POST /api/ai-router`.

## Security

`count` and `execute` require `Authorization: Bearer <AI_ROUTER_SHARED_SECRET>`. Do not place this secret or provider API keys in `public/`. The current editor has no user authentication, so browser-side execution is intentionally not enabled in V1.

## Request example

```json
{
  "mode": "preview",
  "profile": "standard",
  "prompt": "Analiziraj ovaj odlomak i predloži tri poboljšanja.",
  "context": "...",
  "desiredOutputTokens": 900
}
```

Profiles: `fast`, `standard`, `quality`, `critical`.

## Calibration loop

Every protected run can write one row to `ai_router_requests` when Supabase server credentials are configured. Stored fields include task type, complexity, selected model, predicted P50/P90 output, actual input/output/reasoning tokens, predicted/actual cost and latency. This dataset is the basis for replacing bootstrap heuristics with per-task empirical success and token models.

## Current limits

- Bootstrap auto-routing ships with verified OpenAI GPT-5.6 Luna/Terra/Sol pricing. The catalog can be overridden with `AI_ROUTER_CATALOG_JSON`.
- OpenAI exact-count and execution adapters are implemented first. Anthropic and Gemini adapters are the next provider-neutral step.
- V1 does not claim that tier heuristics are measured quality probabilities. They are bootstrap routing rules only.
- Preview token count is an approximation. Protected `count` and `execute` modes mark provider counts as exact.

## Next milestone

Add provider adapters, deterministic validators by task type, escalation on validation failure, and an offline calibration job that learns output P50/P90 and pass probability from `ai_router_requests`.
