#!/usr/bin/env node
import { resolve } from "node:path";
import { AIArchitect } from "./architect.mjs";
import { scanRepo } from "./scanner.mjs";
import { runGoldenEval } from "./evaluator.mjs";
import { validateConfig } from "./validator.mjs";

const root=resolve(import.meta.dirname,"../../..");
const [command,...rawArgs]=process.argv.slice(2);
const architect=new AIArchitect({repoRoot:root});

function parseContext(args){
  const arg=args.find(a=>a.startsWith("--context="));
  const rest=args.filter(a=>a!==arg);
  if(!arg)return{context:{},text:rest.join(" ").trim()};
  try{return{context:JSON.parse(arg.slice("--context=".length)),text:rest.join(" ").trim()};}
  catch{console.error("--context must contain valid JSON.");process.exit(2);}
}

async function main(){
  if(command==="scan"){console.log(JSON.stringify(await scanRepo(root),null,2));return;}
  if(command==="validate"){
    const result=await validateConfig(root);console.log(JSON.stringify(result,null,2));
    if(!result.valid)process.exitCode=1;return;
  }
  if(command==="eval"){
    const result=await runGoldenEval(root);console.log(JSON.stringify(result,null,2));
    if(!result.passed)process.exitCode=1;return;
  }
  if(command==="stats"){console.log(JSON.stringify(await architect.stats(),null,2));return;}
  if(command==="record"){
    const raw=rawArgs.join(" ").trim();
    if(!raw){console.error("Usage: npm run record -- '{\"taskClass\":\"grammar\",...}'");process.exit(2);}
    let record;try{record=JSON.parse(raw);}catch{console.error("record expects one JSON object.");process.exit(2);}
    console.log(JSON.stringify(await architect.recordOutcome(record),null,2));return;
  }
  if(command==="evaluate"){
    const {context,text}=parseContext(rawArgs);
    if(!text){console.error('Usage: npm run evaluate -- "output text" --context=\'{"taskClass":"grammar"}\'');process.exit(2);}
    const result=await architect.evaluate({
      output:text,taskClass:context.taskClass||"generic",
      verification:context.verification||{},externalChecks:context.externalChecks||{}
    });
    console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;return;
  }
  if(["recommend","explain","execute"].includes(command)){
    const {context,text}=parseContext(rawArgs);
    if(!text){console.error(`Usage: npm run ${command} -- "task description" [--context='{"purpose":"language"}']`);process.exit(2);}
    if(command==="recommend"){console.log(JSON.stringify(await architect.plan(text,context),null,2));return;}
    if(command==="explain"){console.log(JSON.stringify(await architect.explain(text,context),null,2));return;}
    const result=await architect.execute(text,context);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;return;
  }
  console.log("AI Architect v0.3");
  console.log('Commands: scan | recommend "task" | explain "task" | execute "task" | evaluate "output" | stats | eval | validate | record JSON');
}
await main();
