import { loadArchitectConfig } from "./config.mjs";
import { getModel, validateModelRegistry } from "./model-registry.mjs";

function asId(ref){return typeof ref==="string"?ref:ref?.id;}

export async function validateConfig(repoRoot=process.cwd()){
  const cfg=await loadArchitectConfig(repoRoot);
  const errors=[],warnings=[];
  const expected={project:3,routing:3,models:3,prompts:2,workflows:2};
  for(const [name,version] of Object.entries(expected)){
    const doc=cfg[name];
    if(doc?.schemaVersion!==version)errors.push(`${name}.json must use schemaVersion ${version}`);
  }
  if(!cfg.project.project?.name)errors.push("project.project.name is required");
  if(!cfg.project.execution)errors.push("project.execution is required");
  if(!cfg.routing.default)errors.push("routing.default is required");
  if(!cfg.models.providers)errors.push("models.providers is required");
  if(!cfg.models.productionTiers)errors.push("models.productionTiers is required");
  if(cfg.models.registry?.source!=="tools/ai-architect/src/model-registry.mjs")errors.push("models.registry.source must point to the canonical model registry");

  const registry=validateModelRegistry();
  for(const error of registry.errors)errors.push("model-registry: "+error);

  const promptIds=new Set(Object.keys(cfg.prompts.prompts||{}));
  const workflowIds=new Set(Object.keys(cfg.workflows.workflows||{}));
  const providerIds=new Set(Object.keys(cfg.models.providers||{}));

  for(const [task,route] of Object.entries(cfg.routing.routes||{})){
    const pid=asId(route.prompt||cfg.routing.default?.prompt),wid=asId(route.workflow||cfg.routing.default?.workflow);
    if(!promptIds.has(pid))errors.push(`route '${task}' references missing prompt '${pid}'`);
    if(!workflowIds.has(wid))errors.push(`route '${task}' references missing workflow '${wid}'`);
    if(!route.profile)warnings.push(`route '${task}' has no explicit execution profile`);
    if(!Number.isFinite(Number(route.qualityGate)))warnings.push(`route '${task}' has no explicit qualityGate`);
  }

  const allRefs=[];
  for(const [tier,refs] of Object.entries(cfg.models.productionTiers||{})){
    if(!Array.isArray(refs)||!refs.length)errors.push(`production tier '${tier}' has no model refs`);
    for(const ref of refs||[])allRefs.push({where:`tier '${tier}'`,ref});
  }
  for(const ref of cfg.models.benchmarkOnlyRefs||[])allRefs.push({where:"benchmarkOnlyRefs",ref});
  if(cfg.models.autoRouter?.ref)allRefs.push({where:"autoRouter",ref:cfg.models.autoRouter.ref});

  for(const item of allRefs){
    const model=getModel(item.ref);
    if(!model){errors.push(`${item.where} references unknown canonical model '${item.ref}'`);continue;}
    if(!providerIds.has(model.provider))errors.push(`${item.ref} uses provider '${model.provider}' missing from models.providers`);
  }

  if(cfg.models.providers?.local?.enabled!==true)warnings.push("local provider should remain enabled for deterministic tests");
  if(cfg.models.providers?.notdiamond?.enabled===true)warnings.push("Not Diamond must remain disabled until readiness is explicitly satisfied.");
  if(cfg.project.constraints?.unknownCostIsZero!==false)errors.push("project.constraints.unknownCostIsZero must be false");
  if(cfg.project.constraints?.publicLiveRequiresUsagePolicy!==true)warnings.push("public live inference should require usage policy readiness");

  return{
    valid:errors.length===0,errors,warnings,
    registry:{valid:registry.valid,count:registry.count,version:registry.version}
  };
}
