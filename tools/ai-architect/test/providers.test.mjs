import test from "node:test";
import assert from "node:assert/strict";
import { createProviderRegistry } from "../src/providers/registry.mjs";

const config={providers:{
  openrouter:{keyEnv:"OPENROUTER_API_KEY"},openai:{keyEnv:"OPENAI_API_KEY"},anthropic:{keyEnv:"ANTHROPIC_API_KEY"},
  gemini:{keyEnv:"GEMINI_API_KEY"},xai:{keyEnv:"XAI_API_KEY"},local:{enabled:true},
  notdiamond:{enabled:false,keyEnv:"NOTDIAMOND_API_KEY",minOutcomes:100,minPerTask:30}
}};
test("provider registry availability follows credentials and includes xAI",()=>{
  const registry=createProviderRegistry(config,{env:{OPENAI_API_KEY:"test-key",XAI_API_KEY:"x"},allowMock:false});
  assert.equal(registry.get("openai").available(),true);assert.equal(registry.get("xai").available(),true);
  assert.equal(registry.get("anthropic").available(),false);assert.equal(registry.get("openrouter").available(),false);assert.equal(registry.get("local").available(),false);
});
test("local provider remains explicit test-only",()=>assert.equal(createProviderRegistry(config,{env:{},allowMock:true}).get("local").available({}),true));
test("Not Diamond readiness requires enablement key data coverage and challengers",()=>{
  const registry=createProviderRegistry(config,{env:{NOTDIAMOND_API_KEY:"test-key"}});
  const not=registry.selector("notdiamond");
  let readiness=not.readiness({totalVerified:1000,perTask:{grammar:100},labelCoverage:1,challengerCount:3});
  assert.equal(readiness.ready,false);assert.ok(readiness.missing.includes("enabled"));
});
test("disabled providers stay unavailable even with credentials",()=>{
  const registry=createProviderRegistry({providers:{
    openrouter:{enabled:false,keyEnv:"OPENROUTER_API_KEY"},openai:{enabled:false,keyEnv:"OPENAI_API_KEY"},
    anthropic:{enabled:false,keyEnv:"ANTHROPIC_API_KEY"},gemini:{enabled:false,keyEnv:"GEMINI_API_KEY"},
    xai:{enabled:false,keyEnv:"XAI_API_KEY"},local:{enabled:false},notdiamond:{enabled:false}
  }},{env:{OPENROUTER_API_KEY:"x",OPENAI_API_KEY:"x",ANTHROPIC_API_KEY:"x",GEMINI_API_KEY:"x",XAI_API_KEY:"x"},allowMock:true});
  for(const id of ["openrouter","openai","anthropic","gemini","xai"])assert.equal(registry.get(id).available(),false);
  assert.equal(registry.get("local").available({}),false);
});
