# AI Architect v0.3 — test coverage parity with the removed Router suites

v0.3 deleted the root suites `tests/ai-router*.test.mjs` (28 tests on `main`).
Per the reconciliation decision "migrate useful deterministic cost-routing
scenarios into Architect tests", the still-meaningful scenarios are re-expressed
in `tools/ai-architect/test/v03-parity.test.mjs` (21 tests).

Ported: aggregate budget ledger over initial/retry/fallback/escalation/verifier
calls; candidate refusal reasons; numeric `minQuality`; retry vs fallback vs
escalation with bounded corrective context; partial attempt telemetry; first-pass
vs final verified success metrics; the predicted / ceiling / provider-reported /
usage-derived / unknown cost split; percentile ordering and the hard output cap;
calibration counting visible output and reasoning once; exact-vs-heuristic token
labelling; context budgeting failing closed; contract verifier codes;
independent-verifier distinctness.

## Judged obsolete (not ported)

1. `Netlify preview is public but does not echo optimized private context` — the
   `/api/ai-router` preview mode is gone; the single public surface is
   `POST /api/ai`, covered by `netlify-handler.test.mjs`.
2. `protected modes reject unauthenticated requests and malformed JSON` — the
   router shared secret is explicitly not an end-user auth mechanism in v0.3;
   same-origin, method, purpose and size rejection are covered by
   `netlify-handler.test.mjs`.
3. `explicit arbitrary tool execution is blocked until a permissioned broker
   exists` — v0.3 has no tool-execution path; `plan.tools` is declarative only.
4. `V2 migration keeps calibration private` — `2026091902_ai_router_v2.sql` is not
   part of v0.3; the equivalent guarantees are asserted against
   `2026091903_ai_architect_v03.sql` in `v03-core.test.mjs`.
5. `registry is provider-neutral` — the catalog was rewritten; `v03-core.test.mjs`
   plus `validateModelRegistry()` assert the canonical registry invariants.
6. `classifier distinguishes core V2 task types` — that vocabulary is not Pisač's
   task set; `router.test.mjs` covers the canonical classes and risk levels.
7. `Flash-Lite minimal thinking` and `Haiku 4.5 phantom reasoning budget` —
   model-specific to the old catalog; ported generically as one test.
8. The five provider adapter tests (normalized usage, Anthropic cache, Gemini
   `thinkingLevel`, xAI cost ticks, sanitized errors) were already migrated on the
   v0.3 branch into `provider-edgecases.test.mjs`.
