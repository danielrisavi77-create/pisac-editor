export function verifyContract({text,taskClass="generic",verification={},externalChecks={}}={}){
  const failures=[];
  const trimmed=String(text||"").trim();
  if(!trimmed) failures.push(failure("empty_response","The model returned no usable text.",true,"same-or-stronger"));
  const minChars=Number.isFinite(Number(verification.minChars))?Number(verification.minChars):1;
  if(trimmed.length<minChars) failures.push(failure("response_too_short","Response is shorter than the required contract.",true,"same-or-stronger"));
  for(const pattern of verification.requiredPatterns||[]){
    const re=toRegex(pattern); if(re&&!re.test(trimmed)) failures.push(failure("required_pattern_missing","A required output pattern is missing.",true,"same-or-stronger"));
  }
  for(const pattern of verification.forbiddenPatterns||[]){
    const re=toRegex(pattern); if(re&&re.test(trimmed)) failures.push(failure("forbidden_pattern_present","A forbidden output pattern is present.",true,"same-or-stronger"));
  }
  if(verification.jsonSchema) verifyStructured(trimmed,verification.jsonSchema,failures);
  if(["citation_verification","research","source_synthesis","hallucination_check"].includes(taskClass)) verifyAcademic(trimmed,verification,failures);
  if(["coding","document_repair","security_review"].includes(taskClass)) verifyExternal(externalChecks,verification,failures);
  const hard=failures.filter(x=>x.severity!=="warning");
  return {
    passed:hard.length===0,
    failures,
    retryable:hard.some(x=>x.retryable),
    suggestedEscalation:hard.find(x=>x.suggestedEscalation)?.suggestedEscalation||null,
    method:"deterministic-contract-v0.3"
  };
}

function verifyStructured(text,schema,failures){
  let value;
  try{value=JSON.parse(stripFence(text));}
  catch{failures.push(failure("invalid_json","Structured output is not valid JSON.",true,"same-or-stronger"));return;}
  if(schema.type&&!matchesType(value,schema.type)){failures.push(failure("schema_type_mismatch","JSON output has the wrong top-level type.",true,"same-or-stronger"));return;}
  if(schema.type==="object"&&Array.isArray(schema.required)){
    for(const key of schema.required) if(!(key in value)) failures.push(failure("required_field_missing",`Required field missing: ${key}`,true,"same-or-stronger"));
  }
}
function verifyAcademic(text,verification,failures){
  if(verification.requireCitations){
    const has=/\[[0-9,\s-]+\]|\([A-ZČĆŽŠĐ][^)]*,\s*\d{4}[a-z]?\)|https?:\/\/|doi:/i.test(text);
    if(!has) failures.push(failure("citation_signal_missing","The response contract requires citations but none were detected.",true,"stronger"));
  }
  if(verification.requireReferencesSection&&!/\b(references|literatura|bibliografija)\b/i.test(text)){
    failures.push(failure("references_section_missing","A references section is required.",true,"stronger"));
  }
}
function verifyExternal(checks,verification,failures){
  const names=["syntax","typecheck","lint","unit","integration","schema","fidelity"];
  const supplied=names.filter(name=>checks?.[name]!=null);
  for(const name of supplied){
    const check=checks[name];
    const passed=typeof check==="boolean"?check:Boolean(check?.passed);
    if(!passed) failures.push(failure("external_check_failed",`External check failed: ${name}`,true,"stronger"));
  }
  if(verification.requireExternalChecks&&supplied.length===0){
    failures.push(failure("external_checks_missing","Required deterministic external checks were not supplied.",false,null));
  }
}
function failure(code,message,retryable,suggestedEscalation){return{code,message,retryable,suggestedEscalation,severity:"error"};}
function stripFence(text){return text.replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"");}
function toRegex(p){try{return p instanceof RegExp?p:new RegExp(String(p),"i");}catch{return null;}}
function matchesType(v,t){if(t==="array")return Array.isArray(v);if(t==="null")return v===null;if(t==="integer")return Number.isInteger(v);return typeof v===t;}
