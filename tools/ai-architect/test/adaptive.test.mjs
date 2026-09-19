import test from "node:test";
import assert from "node:assert/strict";
import { selectAdaptiveCandidate } from "../src/adaptive.mjs";

const candidates = [
  {provider:"openrouter",model:"model-a"},
  {provider:"openrouter",model:"model-b"}
];

test("adaptive routing only learns from matching task/prompt/workflow context", () => {
  const stats = [
    {
      taskClass:"grammar",
      workflow:{id:"direct",version:"2.0.0"},
      prompt:{id:"academic-writing",version:"2.0.0"},
      provider:"openrouter",
      requestedModel:"model-a",
      actualModel:"model-a",
      reasoningLevel:"low",
      tools:[],
      evaluatedCount:5,
      meanQuality:0.94,
      meanUtility:0.70
    },
    {
      taskClass:"citation_verification",
      workflow:{id:"retrieve-verify-judge",version:"2.0.0"},
      prompt:{id:"citation-verification",version:"2.0.0"},
      provider:"openrouter",
      requestedModel:"model-b",
      actualModel:"model-b",
      reasoningLevel:"high",
      tools:["web.search"],
      evaluatedCount:8,
      meanQuality:0.99,
      meanUtility:0.90
    }
  ];

  const selected = selectAdaptiveCandidate(candidates, stats, {
    taskClass:"grammar",
    workflow:{id:"direct",version:"2.0.0"},
    prompt:{id:"academic-writing",version:"2.0.0"},
    reasoningLevel:"low",
    tools:[],
    qualityGate:0.90,
    minSamples:3
  });

  assert.equal(selected.candidate.model, "model-a");
  assert.equal(selected.basis, "project-outcomes");
});

test("configured priority wins when no candidate passes quality evidence gate", () => {
  const selected = selectAdaptiveCandidate(candidates, [{
    taskClass:"grammar",
    workflow:{id:"direct",version:"2.0.0"},
    prompt:{id:"academic-writing",version:"2.0.0"},
    provider:"openrouter",
    actualModel:"model-b",
    reasoningLevel:"low",
    tools:[],
    evaluatedCount:10,
    meanQuality:0.72,
    meanUtility:0.99
  }], {
    taskClass:"grammar",
    workflow:{id:"direct",version:"2.0.0"},
    prompt:{id:"academic-writing",version:"2.0.0"},
    reasoningLevel:"low",
    tools:[],
    qualityGate:0.90,
    minSamples:3
  });

  assert.equal(selected.candidate.model, "model-a");
  assert.equal(selected.basis, "configured-priority");
});

test("OpenRouter Auto outcomes stay attributed to the auto route, not the selected actual model candidate", () => {
  const routes=[
    {provider:"openrouter",model:"openrouter/auto"},
    {provider:"openrouter",model:"openai/gpt-5.6-sol"}
  ];
  const stats=[{
    taskClass:"grammar",
    workflow:{id:"direct",version:"2.0.0"},
    prompt:{id:"academic-writing",version:"2.0.0"},
    provider:"openrouter",
    requestedModel:"openrouter/auto",
    actualModel:"openai/gpt-5.6-sol",
    reasoningLevel:"low",
    tools:[],
    evaluatedCount:5,
    meanQuality:0.96,
    meanUtility:0.8
  }];
  const selected=selectAdaptiveCandidate(routes,stats,{
    taskClass:"grammar",
    workflow:{id:"direct",version:"2.0.0"},
    prompt:{id:"academic-writing",version:"2.0.0"},
    reasoningLevel:"low",
    tools:[],
    qualityGate:0.9,
    minSamples:3
  });
  assert.equal(selected.candidate.model,"openrouter/auto");
  assert.equal(selected.basis,"project-outcomes");
});
