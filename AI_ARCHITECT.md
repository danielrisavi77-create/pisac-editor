# AI Architect v0.2

AI Architect is the central AI decision and execution layer for Pisač. It separates **what a task needs** from **which provider/model happens to execute it**.

## Architecture

```text
User action
  -> task/context extraction
  -> AIArchitect.plan()
  -> task classification
  -> risk + complexity
  -> ProjectProfile
  -> versioned workflow
  -> versioned prompt
  -> tool/retrieval/verification policy
  -> capability tier
  -> adaptive provider/model candidate selection
  -> AIArchitect.execute()
  -> retry/fallback
  -> output validation
  -> independent verification when required
  -> privacy-safe outcome telemetry
  -> evaluated outcomes feed later routing
```

A stronger model is never used as a substitute for missing retrieval, testing, document-fidelity checks or independent verification.

## Stable API

```js
import { AIArchitect } from "./tools/ai-architect/src/index.mjs";

const architect = new AIArchitect({ repoRoot: process.cwd() });

const plan = await architect.plan(task, context);
const explanation = await architect.explain(task, context);
const result = await architect.execute(task, context);
await architect.recordOutcome(outcome);
const stats = await architect.stats();
```

For a production persistent store, inject `outcomeSink` and `statsSource`. The core does not require a particular database.

## ProjectProfile

`scanRepo()` inspects repository structure instead of routing only from user text. The profile includes:

- README/manifests/configuration;
- languages and directory structure;
- current AI UI/provider/server-call signals;
- tests and GitHub Actions;
- persistence/storage signals;
- Netlify/Vercel/Docker deployment signals;
- security/env/auth signals;
- AGENTS/CLAUDE/CODEX/Copilot/Cursor instruction files when present;
- Pisač product signals such as Student/Mentor views, citations, comments and DOCX references.

## Routing decisions

Every plan can independently specify:

- task class;
- complexity and risk;
- workflow + version;
- prompt + version;
- capability tier;
- model/provider candidates;
- reasoning level;
- tools;
- whether retrieval is mandatory;
- whether independent verification is mandatory;
- context budget;
- temperature and output-token budget;
- quality gate;
- max cost and max latency;
- fallback policy.

## Provider abstraction

Prepared adapters:

- OpenRouter;
- OpenAI;
- Anthropic;
- Google Gemini;
- local/mock provider for deterministic tests;
- Not Diamond selector adapter, disabled until project-specific eval readiness is satisfied.

Feature code never calls those providers directly. All live calls should go through `AIArchitect.execute()`.

## Fail-closed behavior

The execution layer:

1. blocks retrieval-required tasks when evidence is absent;
2. tries the preferred candidate;
3. retries according to policy;
4. tries alternative provider/model candidates;
5. validates the output;
6. requires a distinct verifier for high-risk tasks;
7. returns a clearly labelled degraded result only when explicitly allowed;
8. otherwise returns an explicit failure.

A degraded or unverified response is never reported as a successful live result.

## Outcome learning and privacy

Outcome records can contain:

- project and feature;
- task class;
- versioned workflow and prompt;
- provider;
- requested and actual model;
- reasoning level and tools;
- input/output token usage;
- cost and latency;
- retries and fallbacks;
- validation and verification result;
- quality/eval score;
- success/failure and reason;
- timestamp.

Full task and output text are not stored by default. The local record contains SHA-256 hashes and lengths.

Adaptive selection only uses outcomes with a real quality/eval score. A cheaper candidate that does not meet the route quality gate cannot outrank a qualifying candidate.

## CLI

Requires Node 20+; CI uses Node 24.

```bash
cd tools/ai-architect

npm test
npm run validate
npm run scan
npm run recommend -- "Provjeri citate i DOI-jeve u radu"
npm run explain -- "Jezično doradi ovaj akademski odlomak"
npm run execute -- "Jezično doradi ovaj akademski odlomak" --context='{"purpose":"language"}'
npm run stats
npm run eval
```

`explain` exposes a short decision rationale (task mapping, risk/complexity, workflow/prompt, verification and routing basis), not private chain-of-thought.

## Pisač browser integration

`public/assets/ai-client.js` sends Assistant requests to `/api/ai`. The Netlify function runs AI Architect server-side, enforces same-origin browser requests, and has a code-based per-IP/domain rate limit.

The static Python preview still works. Because Python does not serve Netlify Functions, Assistant calls fall back to the old canned response **with an explicit “Demo odgovor” label**. This preserves the prototype without pretending the response came from a live model.

## Required secrets

For the manual Promptfoo benchmark, GitHub Actions needs:

- `OPENROUTER_API_KEY`

For deployed live inference, first explicitly enable the endpoint in the Netlify environment:

- `AI_ARCHITECT_LIVE_ENABLED=true`

Then configure one or more provider keys:

- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

`NOTDIAMOND_API_KEY` is reserved for a future learned-router phase and is not currently required.

Because Pisač does not yet have authentication, live inference is opt-in rather than activated by the presence of a provider key. Rate limiting reduces abuse risk but does not replace user authentication or account-level usage quotas.

## Evaluation

Default CI is deterministic, has no provider secrets and incurs no model cost. It runs:

- unit/regression tests;
- config/schema cross-reference validation;
- golden routing evals;
- ProjectProfile scan;
- recommend/explain smoke tests;
- browser/server syntax checks.

Live Promptfoo evaluation is a separate manual workflow and uploads the JSON result as an Actions artifact.

## Current product boundary

See [docs/AI_FEATURE_AUDIT.md](docs/AI_FEATURE_AUDIT.md) for the distinction between what Pisač already implements, what was previously UI-only, and what remains future work.
