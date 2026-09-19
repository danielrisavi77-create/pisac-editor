import test from "node:test";
import assert from "node:assert/strict";
import { createProviderRegistry } from "../src/providers/registry.mjs";

const config = {
  providers:{
    openrouter:{keyEnv:"OPENROUTER_API_KEY"},
    openai:{keyEnv:"OPENAI_API_KEY"},
    anthropic:{keyEnv:"ANTHROPIC_API_KEY"},
    gemini:{keyEnv:"GEMINI_API_KEY"},
    local:{enabled:true},
    notdiamond:{enabled:false,keyEnv:"NOTDIAMOND_API_KEY",minOutcomes:50}
  }
};

test("provider registry availability follows explicit credentials", () => {
  const registry = createProviderRegistry(config, {
    env:{OPENAI_API_KEY:"test-key"},
    allowMock:false
  });
  assert.equal(registry.get("openai").available(), true);
  assert.equal(registry.get("anthropic").available(), false);
  assert.equal(registry.get("openrouter").available(), false);
  assert.equal(registry.get("local").available(), false);
});

test("local provider is test-only unless explicitly enabled", () => {
  const registry = createProviderRegistry(config, {env:{},allowMock:true});
  assert.equal(registry.get("local").available({}), true);
});

test("Not Diamond remains gated until explicitly enabled and enough evals exist", () => {
  const registry = createProviderRegistry(config, {
    env:{NOTDIAMOND_API_KEY:"test-key"}
  });
  const readiness = registry.selector("notdiamond").readiness([{evaluatedCount:100}]);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "disabled");
});

test("disabled providers stay unavailable even when a credential exists", () => {
  const registry=createProviderRegistry({
    providers:{
      openrouter:{enabled:false,keyEnv:"OPENROUTER_API_KEY"},
      openai:{enabled:false,keyEnv:"OPENAI_API_KEY"},
      anthropic:{enabled:false,keyEnv:"ANTHROPIC_API_KEY"},
      gemini:{enabled:false,keyEnv:"GEMINI_API_KEY"},
      local:{enabled:false},
      notdiamond:{enabled:false}
    }
  },{
    env:{
      OPENROUTER_API_KEY:"test",
      OPENAI_API_KEY:"test",
      ANTHROPIC_API_KEY:"test",
      GEMINI_API_KEY:"test"
    },
    allowMock:true
  });
  assert.equal(registry.get("openrouter").available(),false);
  assert.equal(registry.get("openai").available(),false);
  assert.equal(registry.get("anthropic").available(),false);
  assert.equal(registry.get("gemini").available(),false);
  assert.equal(registry.get("local").available({}),false);
});
