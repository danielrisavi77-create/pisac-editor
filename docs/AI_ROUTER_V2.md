# AI Router V2

AI Router V2 is the provider-neutral execution layer for Pisač. Its optimization target is not the cheapest request. It is the lowest expected cost of a **verified successful task** subject to explicit quality, token, cost, latency and provider constraints.

V2 intentionally follows this maturity order:

1. measurement
2. observability
3. deterministic rules
4. verification
5. production data
6. statistical calibration
7. empirical quality prediction
8. only later, if justified, contextual bandits or ML

It does **not** invent quality probabilities when no measured evidence exists.

## Architecture

Request flow:

\`\`\`text
client/server caller
  -> Netlify security boundary
  -> deterministic task classifier
  -> context optimizer
  -> heuristic preflight token estimate
  -> model registry + candidate generator
  -> budget/capability filtering
  -> provider exact token count where available
  -> provider-specific rerouting
  -> selected execution attempt
  -> deterministic verifier
       PASS -> return
       provider/transient failure -> retry same model
       provider operational failure -> compatible cross-provider fallback
       verifier failure -> stronger model/effort escalation
  -> privacy-first request + attempt telemetry
  -> Supabase calibration views
\`\`\`

The core lives under \`src/ai-router/\` and contains no Pisač-specific business logic.

## Provider interface

Adapters expose the same conceptual contract:

- \`countTokens(...)\`
- \`generate(...)\`
- normalized usage
- provider capability metadata via the registry
- normalized transient/permanent errors
- latency measurement

Adapters:

- OpenAI: \`src/ai-router/providers/openai.mjs\`
- Anthropic: \`src/ai-router/providers/anthropic.mjs\`
- Google Gemini: \`src/ai-router/providers/gemini.mjs\`
- xAI: \`src/ai-router/providers/xai.mjs\`

Common transport/error/usage normalization is in \`providers/base.mjs\`.

### OpenAI

V2 uses the Responses API and the Responses input-token endpoint. Input tokens are counted before execution when credentials are available. Usage is normalized into input, cached input, cache write, visible output and reasoning output.

### Anthropic

V2 uses Messages and \`/v1/messages/count_tokens\`. Cache creation/read tokens are kept separate. Current Claude 5 models use adaptive thinking plus `output_config.effort`; Haiku 4.5 is explicitly modelled with `reasoningModes: ["none"]` so the router does not invent a reasoning-token budget or unsupported effort mode.

### Gemini

V2 uses \`countTokens\` and \`generateContent\`. Gemini usage preserves:

- prompt tokens
- cached input tokens
- visible candidate tokens
- thinking tokens
- tool-use prompt tokens
- total tokens

Billed output prediction treats visible output and thinking as output usage.

### xAI

V2 uses the xAI Responses API. xAI does not currently have a preflight exact token-count adapter in this router, so it remains explicitly labelled heuristic before execution. After execution, if \`cost_in_usd_ticks\` is returned, V2 uses the provider-reported billed cost rather than reconstructing it.

## Model registry

\`src/ai-router/registry.mjs\` is the single model capability/pricing registry.

Each entry can describe:

- provider and model ID
- display name
- capability rank
- stable/preview status
- latency class
- context window
- router output guard
- supported reasoning modes
- tools, structured output, image and file support
- caching support
- token-counting support
- input/output/cache prices
- long-context pricing transitions
- date the source was checked

The default registry was refreshed on **2026-09-19** from official provider documentation.

Current default families include:

- GPT-6 Astra
- GPT-5.6 Luna / Terra / Sol
- Claude Haiku 4.5 / Sonnet 5 / Opus 5 / Fable 5.1
- Gemini 3.5 Flash-Lite / 3.8 Flash / 3.1 Pro Preview
- Grok 4.6

Pricing is configuration, not application logic. Override the complete registry with \`AI_ROUTER_CATALOG_JSON\` when a price/model update must ship before a code release.

The registry's \`capabilityRank\` is a bootstrap routing heuristic. It is **not** a claimed benchmark score or success percentage.

## Current provider-pricing caveats

Provider pricing changes frequently. The registry contains the current values checked on 2026-09-19 and must be refreshed before pricing-sensitive releases.

Important exceptions represented in code:

- GPT-6 Astra and GPT-5.6 models use higher rates after the current long-context threshold.
- GPT-6 Astra and GPT-5.6 models expose cache-write surcharges; hard cost budgets use a conservative cold-cache ceiling.
- Gemini 3.1 Pro Preview has separate rates above 200K input tokens.
- Grok 4.6 has separate rates at/above its long-context pricing threshold.
- Anthropic prompt-cache creation/read prices are separate and cache-write TTL can change the rate.
- xAI exact post-call billed cost is preferred when returned.

Do not calculate provider invoices outside \`pricing.mjs\`.

## Task classifier

\`classifier.mjs\` is deterministic and does not spend LLM tokens.

It recognizes:

- simple Q&A
- summarization
- rewrite
- translation
- academic writing
- academic analysis
- citation/source verification
- coding
- debugging
- repository analysis
- architecture/design
- data analysis
- extraction
- classification
- structured output
- creative writing
- tool-heavy signals
- high-risk production signals

It estimates:

- \`taskType\`
- \`complexity\`
- \`risk\`
- \`contextNeed\`
- \`reasoningNeed\`
- \`toolNeed\`
- \`expectedOutputSize\`
- \`verificationType\`
- required capability rank/capabilities

These are transparent heuristics, not learned quality probabilities.

## Context optimizer

\`context.mjs\` reduces avoidable input cost before routing.

It:

- deduplicates exact normalized segments
- ranks relevant context using deterministic prompt-term overlap
- preserves pinned/system/project/security/policy/instruction evidence
- preserves exact errors, test output and stack traces
- preserves previous verification/failure evidence with high priority
- truncates lower-priority context to a token budget
- never summarizes source text with another LLM in V2

Telemetry exposes:

- tokens before optimization
- tokens after optimization
- tokens saved
- percentage saved
- duplicate segments removed
- source/selected segment counts

The architecture accepts structured \`contextSegments\`, so later semantic retrieval/repo maps can replace the deterministic relevance layer without rewriting the router.

## Token prediction

\`predictor.mjs\` returns:

- visible output P50 / P90 / P95
- reasoning P50 / P90 / P95
- billed output P50 / P90 / P95
- prediction source

Before enough data exists, source is \`heuristic\`.

When a `taskType × provider × model × effort` bucket reaches the configured calibration sample threshold, visible-output and reasoning percentiles are read separately from production telemetry and source becomes `production-empirical`. Visible output is never reconstructed by adding billed output and reasoning twice.

Input count is:

- \`provider-exact\` where the provider adapter supports it
- \`heuristic\` or \`heuristic-fallback\` otherwise

A heuristic count must never be labelled exact.

## Quality estimation

V2 deliberately does not assign arbitrary values such as “Model A = 94%”.

Quality metadata can have these sources:

- \`heuristic\`: capability band/margin only; \`successProbability = null\`
- \`production-empirical\`: measured verifier success after enough samples
- future \`benchmark-derived\` or \`model\`: only if explicitly implemented and evidenced

With enough verified production samples, V2 separates:

- `successProbability`: final verified task success after the bounded plan
- `firstPassSuccessProbability`: verified success on the initial attempt
- `needsRetryProbability`: measured probability that the request needs a same-model operational retry
- `needsEscalationProbability`: measured probability that the request needs a stronger candidate after verification failure
- `expectedQuality`: measured initial verifier score

The candidate planner then estimates retry and escalation cost separately and calculates `expectedTotalCostUsd` plus `expectedCostPerSuccessfulTaskUsd` using final verified success probability.

Without empirical samples, it uses a clearly labelled heuristic Pareto score rather than pretending to know a probability.

## Candidate generation and routing

A candidate is a valid provider + model + reasoning-effort combination.

Candidates are removed when they fail:

- required capability support
- provider allow/deny policy
- stable/preview policy
- context-window limit
- output limit
- heuristic capability floor
- max cost
- max input/output/total token budget
- empirical quality requirement
- latency requirement when enforced

Profiles are objectives, not aliases for a model tier:

### fast

Prioritizes latency, permits low-cost capability when valid, and defaults to no quality escalation.

### economy

Prioritizes cost while retaining a bounded retry/escalation path.

### balanced

Balances cost, latency and reliability reserve.

### quality

Raises the heuristic capability floor and requires verification.

### critical

Uses the highest default capability floor, mandatory verification and the largest bounded retry/escalation budget.

## Budget contract

Per-request \`budget\` supports:

\`\`\`json
{
  "maxCostUsd": 0.20,
  "maxInputTokens": 50000,
  "maxOutputTokens": 12000,
  "maxTotalTokens": 100000,
  "maxLatencyMs": 30000,
  "minQuality": 0.95,
  "requireEmpiricalQuality": false,
  "maxRetries": 1,
  "maxEscalations": 1,
  "allowProviders": ["openai", "anthropic", "google", "xai"],
  "denyProviders": [],
  "allowPreviewModels": true
}
\`\`\`

If `minQuality` is supplied, V2 requires a measured final verified-success probability. A heuristic candidate is rejected with `min_quality_unverifiable`; the router never pretends a numeric quality threshold has been met. `requireEmpiricalQuality: true` can additionally reject all heuristic-quality candidates even when no numeric minimum is supplied.

The router does not silently exceed cost/token budgets. Aggregate cost/token/latency budgets are checked before every new attempt, including retries.

## Verification

\`verifier.mjs\` follows:

**deterministic verification > LLM verification**

V2 currently includes:

- non-empty/minimum response contract
- required/forbidden output patterns
- JSON parse + lightweight top-level schema/required/property type validation
- academic citation/reference signals when explicitly required
- external code-check ingestion for syntax/typecheck/lint/unit/integration/schema checks

A verifier result contains:

- \`passed\`
- \`score\`
- \`failures\`
- \`retryable\`
- \`suggestedEscalation\`
- method

Code execution itself is not performed inside the generic router. The caller supplies deterministic test/check results; future Pisač-specific or repo-specific verifier plugins can perform those checks in their own trusted execution environment.

## Retry, fallback and escalation

These are intentionally different.

### Retry

Same provider/model/effort, only for operational/transient failures such as:

- timeout
- network failure
- 429
- retryable 5xx

Retries are bounded by \`maxRetries\`.

### Fallback

A provider operation remains unavailable after retry. The router chooses a compatible candidate from another provider without increasing the capability floor merely because one provider is unavailable.

### Escalation

The model returned a result but deterministic verification failed. V2 chooses a stronger capability candidate or higher valid effort.

The escalation prompt contains only:

- original task
- previous attempt (bounded)
- explicit verifier failures
- correction instruction

It does not replay the entire historical conversation.

Escalations are bounded by \`maxEscalations\`. There is no unbounded loop.

## Cost simulator and baseline

Preview returns:

- recommended plan
- up to three alternatives
- estimated P90 attempt cost
- cold-cache P90 hard-budget ceiling where applicable
- expected retry cost when empirically measurable
- expected escalation cost when empirically measurable
- expected total plan cost when empirically measurable
- expected cost per successful verified task when empirically measurable
- quality-estimate source
- transparent baseline
- estimated savings

The baseline policy is:

\`strongest-eligible-one-shot-p90\`

This is not a claim about what a user “would have paid”. It is a reproducible comparison against executing the strongest eligible candidate once. Dashboard savings must retain the baseline-policy label.

## Telemetry and privacy

V2 stores aggregate request telemetry and per-attempt telemetry, but **does not store prompt or output bodies**.

It stores only what is needed to calibrate routing:

- request ID
- task features
- context-token before/after metrics
- provider/model/effort
- estimated and actual usage
- cache read/write
- estimated and actual cost
- latency
- verifier result
- retry/fallback/escalation counts
- final success
- safe error type
- short SHA-256 prompt fingerprint

Supabase service-role credentials are server-only.

Migration:

\`supabase/migrations/2026091902_ai_router_v2.sql\`

Important views:

- \`ai_router_calibration_dataset\`
- \`ai_router_calibration_stats\`
- \`ai_router_dashboard_daily\`
- \`ai_router_provider_share\`
- \`ai_router_task_model_stats\`

## Self-calibration

No neural model is trained in V2.

Once enough production samples exist, \`ai_router_calibration_stats\` calculates per \`task_type × provider × model × effort\`:

- sample count
- output median / P90 / P95
- reasoning median / P90 / P95
- final verified success rate
- first-pass success rate
- retry rate
- escalation rate
- average initial verifier quality score
- median latency
- cost per successful attempt

\`calibration.mjs\` loads only buckets above the minimum sample count for token calibration. Empirical success probability uses a higher minimum inside \`quality.mjs\`.

This makes the first learning step measured statistical calibration, not speculative ML.

## Dashboard-ready backend

\`ai_router_dashboard_daily\` supports:

- requests
- successful tasks
- first-pass success
- final success
- average attempts
- input/output/reasoning tokens
- total cost
- cost per request
- cost per successful task
- input-token prediction MAPE
- output P50/P90 prediction MAPE
- output P90 coverage
- estimated baseline cost
- estimated routed cost
- estimated savings
- retry/escalation/fallback metrics

Provider share and task/model verified-success views are separate so a future internal dashboard can query them directly. All calibration/dashboard views use `security_invoker`, revoke access from `anon`/`authenticated`, and grant select only to `service_role`.

## Security boundary

Protected \`count\` and \`execute\` requests require:

\`Authorization: Bearer <AI_ROUTER_SHARED_SECRET>\`

Implemented controls:

- provider API keys server-side only
- Supabase service role server-side only
- constant-time shared-secret comparison
- content-length guard plus prompt/context limits
- provider request timeouts
- bounded retry/escalation loops
- sanitized provider errors
- no raw provider payload returned to clients
- no prompt/output body in telemetry
- prompt fingerprint only
- protected-route instance-local rate guard
- \`store: false\` on Responses providers where supported

### Remaining production security requirement

The in-function rate bucket is only defense-in-depth. Serverless instances do not share memory.

Before exposing protected execution directly to untrusted end users, add a **distributed edge/WAF/authenticated per-user rate limit** (for example Netlify edge controls or a durable shared limiter). The shared secret is a service-to-service boundary, not an end-user authentication system.

Tool execution introduces a separate prompt-injection/SSRF permission surface. V2 does not execute arbitrary user-defined network tools. Add a permissioned tool broker before enabling general tool execution.

## API modes

Endpoint:

\`POST /api/ai-router\`

Modes:

- \`preview\`: no paid provider call
- \`count\`: protected provider preflight count where supported
- \`execute\`: protected routing + execution + verification + bounded retry/fallback/escalation

Example preview:

\`\`\`json
{
  "mode": "preview",
  "profile": "balanced",
  "prompt": "Analiziraj ovaj tekst.",
  "contextSegments": [
    { "type": "project", "text": "Project rule...", "pinned": true },
    { "type": "user", "text": "Relevant source..." }
  ],
  "budget": {
    "maxCostUsd": 0.1,
    "maxTotalTokens": 50000
  }
}
\`\`\`

## Environment variables

See \`.env.example\`.

Provider credentials:

- \`OPENAI_API_KEY\`
- \`ANTHROPIC_API_KEY\`
- \`GEMINI_API_KEY\`
- \`XAI_API_KEY\`

Router/server:

- \`AI_ROUTER_SHARED_SECRET\`
- \`AI_ROUTER_RATE_LIMIT_PER_MINUTE\`
- \`AI_ROUTER_CATALOG_JSON\`

Telemetry:

- \`SUPABASE_URL\`
- \`SUPABASE_SERVICE_ROLE_KEY\`
- \`AI_ROUTER_LOG_PREVIEWS\`

## Testing

Normal CI is fully offline and does not make paid model calls.

Run:

\`\`\`sh
npm test
npm run benchmark
\`\`\`

The deterministic benchmark covers:

- rewrite
- summarization
- academic analysis
- coding
- debugging
- repository analysis
- extraction/structured output
- classification
- long context
- high-risk production signals

Provider adapters use mocked HTTP responses in CI.

## Optional live provider benchmark

\`.github/workflows/ai-router-live.yml\` is manual only.

It requires:

- explicit provider input
- \`confirm_paid_calls = YES\`
- the selected provider secret

It performs one small token count where supported and one deliberately tiny paid generation.

Normal pushes/PRs never invoke this workflow.

## Adding a provider

1. Create \`src/ai-router/providers/<provider>.mjs\`.
2. Implement \`countTokens\` only if an actual preflight count exists. Otherwise explicitly mark it unsupported.
3. Implement \`generate\`.
4. Normalize usage through \`providers/base.mjs\`.
5. Add safe timeout/error normalization.
6. Register the adapter in \`providers/index.mjs\`.
7. Add registry models with official current pricing/capabilities.
8. Add mocked provider tests.
9. Add/refresh documentation sources.
10. Do not expose provider-specific fields above the adapter unless the generic contract truly needs them.

## Adding a model

Add one registry record. Do not add routing \`if model === ...\` logic unless the model has a genuinely unique API/billing rule.

For a pricing update, include:

- current official price
- cache pricing
- long-context rule
- date checked
- context/output limits
- stable/preview state

## Adding a verifier

Keep generic deterministic checks in \`verifier.mjs\`.

Product-specific verification should be injected above the generic router rather than hard-coded into core. A verifier should return the standard contract:

\`\`\`js
{
  passed,
  score,
  failures,
  retryable,
  suggestedEscalation
}
\`\`\`

Never use an LLM verifier where a deterministic contract/test can answer the same question reliably.

## Migration from V1

V2 remains stacked on the V1 branch so V1 can be reviewed independently. After V1 is merged, rebase/retarget the V2 PR to \`main\`.

V1 compatibility exports remain in \`catalog.mjs\`, \`core.mjs\`, and the OpenAI adapter during this transition.

## Future V3 gate

Do not add contextual bandits/ML until telemetry demonstrates that:

- there are enough verified samples per task/model bucket
- heuristic/statistical routing leaves measurable cost or quality on the table
- an offline evaluation can demonstrate improvement without increasing verified failure rate

The next sensible V3 is an internal dashboard + calibration monitoring + provider/model drift detection, followed by a measured learned router only if justified.
