import type{Schema,Node as PMNode}from"@tiptap/pm/model";
import{replayCapturedProcess,verifyCapturedProcess,type CapturedProcess}from"@/editor/process-capture";
import type{AcademicObjectBinding}from"./object-evolution";
function textForNode(doc:PMNode,nodeId:string):string|null{let found:string|null=null;doc.descendants(node=>{if(found!==null)return false;if(node.attrs?.nodeId===nodeId){found=node.textContent;return false;}return true;});return found;}
export async function deriveVerifiedObjectBinding(bundle:CapturedProcess,schema:Schema,input:{objectId:string;objectType:string;nodeId:string;revision:number;evidenceIds:readonly string[]}):Promise<AcademicObjectBinding|null>{
 if(!input.objectId||!input.nodeId||!Number.isSafeInteger(input.revision)||input.revision<1)throw new Error("deriveObjectBinding: invalid identity");
 if(!(await verifyCapturedProcess(bundle,schema)))throw new Error("deriveObjectBinding: unverified bundle");
 const eventIndexes:number[]=[];for(let i=0;i<bundle.events.length;i++){const ids=bundle.events[i].event.touchedNodeIds;if(ids?.includes(input.nodeId))eventIndexes.push(i);}
 if(!eventIndexes.length)return null;
 const first=eventIndexes[0],last=eventIndexes.at(-1)!;const before=textForNode(replayCapturedProcess(bundle,schema,first),input.nodeId);const after=textForNode(replayCapturedProcess(bundle,schema,last+1),input.nodeId);
 if(before===null||after===null)throw new Error("deriveObjectBinding: node snapshot missing");
 return{objectId:input.objectId,objectType:input.objectType,revision:input.revision,sessionId:bundle.sessionId,nodeId:input.nodeId,eventIndexes,beforeText:before,afterText:after,evidenceIds:[...input.evidenceIds]};
}
