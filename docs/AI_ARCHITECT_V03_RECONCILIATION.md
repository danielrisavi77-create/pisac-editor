# AI Architect v0.3 — reconciliation of AI Architect v0.2 and AI Router V2

## Decision

There is one canonical product and public execution system: **AI Architect**.

"Router" is an internal planning/execution subsystem. The separate `src/ai-router` product surface, `/api/ai-router` endpoint and AI Router CI are superseded on the v0.3 branch.

Priority used for every decision:

`correctness > security > reliability > measurable quality > maintainability > cost > speed`

## Component decisions

| Component | Decision | Reason |
| --- | --- | --- |
| Task classification | MERGE BOTH | Keep Pisač purpose/task mapping and research-vs-citation safeguards; use Router V2 only as reference for broader task vocabulary. |
| ProjectProfile / repo awareness | KEEP AI ARCHITECT | Router V2 is request-centric and does not replace repo scanning. |
| Model catalog / registry | REWRITE | One canonical `model-registry.mjs`; verified provider metadata/pricing; `.ai/models.json` is policy-only. |
| Provider abstraction | MERGE BOTH | Keep Architect registry; adopt normalized usage/error/count contracts. |
| OpenAI adapter | ADOPT FROM PR #5, REWRITE | Exact input-token count and richer usage accounting are materially better. |
| Anthropic adapter | ADOPT FROM PR #5, REWRITE | Exact token count, prompt caching and usage accounting; pricing corrected against current official docs. |
| Gemini adapter | ADOPT FROM PR #5, REWRITE | Exact countTokens and thinkingLevel; sampling controls removed for current Gemini 3.x policy. |
| OpenRouter | KEEP + IMPROVE | Preserve Auto Router integration and actual routed model; dynamic pricing must be explicit. |
| xAI / Grok | ADOPT FROM PR #5 | Adds Grok Responses execution and provider-reported billed cost; no invented exact token-count capability. |
| Token counting | ADOPT FROM PR #5 | Provider-exact where official endpoint exists; otherwise clearly labelled heuristic. |
| Context budgeting | ADOPT FROM PR #5, REWRITE | Dedupe/relevance is useful, but evidence/security/citation segments are mandatory and fail closed if they cannot fit. |
| Output/reasoning prediction | ADOPT FROM PR #5 | P50/P90/P95 prediction; empirical calibration only after sufficient samples. |
| Cost prediction | ADOPT FROM PR #5, REWRITE | Separate predicted, budget-ceiling, provider-reported actual, usage-derived actual and unknown cost. |
| Provider pricing | REWRITE | Registry values verified against official sources; no duplicate catalog. |
| Caching pricing | ADOPT FROM PR #5 | Provider-specific cache read/write support. |
| Long-context pricing | ADOPT FROM PR #5 | Explicit threshold/rate rules where officially documented. |
| Hard budgets | ADOPT FROM PR #5, REWRITE | One aggregate request ledger covering all attempts and verifier calls. |
| Retry | ADOPT FROM PR #5 | Same provider/model only after transient operational failure. |
| Fallback | ADOPT FROM PR #5 | Different compatible provider/model after operational failure. |
| Escalation | ADOPT FROM PR #5 | Stronger model/effort after quality/verification failure with bounded corrective context. |
| Verification | MERGE BOTH | Deterministic contract verifier is a local gate; AI Architect independent actual-model verifier remains mandatory for high-risk tasks. |
| Adaptive routing | MERGE BOTH, REWRITE | No invented quality probability. Expected cost per successful verified task activates only with sufficient verified production outcomes. |
| Outcome telemetry | MERGE BOTH, REWRITE | Request/attempt/verification/final records; no full prompt/output bodies by default. |
| Empirical calibration | ADOPT FROM PR #5, REWRITE | Durable calibration matrix backed by verified outcomes. |
| Cost per success | ADOPT FROM PR #5, FIX | Use total request spend divided by successful verified requests, not isolated attempt cost. |
| Dashboard metrics | ADOPT FROM PR #5 | Requests, success, retry/fallback/escalation, cost, latency, prediction error, provider/task-model metrics. |
| Supabase persistence | ADOPT FROM PR #5, REWRITE | Canonical `ai_architect_*` schema; RLS; service-role-only internal views; no automatic production migration. |
| Security | MERGE BOTH | Keep public endpoint kill switches/same-origin/Netlify rate limit; retain server-only service role and sanitized errors. |
| Rate limiting | KEEP AI ARCHITECT | Netlify distributed edge rate limit remains the public defense-in-depth mechanism. Instance-local Router V2 map is dropped. |
| Secrets | KEEP AI ARCHITECT | Provider/service-role secrets are server-only. Router shared secret is not an end-user auth mechanism. |
| Endpoint design | KEEP AI ARCHITECT | One public endpoint: `POST /api/ai`. |
| CLI | KEEP AI ARCHITECT + EXTEND | Canonical commands remain under `ai-architect`; add `evaluate`. |
| CI | KEEP AI ARCHITECT + CONSOLIDATE | One deterministic workflow; one manual paid benchmark; migration/security validation. |
| Benchmarks | MERGE BOTH | Keep golden/Promptfoo; migrate useful deterministic cost-routing scenarios into Architect tests rather than a second product benchmark. |
| Documentation | REWRITE | One name: AI Architect. Router V1/V2 docs are reconciliation inputs, not canonical user documentation. |

## Canonical public API

```js
architect.plan(task, context)
architect.execute(task, context)
architect.explain(task, context)
architect.evaluate({ output, taskClass, verification, externalChecks })
architect.recordOutcome(record) // v0.2 compatibility API
architect.stats()
```

## Canonical model registry

Source of truth:

`tools/ai-architect/src/model-registry.mjs`

`.ai/models.json` contains only provider/routing policy and references registry IDs.

Provider metadata was rechecked against official documentation on 2026-09-19:

- OpenAI models/pricing/token count: https://developers.openai.com/api/docs/models and https://developers.openai.com/api/reference/resources/responses/methods/input_tokens
- Anthropic models/pricing/token count: https://platform.claude.com/docs/en/models/overview and https://platform.claude.com/docs/en/api/messages-count-tokens
- Gemini models/pricing/token count: https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/api/tokens
- xAI Grok: https://docs.x.ai/developers/models/grok-4.6
- OpenRouter Auto: https://openrouter.ai/openrouter/auto

## Quality rule

A registry capability rank is **not** a success probability.

Before enough verified outcomes exist, routing uses transparent capability/cost/latency policy. Numeric expected success and expected cost per successful verified task are only exposed after the configured minimum verified sample count.

A candidate below an empirically measurable hard quality gate cannot win because it is cheaper.

## Aggregate budget rule

The request budget is global across:

- initial call;
- retries;
- provider/model fallbacks;
- quality escalations;
- independent verifier calls;
- measured tool/retrieval costs when they become available.

Unknown actual cost is never treated as zero.

## Verification rule

Deterministic verification and independent model verification have different roles:

1. **Contract verifier**: schema/format/citations/external deterministic checks.
2. **Independent actual-model verifier**: required for configured high-risk tasks; a route resolving to the same actual model as the primary response does not count as independent verification.

Neither verifier invents a statistical quality probability.

## Durable outcomes

v0.3 differentiates:

- request;
- execution attempt;
- independent verification attempt;
- final result.

The Supabase migration is:

`supabase/migrations/2026091903_ai_architect_v03.sql`

It is prepared but must not be applied to production automatically.

The already-merged `2026091901_ai_router_v1.sql` remains in repository history as a legacy migration artifact; no active v0.3 runtime writes to its tables.

## Public live endpoint

Canonical endpoint: `POST /api/ai`.

Safe defaults:

```env
AI_ARCHITECT_LIVE_ENABLED=false
AI_ARCHITECT_USAGE_POLICY_READY=false
```

Public live inference remains blocked until Pisač has a trustworthy identity/auth layer, per-user quotas/budgets and distributed rate limiting. Same-origin and edge rate limits are defense in depth, not user authentication.

## Superseded Router surfaces

The v0.3 branch removes active V1 surfaces:

- `src/ai-router/**`
- `netlify/functions/ai-router.mjs`
- `/api/ai-router`
- `.github/workflows/ai-router.yml`
- V1 root test/package surface

PR #5 is not merged as-is. Its useful mechanisms are selectively reconciled into AI Architect.
