import { loadArchitectConfig } from "./config.mjs";
import { recommend, explainPlan } from "./router.mjs";
import { createProviderRegistry } from "./providers/registry.mjs";
import { buildExecutionContext } from "./context.mjs";
import { validateOutput, parseVerifierVerdict } from "./validate-output.mjs";
import { recordOutcome, summarizeOutcomes } from "./outcomes.mjs";

function uniqueCandidateOrder(plan, available) {
  const pref = plan.modelSelection?.preferred;
  const key = (c) => c ? `${c.provider}|${c.model}` : "";
  const availableKeys = new Set(available.map(key));
  const seen = new Set();
  const ordered = [];
  for (const candidate of [availableKeys.has(key(pref)) ? pref : null, ...available]) {
    if (!candidate) continue;
    const k = key(candidate);
    if (seen.has(k)) continue;
    seen.add(k);
    ordered.push(candidate);
  }
  return ordered;
}

function systemPrompt(plan) {
  const parts = [
    plan.prompt.text,
    `Workflow: ${plan.workflow.steps.join(" -> ")}.`,
    `Reasoning policy: ${plan.reasoning}.`,
    `Quality gate: ${plan.qualityGate}.`
  ];
  if (plan.retrieval.required) {
    parts.push("Use only supplied retrieved evidence for claims that require external verification. If evidence is missing or insufficient, say so explicitly.");
  }
  if (plan.verification.required) {
    parts.push("This task requires verification. Do not present uncertain or unverified claims as established facts.");
  }
  return parts.filter(Boolean).join("\n\n");
}

function userPrompt(taskText, context) {
  const sections = [`TASK:\n${taskText}`];
  if (context.selectedText) sections.push(`SELECTED TEXT:\n${context.selectedText}`);
  if (context.retrievedEvidence?.length) {
    sections.push("RETRIEVED EVIDENCE:\n" + context.retrievedEvidence.map((e, i) =>
      `[${i + 1}] ${e.title || "Untitled"}\nSource: ${e.source || "unknown"}\n${e.excerpt || ""}`
    ).join("\n\n"));
  }
  if (context.constraints) sections.push(`CONSTRAINTS:\n${JSON.stringify(context.constraints)}`);
  return sections.join("\n\n");
}

function canonicalModelId(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^(openai|anthropic|google|deepseek|x-ai|meta-llama|mistralai)\//, "");
}

function failureResult(plan, code, message, attempts = [], extra = {}) {
  return {
    ok: false,
    status: "failed",
    code,
    message,
    plan,
    attempts,
    ...extra
  };
}

export class AIArchitect {
  constructor({
    repoRoot = process.cwd(),
    env = process.env,
    fetchImpl = globalThis.fetch,
    outcomeSink = null,
    statsSource = null,
    allowMock = false
  } = {}) {
    this.repoRoot = repoRoot;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.outcomeSink = outcomeSink;
    this.statsSource = statsSource;
    this.allowMock = allowMock;
    this._config = null;
  }

  async config() {
    if (!this._config) this._config = await loadArchitectConfig(this.repoRoot);
    return this._config;
  }

  async plan(taskText, context = {}) {
    const outcomeStats = this.statsSource ? await this.statsSource() : context.outcomeStats;
    return recommend(taskText, this.repoRoot, {
      ...context,
      ...(Array.isArray(outcomeStats) ? { outcomeStats } : {})
    });
  }

  async explain(taskText, context = {}) {
    const plan = await this.plan(taskText, context);
    return { plan, rationale: explainPlan(plan) };
  }

  async execute(taskText, context = {}) {
    const plan = await this.plan(taskText, context);
    const safeContext = buildExecutionContext(
      taskText,
      context,
      plan.contextBudget?.maxChars || 8000
    );

    if (plan.retrieval.required && !plan.retrieval.evidenceProvided) {
      await this.#recordFailure(plan, taskText, context, "RETRIEVAL_REQUIRED", [], 0);
      return failureResult(
        plan,
        "RETRIEVAL_REQUIRED",
        "This task requires retrieved evidence before model execution. Execution was blocked rather than allowing the model to guess."
      );
    }

    const config = await this.config();
    const registry = createProviderRegistry(config.models, {
      env: this.env,
      fetchImpl: this.fetchImpl,
      allowMock: this.allowMock
    });
    const available = registry.availableCandidates(plan.modelSelection?.candidates || [], {
      ...context,
      ...safeContext
    });
    const candidates = uniqueCandidateOrder(plan, available);
    if (!candidates.length) {
      await this.#recordFailure(plan, taskText, context, "NO_PROVIDER_AVAILABLE", [], 0);
      if (context.allowDegraded && context.degradedOutput) {
        return {
          ok:false,
          status:"degraded",
          code:"NO_PROVIDER_AVAILABLE",
          message:"No live provider is available. Returning the explicitly allowed, clearly labelled degraded response.",
          plan,
          output:String(context.degradedOutput),
          attempts:[]
        };
      }
      return failureResult(
        plan,
        "NO_PROVIDER_AVAILABLE",
        "No configured provider has an available API key. No live model call was attempted."
      );
    }

    const retriesPerCandidate = Math.max(0, Number(config.project.execution?.retriesPerCandidate ?? 1));
    const attempts = [];
    let finalFailure = null;

    for (let ci = 0; ci < candidates.length; ci += 1) {
      const candidate = candidates[ci];
      const provider = registry.get(candidate.provider);
      if (!provider) continue;

      for (let attempt = 0; attempt <= retriesPerCandidate; attempt += 1) {
        const started = Date.now();
        try {
          const response = await provider.execute({
            model: candidate.model,
            system: systemPrompt(plan),
            user: userPrompt(taskText, safeContext),
            plan,
            context: { ...context, ...safeContext }
          });
          const latencyMs = Date.now() - started;
          const validation = validateOutput(response.output, plan);
          const attemptRecord = {
            provider: candidate.provider,
            requestedModel: candidate.model,
            actualModel: response.actualModel,
            attempt: attempt + 1,
            latencyMs,
            validation,
            error: null
          };
          attempts.push(attemptRecord);

          if (!validation.passed) {
            attemptRecord.error = "OUTPUT_VALIDATION_FAILED";
            finalFailure = "OUTPUT_VALIDATION_FAILED";
            continue;
          }
          if (response.costUsd != null && response.costUsd > plan.budgets.maxCostUsd) {
            attemptRecord.error = `Cost ${response.costUsd} exceeded maxCostUsd ${plan.budgets.maxCostUsd}`;
            finalFailure = "COST_BUDGET_EXCEEDED";
            continue;
          }

          let verification = { required: plan.verification.required, status: "not-required", passed: true };
          if (plan.verification.required) {
            verification = await this.#verify({
              taskText,
              safeContext,
              plan,
              primary: response,
              primaryCandidate: candidate,
              candidates,
              registry
            });
            if (!verification.passed) {
              finalFailure = verification.status === "unavailable"
                ? "VERIFICATION_UNAVAILABLE"
                : "VERIFICATION_FAILED";
              attemptRecord.error = finalFailure;
              continue;
            }
          }

          const result = {
            ok: true,
            status: "success",
            plan,
            provider: response.provider,
            requestedModel: response.requestedModel,
            actualModel: response.actualModel,
            output: response.output,
            usage: response.usage,
            costUsd: response.costUsd,
            latencyMs,
            validation,
            verification,
            retries: attempt,
            fallbacks: attempts
              .filter((a) => a.provider !== candidate.provider || a.requestedModel !== candidate.model)
              .map((a) => ({ provider:a.provider, model:a.requestedModel, error:a.error || null }))
          };

          await this.recordOutcome({
            project: plan.project?.name,
            feature: plan.feature,
            taskClass: plan.task,
            taskText,
            outputText: response.output,
            workflow: { id:plan.workflow.id, version:plan.workflow.version },
            prompt: { id:plan.prompt.id, version:plan.prompt.version },
            provider: response.provider,
            requestedModel: response.requestedModel,
            actualModel: response.actualModel,
            reasoningLevel: plan.reasoning,
            tools: plan.tools,
            usage: response.usage,
            costUsd: response.costUsd,
            latencyMs,
            retries: attempt,
            fallbacks: result.fallbacks,
            validation,
            verification,
            qualityScore: context.qualityScore,
            success: true
          });

          return result;
        } catch (error) {
          const status = Number(error?.status) || null;
          const timedOut = error?.name === "AbortError";
          const retryable = timedOut || status === 408 || status === 429 || (status != null && status >= 500);
          finalFailure = timedOut ? "PROVIDER_TIMEOUT" : status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_ERROR";
          attempts.push({
            provider: candidate.provider,
            requestedModel: candidate.model,
            actualModel: null,
            attempt: attempt + 1,
            latencyMs: Date.now() - started,
            validation: null,
            error: finalFailure,
            status
          });
          if (!retryable) break;
        }
      }
    }

    if (context.allowDegraded && context.degradedOutput) {
      await this.#recordFailure(
        plan,
        taskText,
        context,
        finalFailure || "DEGRADED_FALLBACK",
        attempts,
        attempts.reduce((sum, a) => sum + (a.latencyMs || 0), 0)
      );
      return {
        ok: false,
        status: "degraded",
        code: finalFailure || "DEGRADED_FALLBACK",
        message: "Live execution did not pass the required gates. A clearly labelled degraded response is available.",
        plan,
        output: String(context.degradedOutput),
        attempts
      };
    }

    await this.recordOutcome({
      project: plan.project?.name,
      feature: plan.feature,
      taskClass: plan.task,
      taskText,
      workflow: { id:plan.workflow.id, version:plan.workflow.version },
      prompt: { id:plan.prompt.id, version:plan.prompt.version },
      provider: attempts.at(-1)?.provider || null,
      requestedModel: attempts.at(-1)?.requestedModel || null,
      actualModel: attempts.at(-1)?.actualModel || null,
      reasoningLevel: plan.reasoning,
      tools: plan.tools,
      usage: { inputTokens:0, outputTokens:0, totalTokens:0 },
      latencyMs: attempts.reduce((sum, a) => sum + (a.latencyMs || 0), 0),
      retries: attempts.length,
      fallbacks: attempts.map((a) => ({ provider:a.provider, model:a.requestedModel, error:a.error || null })),
      validation: null,
      verification: null,
      qualityScore: context.qualityScore,
      success: false,
      failureReason: finalFailure || "ALL_CANDIDATES_FAILED"
    });

    return failureResult(
      plan,
      finalFailure || "ALL_CANDIDATES_FAILED",
      "No candidate produced an output that passed all required gates.",
      attempts
    );
  }

  async #recordFailure(plan, taskText, context, failureReason, attempts = [], latencyMs = 0) {
    await this.recordOutcome({
      project:plan.project?.name,
      feature:plan.feature,
      taskClass:plan.task,
      taskText,
      workflow:{id:plan.workflow.id,version:plan.workflow.version},
      prompt:{id:plan.prompt.id,version:plan.prompt.version},
      provider:attempts.at(-1)?.provider || null,
      requestedModel:attempts.at(-1)?.requestedModel || null,
      actualModel:attempts.at(-1)?.actualModel || null,
      reasoningLevel:plan.reasoning,
      tools:plan.tools,
      usage:{inputTokens:0,outputTokens:0,totalTokens:0},
      latencyMs,
      retries:attempts.length,
      fallbacks:attempts.map((a) => ({
        provider:a.provider,
        model:a.requestedModel,
        error:a.error ? String(a.error).slice(0,300) : null
      })),
      validation:null,
      verification:null,
      qualityScore:context.qualityScore,
      success:false,
      failureReason
    });
  }

  async #verify({ taskText, safeContext, plan, primary, primaryCandidate, candidates, registry }) {
    const alternatives = candidates.filter((c) =>
      c.provider !== primaryCandidate.provider || c.model !== primaryCandidate.model
    );
    if (!alternatives.length) {
      return {
        required: true,
        status: "unavailable",
        passed: false,
        reason: "Independent verification requires a distinct available model candidate."
      };
    }

    const verifierSystem = [
      "You are an independent verifier.",
      "Check whether the proposed answer is supported by the task and supplied evidence.",
      "Check for invented facts, citations, quotations, source details, or unsupported certainty.",
      "Return first line exactly 'VERDICT: PASS' or 'VERDICT: FAIL'.",
      "After the first line, give a concise reason. Do not rewrite the answer."
    ].join("\n");

    const evidence = safeContext.retrievedEvidence?.length
      ? "\n\nEVIDENCE:\n" + JSON.stringify(safeContext.retrievedEvidence)
      : "";
    const verifierUser = `TASK:\n${taskText}${evidence}\n\nANSWER TO VERIFY:\n${primary.output}`;

    const verificationAttempts = [];
    for (const verifierCandidate of alternatives) {
      if (!registry.isAvailable(verifierCandidate, safeContext)) continue;
      const verifier = registry.get(verifierCandidate.provider);
      try {
        const checked = await verifier.execute({
          model: verifierCandidate.model,
          system: verifierSystem,
          user: verifierUser,
          plan,
          context: safeContext
        });
        const sameActualModel = Boolean(
          primary.actualModel &&
          checked.actualModel &&
          canonicalModelId(primary.actualModel) === canonicalModelId(checked.actualModel)
        );
        verificationAttempts.push({
          provider: checked.provider,
          requestedModel: checked.requestedModel,
          actualModel: checked.actualModel,
          sameActualModel
        });
        if (sameActualModel) continue;

        const verdict = parseVerifierVerdict(checked.output);
        return {
          required: true,
          status: verdict.passed ? "passed" : "failed",
          passed: verdict.passed,
          provider: checked.provider,
          requestedModel: checked.requestedModel,
          actualModel: checked.actualModel,
          malformed: Boolean(verdict.malformed),
          attempts: verificationAttempts
        };
      } catch (error) {
        verificationAttempts.push({
          provider: verifierCandidate.provider,
          requestedModel: verifierCandidate.model,
          actualModel: null,
          error: error?.name === "AbortError" ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
          status: Number(error?.status) || null
        });
      }
    }

    return {
      required: true,
      status: "unavailable",
      passed: false,
      reason: "No distinct actual model completed independent verification.",
      attempts: verificationAttempts
    };
  }

  async recordOutcome(record) {
    return recordOutcome(record, this.repoRoot, this.outcomeSink);
  }

  async stats() {
    return summarizeOutcomes(this.repoRoot);
  }
}
