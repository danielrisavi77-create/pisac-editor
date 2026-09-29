import type{ForensicEvent}from"./ledger";
export type CanonicalEventEnvelope={event:ForensicEvent;previousHash:string;eventHash:string};
export type HashFn=(canonical:string)=>Promise<string>;

export function canonicalize(value:unknown):string{
 if(value===null||typeof value!=="object")return JSON.stringify(value);
 if(Array.isArray(value))return"["+value.map(canonicalize).join(",")+"]";
 const obj=value as Record<string,unknown>;return"{"+Object.keys(obj).sort().map(k=>JSON.stringify(k)+":"+canonicalize(obj[k])).join(",")+"}";
}
export async function appendToHashChain(event:ForensicEvent,previousHash:string,hash:HashFn):Promise<CanonicalEventEnvelope>{
 if(!previousHash)throw new Error("appendToHashChain: previous hash required");
 const eventHash=await hash(canonicalize({previousHash,event}));
 return{event:structuredClone(event),previousHash,eventHash};
}
export async function verifyHashChain(chain:readonly CanonicalEventEnvelope[],genesisHash:string,hash:HashFn):Promise<{valid:true}|{valid:false;sequence:number}>{
 let previous=genesisHash;
 for(const item of chain){if(item.previousHash!==previous)return{valid:false,sequence:item.event.sequence};const expected=await hash(canonicalize({previousHash:previous,event:item.event}));if(expected!==item.eventHash)return{valid:false,sequence:item.event.sequence};previous=item.eventHash;}
 return{valid:true};
}
