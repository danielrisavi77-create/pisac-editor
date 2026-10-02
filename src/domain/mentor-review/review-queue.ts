import type{AcademicObject}from"../academic-graph";import type{ReviewCoverageRecord}from"../mentor-review";
export type ReviewQueueItem={object:AcademicObject;reason:"changed"|"new"|"evidence-recheck"|"analysis-stale";contextLabel:string};
export type ReviewAction="reviewed"|"revision-requested"|"commented"|"skipped";
export type ReviewQueueAudit={id:string;itemObjectId:string;objectRevision:number;reviewerId:string;action:ReviewAction;occurredAt:string;note?:string};
export type ReviewQueueState={items:readonly ReviewQueueItem[];cursor:number;audits:readonly ReviewQueueAudit[];coverage:readonly ReviewCoverageRecord[]};

export function createReviewQueue(items:readonly ReviewQueueItem[]):ReviewQueueState{return{items:[...items],cursor:0,audits:[],coverage:[]};}
export function currentReviewItem(state:ReviewQueueState):ReviewQueueItem|null{return state.items[state.cursor]??null;}
export function applyReviewAction(state:ReviewQueueState,input:{reviewerId:string;action:ReviewAction;occurredAt:string;note?:string;auditId:string;coverageId?:string}):ReviewQueueState{
 const item=currentReviewItem(state);if(!item)throw new Error("applyReviewAction: queue complete");
 if(Number.isNaN(Date.parse(input.occurredAt)))throw new Error("applyReviewAction: invalid timestamp");
 if((input.action==="revision-requested"||input.action==="commented")&&!input.note?.trim())throw new Error("applyReviewAction: note required");
 if(state.audits.some(a=>a.id===input.auditId))throw new Error("applyReviewAction: duplicate audit id");
 const audit:ReviewQueueAudit={id:input.auditId,itemObjectId:item.object.id,objectRevision:item.object.revision,reviewerId:input.reviewerId,action:input.action,occurredAt:input.occurredAt,...(input.note?.trim()?{note:input.note.trim()}:{})};
 const coverage=[...state.coverage];
 if(input.action==="reviewed"){if(!input.coverageId)throw new Error("applyReviewAction: coverage id required");if(coverage.some(c=>c.id===input.coverageId))throw new Error("applyReviewAction: duplicate coverage id");coverage.push({id:input.coverageId,reviewerId:input.reviewerId,objectId:item.object.id,reviewedRevision:item.object.revision,reviewedAt:input.occurredAt,status:"reviewed"});}
 const terminal=input.action!=="commented";
 return{...state,cursor:terminal?state.cursor+1:state.cursor,audits:[...state.audits,audit],coverage};
}
