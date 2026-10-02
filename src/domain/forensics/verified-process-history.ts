import type{Schema}from"@tiptap/pm/model";import{verifyCapturedProcess,type CapturedProcess}from"@/editor/process-capture";import type{ProcessSegmentRecord}from"@/lib/process-ledger/process-ledger";import{buildProcessHistory,type ProcessHistory}from"./process-history";
export type VerifiedHistorySegment={record:ProcessSegmentRecord;bundle:CapturedProcess};
export async function verifyAndBuildProcessHistory(records:readonly ProcessSegmentRecord[],schema:Schema):Promise<{verified:boolean;history:ProcessHistory;segments:readonly VerifiedHistorySegment[];invalidSessionIds:readonly string[]}>{
 const valid:VerifiedHistorySegment[]=[],invalidSessionIds:string[]=[];
 for(const record of records){if(await verifyCapturedProcess(record.bundle,schema))valid.push({record,bundle:record.bundle});else invalidSessionIds.push(record.sessionId);}
 const activeSessionIds=valid.filter(x=>x.record.status==="active").map(x=>x.record.sessionId);
 const built=buildProcessHistory(valid.filter(x=>x.record.status!=="active").map(({record,bundle})=>({sessionId:record.sessionId,startedAt:record.startedAt,updatedAt:record.updatedAt,status:record.status as "sealed"|"interrupted",headHash:bundle.receipt.headHash,previousSessionHead:record.previousSessionHead,eventCount:bundle.events.length})));
 const extra=[...invalidSessionIds.map(sessionId=>({kind:"invalid-bundle" as const,sessionId})),...activeSessionIds.map(sessionId=>({kind:"active-segment" as const,sessionId}))];
 const history:ProcessHistory=extra.length?{...built,valid:false,issues:[...built.issues,...extra]}:built;
 return{verified:history.valid,history,segments:valid,invalidSessionIds};
}
