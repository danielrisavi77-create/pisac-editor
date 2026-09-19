import { createOpenRouterProvider } from "./openrouter.mjs";
import { createOpenAIProvider } from "./openai.mjs";
import { createAnthropicProvider } from "./anthropic.mjs";
import { createGeminiProvider } from "./gemini.mjs";
import { createXAIProvider } from "./xai.mjs";
import { createLocalProvider } from "./local.mjs";
import { createNotDiamondSelector } from "./notdiamond.mjs";

export function createProviderRegistry(modelsConfig={},runtime={}){
  const providers=modelsConfig.providers||{};
  const instances={
    openrouter:createOpenRouterProvider(providers.openrouter||{},runtime),
    openai:createOpenAIProvider(providers.openai||{},runtime),
    anthropic:createAnthropicProvider(providers.anthropic||{},runtime),
    gemini:createGeminiProvider(providers.gemini||{},runtime),
    xai:createXAIProvider(providers.xai||{},runtime),
    local:createLocalProvider(providers.local||{},runtime)
  };
  const selectors={notdiamond:createNotDiamondSelector(providers.notdiamond||{},runtime)};
  return{
    get(id){return instances[id]||null;},
    selector(id){return selectors[id]||null;},
    isAvailable(candidate,context={}){
      const provider=instances[candidate?.provider];
      return Boolean(provider&&provider.available(context));
    },
    availableCandidates(candidates=[],context={}){return candidates.filter(c=>this.isAvailable(c,context));},
    ids(){return Object.keys(instances);}
  };
}
