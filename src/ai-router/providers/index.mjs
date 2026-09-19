import { anthropicAdapter } from "./anthropic.mjs";
import { geminiAdapter } from "./gemini.mjs";
import { openaiAdapter } from "./openai.mjs";
import { xaiAdapter } from "./xai.mjs";

export const DEFAULT_ADAPTERS = Object.freeze({
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  google: geminiAdapter,
  xai: xaiAdapter
});

export function getProviderApiKey(provider, env = process.env) {
  return {
    openai: env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    google: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
    xai: env.XAI_API_KEY
  }[provider] || null;
}

export function configuredProviders(env = process.env) {
  return Object.keys(DEFAULT_ADAPTERS).filter((provider) => Boolean(getProviderApiKey(provider, env)));
}
