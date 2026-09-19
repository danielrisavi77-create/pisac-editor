# Pisač — AI feature audit (AI Architect v0.3)

## Product reality

Pisač remains an academic editor prototype with Student/Mentor views, citations/literature, comments, provenance events and AI insertion tracking. The Assistant UI supports purposes such as explanation, brainstorming, language editing, translation, restructuring and generation.

The browser never receives provider credentials. Assistant requests use the canonical server-side endpoint `/api/ai`. If live execution is unavailable, the prototype may show the old canned response only as an explicitly labelled **Demo odgovor**.

## Canonical v0.3 execution path

```text
Assistant UI
  -> public/assets/ai-client.js
  -> POST /api/ai
  -> AIArchitect.plan()
  -> ProjectProfile + task/risk/complexity
  -> versioned prompt/workflow
  -> context budget
  -> canonical model registry
  -> token/cost prediction + aggregate hard budget
  -> provider execution
  -> retry / fallback / escalation
  -> deterministic contract verification
  -> independent actual-model verification when required
  -> privacy-safe request/attempt/verification/final telemetry
  -> durable calibration when OutcomeStore is configured
```

There is no active `/api/ai-router` endpoint or separate AI Router execution product in v0.3.

## What v0.3 actually implements

- repo-aware ProjectProfile;
- canonical model/provider registry;
- OpenAI, Anthropic, Gemini, xAI, OpenRouter and local/mock adapters;
- exact provider token counting where officially available;
- context dedupe/relevance budgeting with mandatory evidence protection;
- output/reasoning P50/P90/P95 prediction;
- predicted vs actual/unknown cost semantics;
- aggregate request budgets;
- explicit retry/fallback/escalation;
- deterministic contract verifier;
- independent actual-model verifier;
- request/attempt/verification/final telemetry;
- Local/Noop/Supabase OutcomeStore adapters;
- calibration/dashboard metric primitives;
- UsagePolicy interface;
- secure prepared Supabase migration;
- deterministic CI and manual-only live Promptfoo benchmark.

## Explicitly not finished

The following must not be presented as production-ready features:

- user authentication/identity;
- per-user subscription/quota enforcement;
- production-applied Supabase v0.3 migration;
- automatic web/source retrieval execution from the browser Assistant;
- external DOI/bibliographic retrieval implementation;
- DOCX/OOXML repair execution from Pisač;
- permissioned arbitrary tool broker;
- production empirical routing dataset large enough to claim model success probabilities;
- Not Diamond learned routing.

## Trust boundaries

- Retrieval-required tasks fail closed without evidence.
- High-risk configured tasks require independent actual-model verification.
- Unknown cost is never zero.
- Numeric success probability is not asserted before sufficient verified production outcomes.
- Full prompt/output text is not stored in canonical v0.3 telemetry by default.
- Live endpoint defaults OFF with both `AI_ARCHITECT_LIVE_ENABLED=false` and `AI_ARCHITECT_USAGE_POLICY_READY=false`.
- Same-origin and rate limiting do not replace authentication.

## Production live readiness

Before enabling public live inference, Pisač still needs:

1. trustworthy user identity/auth;
2. per-user daily/monthly quotas and spend budgets;
3. distributed rate limiting tied to identity;
4. production OutcomeStore migration/configuration;
5. live-provider smoke/eval evidence after secrets are configured.
