# AI Architect v0.3

AI Architect is the single canonical AI planning, execution, verification and measurement system for Pisač.

## Public API

```js
architect.plan(task, context)
architect.execute(task, context)
architect.explain(task, context)
architect.evaluate({ output, taskClass, verification, externalChecks })
architect.recordOutcome(record) // v0.2 compatibility API
architect.stats()
```

There is no separate public AI Router product. Routing is an internal AI Architect subsystem.

## Execution architecture

```text
user action
  -> task/context extraction
  -> ProjectProfile
  -> task/risk/complexity
  -> versioned workflow + prompt
  -> context dedupe/relevance budget
  -> canonical model registry
  -> provider-exact token count when available
  -> token/output/reasoning prediction
  -> predicted cost + cold-cache budget ceiling
  -> aggregate request budget
  -> model/provider selection
  -> execute
       transient operational error -> retry same route
       operational route failure   -> fallback different provider/model
       quality/verifier failure    -> escalation stronger model/effort
  -> deterministic contract verifier
  -> independent actual-model verifier when required
  -> request/attempt/verification/final telemetry
  -> durable calibration
  -> empirical expected cost per successful verified task
```

A stronger model is never used as a substitute for retrieval evidence, deterministic tests, document-fidelity checks or independent verification.

## Canonical model/provider registry

The only capability/pricing source of truth is:

`tools/ai-architect/src/model-registry.mjs`

`.ai/models.json` is policy-only and references canonical registry IDs.

Provider adapters:

- OpenAI
- Anthropic
- Google Gemini
- xAI / Grok
- OpenRouter Auto
- explicit local/mock provider for deterministic tests

Exact provider token counting is used for OpenAI, Anthropic and Gemini where their official count endpoints are available. xAI and OpenRouter preflight counting remain explicitly heuristic unless the provider exposes exact count data.

## Cost semantics

AI Architect differentiates:

- **predicted cost** — catalog-based preflight estimate;
- **budget ceiling** — conservative preflight cost used by hard budget checks;
- **provider-reported billed cost** — authoritative when returned by the provider;
- **usage-derived actual token cost** — derived from actual token usage and canonical rates;
- **unknown cost** — never treated as zero.

Hard budget policy is aggregate across the request: initial attempt, retries, fallbacks, escalations and independent verifier calls.

A provider-side request can still incur cost before the post-response actual budget check runs; v0.3 therefore combines conservative preflight checks with fail-closed post-response accounting rather than claiming a billing-provider hard stop.

## Quality and adaptive routing

Registry capability ranks are not quality percentages.

Before enough verified production outcomes exist, routing uses transparent capability/cost/latency policy. After the configured verified-sample threshold, the calibration layer may expose empirical:

- first-pass success;
- final verified success;
- retry/fallback/escalation probability;
- token P50/P90/P95;
- latency;
- cost per successful verified task.

Expected cost per successful verified task is only used when empirical success probability and measurable cost exist. A model below an empirically measurable hard quality gate cannot win because it is cheaper.

## Verification

Two independent gates are combined:

1. **Deterministic contract verifier** — non-empty/schema/format/citation/external-check rules. It does not output a fake quality probability.
2. **Independent actual-model verifier** — for configured high-risk tasks. A second route resolving to the same actual model as the primary response does not count as independent.

Retrieval-required tasks fail closed before model execution if evidence is missing.

## Context budget

The context optimizer performs exact duplicate removal and deterministic relevance selection. Evidence/security/policy/citation/verification segments are mandatory. If mandatory evidence itself cannot fit, execution fails explicitly instead of dropping it to save cost.

## Durable outcomes

Canonical records distinguish:

- request;
- execution attempt;
- independent verification attempt;
- final result.

Full prompt/output bodies are not stored by default. Request text is represented by a SHA-256 fingerprint and structural telemetry.

Outcome stores:

- local JSONL for development/CLI;
- Supabase adapter when server-side credentials exist;
- Noop store in serverless environments where durable storage is not configured.

Prepared migration:

`supabase/migrations/2026091903_ai_architect_v03.sql`

The migration is intentionally **not applied automatically**.

## Security

Canonical public endpoint:

`POST /api/ai`

Safe deployment defaults:

```env
AI_ARCHITECT_LIVE_ENABLED=false
AI_ARCHITECT_USAGE_POLICY_READY=false
```

Provider keys alone cannot enable public live inference.

The endpoint also enforces same-origin browser requests, input length limits and Netlify rate limiting. Those controls are defense in depth, not authentication.

Public live inference remains blocked until all three exist:

1. trustworthy user identity/authentication;
2. per-user quotas/budgets;
3. distributed rate limiting.

`UsagePolicy` defines the future tier/user/feature quota interface without pretending Pisač already has authentication.

## Not Diamond

Not Diamond is not an active router in v0.3. The adapter exposes readiness only. Readiness requires:

- enough total verified outcomes;
- enough verified samples per task;
- sufficient label coverage;
- multiple challengers;
- explicit enablement and key.

Activation belongs in a later PR after the evidence threshold is actually satisfied.

## CLI

```bash
cd tools/ai-architect
npm test
npm run validate
npm run scan
npm run recommend -- "Provjeri citate i DOI-jeve u radu"
npm run explain -- "Jezično doradi akademski odlomak"
npm run execute -- "Jezično doradi akademski odlomak" --context='{"purpose":"language"}'
npm run evaluate -- '{"ok":true}' --context='{"taskClass":"generic","verification":{"jsonSchema":{"type":"object"}}}'
npm run stats
npm run eval
```

## Evaluation and CI

Default CI uses no provider secrets and performs no paid model calls. It covers deterministic tests, config/registry validation, golden evals, ProjectProfile smoke tests, migration security checks and browser/server syntax.

The live Promptfoo benchmark is manual-only and requires explicit paid-call confirmation plus `OPENROUTER_API_KEY`.

## Reconciliation history

See [docs/AI_ARCHITECT_V03_RECONCILIATION.md](docs/AI_ARCHITECT_V03_RECONCILIATION.md) for the component-by-component decision record explaining what was kept from AI Architect v0.2, adopted/reworked from AI Router V2 and dropped as duplicate infrastructure.
