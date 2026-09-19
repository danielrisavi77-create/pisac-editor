import { AIArchitect } from "../../tools/ai-architect/src/index.mjs";

const MAX_PROMPT_CHARS = 12000;
const MAX_SELECTED_CHARS = 6000;
const ALLOWED_PURPOSES = new Set(["explain","brainstorm","language","translate","restructure","generate"]);

const architect = new AIArchitect({
  repoRoot:process.cwd(),
  outcomeSink:async (record) => {
    // Privacy-safe telemetry only: sanitizeOutcome strips task/output content.
    console.log("AI_ARCHITECT_OUTCOME", JSON.stringify(record));
  }
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

export default async function handler(request) {
  if (request.method !== "POST") {
    return json(405, {ok:false,code:"METHOD_NOT_ALLOWED",message:"POST is required."});
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

  const result = await architect.execute(prompt, {
    feature:"assistant",
    purpose,
    selectedText:selectedText || null,
    locale:"hr"
  });

  if (!result.ok) {
    const status = result.code === "NO_PROVIDER_AVAILABLE" ? 503 :
      result.code === "RETRIEVAL_REQUIRED" ? 422 : 502;
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
      validationPassed:Boolean(result.validation?.passed),
      verificationStatus:result.verification?.status || "not-required"
    }
  });
}
