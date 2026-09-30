import type{Schema}from"@tiptap/pm/model";import{verifyCapturedProcess,type CapturedProcess}from"@/editor/process-capture";import type{ProcessSegmentRecord}from"@/lib/process-ledger/process-ledger";import{buildProcessHistory,type ProcessHistory}from"./process-history";
export type VerifiedHistorySegment={record:ProcessSegmentRecord;bundle:CapturedProcess};
export async function verifyAndBuildProcessHistory(records:readonly ProcessSegmentRecord[],schema:Schema):Promise<{verified:boolean;history:ProcessHistory;segments:readonly VerifiedHistorySegment[];invalidSessionIds:readonly string[]}>{
 const valid:VerifiedHistorySegment[]=[],invalidSessionIds:string[]=[];
 for(const record of records){if(await verifyCapturedProcess(record.bundle,schema))valid.push({record,bundle:record.bundle});else invalidSessionIds.push(record.sessionId);}
 const built=buildProcessHistory(valid.map(({record,bundle})=>({sessionId:record.sessionId,startedAt:record.startedAt,updatedAt:record.updatedAt,status:record.status==="active"?"interrupted":record.status,headHash:bundle.receipt.headHash,previousSessionHead:record.previousSessionHead,eventCount:bundle.events.length})));
 const history:ProcessHistory=invalidSessionIds.length?{...built,valid:false,issues:[...built.issues,...invalidSessionIds.map(sessionId=>({kind:"invalid-bundle" as const,sessionId}))]}:built;
 return{verified:history.valid,history,segments:valid,invalidSessionIds};
}
