export type WaitingOn="mentor"|"student"|"none";
export type MentorQueueReason=
 |{kind:"review-delta";count:number}|{kind:"student-responses";count:number}|{kind:"never-reviewed";count:number}
 |{kind:"readiness-blockers";count:number}|{kind:"forensic-anomalies";count:number}|{kind:"final-review-requested";count:1};
export type MentorProjectInput={projectId:string;studentId:string;studentLabel:string;workLabel:string;lastActivityAt:string;reviewDeltaCount:number;studentResponseCount:number;neverReviewedCount:number;readinessBlockerCount:number;forensicAnomalyCount:number;finalReviewRequested:boolean;studentWorkPending:boolean};
export type MentorQueueItem=MentorProjectInput&{waitingOn:WaitingOn;reasons:readonly MentorQueueReason[]};
export function buildMentorQueue(inputs:readonly MentorProjectInput[]):MentorQueueItem[]{
 return inputs.map(x=>{const reasons:MentorQueueReason[]=[];if(x.reviewDeltaCount>0)reasons.push({kind:"review-delta",count:x.reviewDeltaCount});if(x.studentResponseCount>0)reasons.push({kind:"student-responses",count:x.studentResponseCount});if(x.neverReviewedCount>0)reasons.push({kind:"never-reviewed",count:x.neverReviewedCount});if(x.readinessBlockerCount>0)reasons.push({kind:"readiness-blockers",count:x.readinessBlockerCount});if(x.forensicAnomalyCount>0)reasons.push({kind:"forensic-anomalies",count:x.forensicAnomalyCount});if(x.finalReviewRequested)reasons.push({kind:"final-review-requested",count:1});const mentorAction=reasons.length>0;const waitingOn:WaitingOn=mentorAction?"mentor":x.studentWorkPending?"student":"none";return{...x,waitingOn,reasons};});
}
export function groupMentorQueue(items:readonly MentorQueueItem[]):Record<WaitingOn,MentorQueueItem[]>{return{mentor:items.filter(x=>x.waitingOn==="mentor"),student:items.filter(x=>x.waitingOn==="student"),none:items.filter(x=>x.waitingOn==="none")};}
