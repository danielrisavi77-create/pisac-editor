import test from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "../src/providers/http.mjs";
import { createOpenRouterProvider } from "../src/providers/openrouter.mjs";
import { createOpenAIProvider } from "../src/providers/openai.mjs";
import { createAnthropicProvider } from "../src/providers/anthropic.mjs";
import { createGeminiProvider } from "../src/providers/gemini.mjs";
import { validateOutput } from "../src/validate-output.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers:{"content-type":"application/json"}
  });
}

test("HTTP provider errors preserve status without leaking raw provider body", async () => {
  await assert.rejects(
    fetchJson("https://provider.test", {}, {
      fetchImpl:async () => jsonResponse({error:"secret-provider-body"}, 400)
    }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.message, "Provider HTTP 400");
      assert.equal(error.message.includes("secret-provider-body"), false);
      return true;
    }
  );
});

test("HTTP 429 status remains available for retry policy", async () => {
  await assert.rejects(
    fetchJson("https://provider.test", {}, {
      fetchImpl:async () => jsonResponse({error:"rate limited"}, 429)
    }),
    (error) => {
      assert.equal(error.status, 429);
      return true;
    }
  );
});

test("fetch timeout surfaces AbortError", async () => {
  await assert.rejects(
    fetchJson("https://provider.test", {}, {
      timeoutMs:5,
      fetchImpl:async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted","AbortError")), {once:true});
      })
    }),
    (error) => error?.name === "AbortError"
  );
});

test("malformed successful OpenRouter response becomes empty output and fails output validation", async () => {
  const provider = createOpenRouterProvider(
    {enabled:true,keyEnv:"OPENROUTER_API_KEY"},
    {env:{OPENROUTER_API_KEY:"test-key"},fetchImpl:async () => new Response("not-json",{status:200})}
  );
  const result = await provider.execute({
    model:"openrouter/auto",
    system:"system",
    user:"user",
    plan:{capabilityTier:"low",budgets:{maxLatencyMs:1000},outputBudgetTokens:100}
  });
  assert.equal(result.output, "");
  assert.equal(validateOutput(result.output, {task:"generic"}).passed, false);
});

test("OpenRouter maps model usage cost and auto-router cost tier", async () => {
  let body;
  const provider = createOpenRouterProvider(
    {enabled:true,keyEnv:"OPENROUTER_API_KEY"},
    {
      env:{OPENROUTER_API_KEY:"test-key"},
      fetchImpl:async (_url, options) => {
        body=JSON.parse(options.body);
        return jsonResponse({
          model:"openai/gpt-5.6-sol",
          choices:[{message:{content:"ok"}}],
          usage:{prompt_tokens:12,completion_tokens:7,total_tokens:19,cost:0.004}
        });
      }
    }
  );
  const result=await provider.execute({
    model:"openrouter/auto",
    system:"system",
    user:"user",
    plan:{capabilityTier:"critical",temperature:0.9,outputBudgetTokens:123,budgets:{maxLatencyMs:1000}}
  });
  assert.equal(body.plugins[0].id,"auto-router");
  assert.equal(body.plugins[0].cost_tier,"max");
  assert.equal("temperature" in body,false);
  assert.equal(body.max_tokens,123);
  assert.equal(result.actualModel,"openai/gpt-5.6-sol");
  assert.deepEqual(result.usage,{inputTokens:12,outputTokens:7,totalTokens:19});
  assert.equal(result.costUsd,0.004);
});

test("OpenAI Responses adapter maps output/usage and sends output budget", async () => {
  let body;
  const provider=createOpenAIProvider(
    {enabled:true,keyEnv:"OPENAI_API_KEY"},
    {
      env:{OPENAI_API_KEY:"test-key"},
      fetchImpl:async (_url,options)=>{
        body=JSON.parse(options.body);
        return jsonResponse({
          model:"gpt-5.6-sol",
          output:[{content:[{type:"output_text",text:"openai ok"}]}],
          usage:{input_tokens:20,output_tokens:8,total_tokens:28}
        });
      }
    }
  );
  const result=await provider.execute({
    model:"gpt-5.6-sol",
    system:"system",
    user:"user",
    plan:{reasoning:"high",outputBudgetTokens:321,budgets:{maxLatencyMs:1000}}
  });
  assert.equal(body.max_output_tokens,321);
  assert.deepEqual(body.reasoning,{effort:"high"});
  assert.equal(result.output,"openai ok");
  assert.deepEqual(result.usage,{inputTokens:20,outputTokens:8,totalTokens:28});
});

test("Anthropic adapter maps text/usage and uses output_config effort without sampling params", async () => {
  let body;
  const provider=createAnthropicProvider(
    {enabled:true,keyEnv:"ANTHROPIC_API_KEY"},
    {
      env:{ANTHROPIC_API_KEY:"test-key"},
      fetchImpl:async (_url,options)=>{
        body=JSON.parse(options.body);
        return jsonResponse({
          model:"claude-opus-5",
          content:[{type:"text",text:"anthropic ok"}],
          usage:{input_tokens:31,output_tokens:11}
        });
      }
    }
  );
  const result=await provider.execute({
    model:"claude-opus-5",
    system:"system",
    user:"user",
    plan:{reasoning:"high",temperature:0.8,outputBudgetTokens:456,budgets:{maxLatencyMs:1000}}
  });
  assert.deepEqual(body.output_config,{effort:"high"});
  assert.equal("temperature" in body,false);
  assert.equal(body.max_tokens,456);
  assert.equal(result.output,"anthropic ok");
  assert.deepEqual(result.usage,{inputTokens:31,outputTokens:11,totalTokens:42});
});

test("Gemini adapter maps candidate content usage and modelVersion", async () => {
  let body;
  const provider=createGeminiProvider(
    {enabled:true,keyEnv:"GEMINI_API_KEY"},
    {
      env:{GEMINI_API_KEY:"test-key"},
      fetchImpl:async (_url,options)=>{
        body=JSON.parse(options.body);
        return jsonResponse({
          modelVersion:"gemini-3.8-flash",
          candidates:[{content:{parts:[{text:"gemini ok"}]}}],
          usageMetadata:{promptTokenCount:14,candidatesTokenCount:9,totalTokenCount:23}
        });
      }
    }
  );
  const result=await provider.execute({
    model:"gemini-3.8-flash",
    system:"system",
    user:"user",
    plan:{temperature:0.2,outputBudgetTokens:222,budgets:{maxLatencyMs:1000}}
  });
  assert.equal(body.generationConfig.temperature,0.2);
  assert.equal(body.generationConfig.maxOutputTokens,222);
  assert.equal(result.actualModel,"gemini-3.8-flash");
  assert.equal(result.output,"gemini ok");
  assert.deepEqual(result.usage,{inputTokens:14,outputTokens:9,totalTokens:23});
});
