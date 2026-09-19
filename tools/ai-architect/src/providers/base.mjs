const TRANSIENT_STATUSES=new Set([408,425,429,500,502,503,504]);

export class ProviderError extends Error{
  constructor({provider,operation,status=500,code="PROVIDER_ERROR",transient=false,retryAfterMs=null,message}={}){
    super(message||`${provider} ${operation} failed.`);
    this.name="ProviderError";this.provider=provider;this.operation=operation;this.status=status;
    this.code=code;this.transient=transient;this.retryAfterMs=retryAfterMs;this.safe=true;
  }
}

export async function fetchProviderJson({
  provider,operation,url,headers={},body,timeoutMs=45000,fetchImpl=globalThis.fetch
}={}){
  if(typeof fetchImpl!=="function")throw new Error("No fetch implementation available.");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response;
  try{
    response=await fetchImpl(url,{
      method:"POST",
      headers:{"Content-Type":"application/json",...headers},
      body:JSON.stringify(body),
      signal:controller.signal
    });
  }catch(error){
    clearTimeout(timer);
    if(error?.name==="AbortError")throw new ProviderError({provider,operation,status:504,code:"PROVIDER_TIMEOUT",transient:true,message:`${provider} request timed out.`});
    throw new ProviderError({provider,operation,status:503,code:"PROVIDER_NETWORK_ERROR",transient:true,message:`${provider} network request failed.`});
  }
  clearTimeout(timer);
  const text=await response.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch{data={};}
  if(!response.ok){
    throw new ProviderError({
      provider,operation,status:response.status,
      code:response.status===429?"PROVIDER_RATE_LIMITED":"PROVIDER_HTTP_ERROR",
      transient:TRANSIENT_STATUSES.has(response.status),
      retryAfterMs:parseRetryAfter(response.headers.get("retry-after")),
      message:`${provider} returned HTTP ${response.status}.`
    });
  }
  return data;
}

export function normalizeUsage({
  inputTokens=0,uncachedInputTokens=null,cachedInputTokens=0,cacheWriteTokens=0,
  outputTokens=0,visibleOutputTokens=null,reasoningTokens=null,toolTokens=0,
  totalTokens=null,providerCostUsd=null
}={}){
  const input=integer(inputTokens),output=integer(outputTokens);
  return {
    inputTokens:input,
    uncachedInputTokens:uncachedInputTokens==null?null:integer(uncachedInputTokens),
    cachedInputTokens:integer(cachedInputTokens),
    cacheWriteTokens:integer(cacheWriteTokens),
    outputTokens:output,
    visibleOutputTokens:visibleOutputTokens==null?null:integer(visibleOutputTokens),
    reasoningTokens:reasoningTokens==null?null:integer(reasoningTokens),
    toolTokens:integer(toolTokens),
    totalTokens:totalTokens==null?input+output:integer(totalTokens),
    providerCostUsd:Number.isFinite(Number(providerCostUsd))?Number(providerCostUsd):null
  };
}

export function extractResponseText(output=[]){
  const parts=[];
  for(const item of output||[])for(const content of item?.content||[]){
    if(content?.type==="output_text"&&typeof content.text==="string")parts.push(content.text);
  }
  return parts.join("\n");
}

function parseRetryAfter(value){
  if(!value)return null;
  const seconds=Number(value);
  if(Number.isFinite(seconds))return Math.max(0,seconds*1000);
  const date=Date.parse(value);
  return Number.isFinite(date)?Math.max(0,date-Date.now()):null;
}
function integer(v){return Math.max(0,Math.round(Number(v)||0));}
