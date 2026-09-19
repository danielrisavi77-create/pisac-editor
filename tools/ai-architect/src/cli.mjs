#!/usr/bin/env node
import { resolve } from "node:path";
import { scanRepo } from "./scanner.mjs";
import { recommend } from "./router.mjs";
import { routeAndExecute } from "./openrouter.mjs";

function rootFromToolDir() {
  return resolve(import.meta.dirname, "../../..");
}

const [command, ...args] = process.argv.slice(2);
const root = rootFromToolDir();

if (command === "scan") {
  console.log(JSON.stringify(await scanRepo(root), null, 2));
} else if (command === "recommend") {
  const text = args.join(" ").trim();
  if (!text) {
    console.error('Usage: npm run recommend -- "task description"');
    process.exit(2);
  }
  console.log(JSON.stringify(await recommend(text, root), null, 2));
} else if (command === "execute") {
  const text = args.join(" ").trim();
  if (!text) {
    console.error('Usage: node src/cli.mjs execute "task description"');
    process.exit(2);
  }
  const rec = await recommend(text, root);
  const result = await routeAndExecute({
    model: rec.recommendation.exactModel || "openrouter/auto-beta",
    messages:[
      {role:"system",content:`You are executing a task selected by AI Architect. Workflow: ${rec.recommendation.workflow}. Reasoning level: ${rec.recommendation.reasoning}. Be precise and verify claims when risk is high.`},
      {role:"user",content:text}
    ]
  });
  console.log(JSON.stringify({recommendation:rec,result:{selectedModel:result.selectedModel,usage:result.usage,output:result.output}}, null, 2));
} else {
  console.log("AI Architect v0.1");
  console.log('Commands: scan | recommend "task" | execute "task"');
}
