import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AIArchitect } from "../../tools/ai-architect/src/index.mjs";

const MAX_PROMPT_CHARS = 12000;
const MAX_SELECTED_CHARS = 6000;
const ALLOWED_PURPOSES = new Set(["explain","brainstorm","language","translate","restructure","generate"]);

function findRepoRoot() {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i += 1) {
      if (existsSync(resolve(dir, ".ai", "project.json"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("AI Architect repository root could not be resolved.");
}

const architect = new AIArchitect({
  repoRoot:findRepoRoot()
});

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

export function createHandler(architectInstance = architect) {
  return async function handler(request) {
  if (request.method !== "POST") {
    return json(405, {ok:false,code:"METHOD_NOT_ALLOWED",message:"POST is required."});
  }

  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (!origin || origin !== requestOrigin) {
    return json(403, {ok:false,code:"ORIGIN_NOT_ALLOWED",message:"A same-origin browser request is required."});
  }

  if (process.env.AI_ARCHITECT_LIVE_ENABLED !== "true") {
    return json(503, {
      ok:false,
      code:"LIVE_AI_DISABLED",
      message:"Live AI is disabled for this deployment. The client may use its clearly labelled demo fallback."
    });
  }
  if (process.env.AI_ARCHITECT_USAGE_POLICY_READY !== "true") {
    return json(503, {
      ok:false,
      code:"USAGE_POLICY_NOT_READY",
      message:"Live AI requires authenticated identity, per-user quotas and distributed rate limiting before public use."
    });
  }

  let body;
  try { body = await request.json(); }
  catch { return json(400, {ok:false,code:"INVALID_JSON",message:"Request body must be valid JSON."}); }

  const prompt = String(body?.prompt || "").trim();
  const purpose = String(body?.purpose || "").trim();
  const selectedText = String(body?.selectedText || "").slice(0, MAX_SELECTED_CHARS);

  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return json(400, {ok:false,code:"INVALID_PROMPT",message:"Prompt is required and must be at most 12,000 characters."});
  }
  if (!ALLOWED_PURPOSES.has(purpose)) {
    return json(400, {ok:false,code:"INVALID_PURPOSE",message:"Unsupported assistant purpose."});
  }

  const result = await architectInstance.execute(prompt, {
    feature:"assistant",
    purpose,
    selectedText:selectedText || null,
    locale:"hr"
  });

  if (!result.ok) {
    const status = result.code === "NO_PROVIDER_AVAILABLE" ? 503 :
      result.code === "RETRIEVAL_REQUIRED" ? 422 :
      /BUDGET|PREDICTED_COST|ACTUAL_COST/.test(result.code || "") ? 422 : 502;
    return json(status, {
      ok:false,
      status:result.status,
      code:result.code,
      message:result.message,
      plan:{
        task:result.plan?.task,
        workflow:result.plan?.workflow ? {id:result.plan.workflow.id,version:result.plan.workflow.version} : null,
        prompt:result.plan?.prompt ? {id:result.plan.prompt.id,version:result.plan.prompt.version} : null,
        retrieval:result.plan?.retrieval,
        verification:result.plan?.verification
      }
    });
  }

  return json(200, {
    ok:true,
    output:result.output,
    execution:{
      status:"live",
      provider:result.provider,
      requestedModel:result.requestedModel,
      actualModel:result.actualModel,
      workflow:{id:result.plan.workflow.id,version:result.plan.workflow.version},
      prompt:{id:result.plan.prompt.id,version:result.plan.prompt.version},
      reasoning:result.plan.reasoning,
      verificationStatus:result.verification?.status || "not-required",
      retryCount:result.retries || 0,
      fallbackCount:result.fallbacks || 0,
      escalationCount:result.escalations || 0,
      costStatus:result.costStatus || "unknown"
    }
  });
  };
}

export default createHandler();

export const config = {
  path:"/api/ai",
  method:"POST",
  rateLimit:{
    windowLimit:10,
    windowSize:60,
    aggregateBy:["ip","domain"]
  }
};
