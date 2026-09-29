import type{AcademicGraph,AcademicObject}from"../academic-graph";import{buildCoverageMap,type ReviewCoverageRecord}from"./coverage";
export type ReviewDeltaItem={object:AcademicObject;kind:"changed"|"new";lastReviewedRevision:number|null;currentRevision:number};
export function buildMentorReviewDelta(graph:AcademicGraph,reviews:readonly ReviewCoverageRecord[],reviewerId:string):ReviewDeltaItem[]{
 return buildCoverageMap(graph,reviews,reviewerId).flatMap(item=>{
  if(item.state==="CURRENTLY_COVERED")return[];
  return[{object:item.object,kind:item.state==="NEVER_REVIEWED"?"new":"changed",lastReviewedRevision:item.lastReview?.reviewedRevision??null,currentRevision:item.object.revision}];
 });
}
