import type{AcademicGraph,AcademicObject}from"../academic-graph";import{buildCoverageMap,type ReviewCoverageRecord}from"./coverage";
export type AcademicChangeKind="content"|"evidence"|"analysis"|"structure"|"language-only";
export type ObjectChange={objectId:string;revision:number;kind:AcademicChangeKind};
export type ReviewDeltaItem={object:AcademicObject;kind:"changed"|"new";lastReviewedRevision:number|null;currentRevision:number;changeKinds:readonly AcademicChangeKind[]};

export function buildMentorReviewDelta(
 graph:AcademicGraph,reviews:readonly ReviewCoverageRecord[],reviewerId:string,changes:readonly ObjectChange[]=[],
 options:{includeLanguageOnly?:boolean}={}
):ReviewDeltaItem[]{
 return buildCoverageMap(graph,reviews,reviewerId).flatMap(item=>{
  if(item.state==="CURRENTLY_COVERED")return[];
  const kinds=[...new Set(changes.filter(c=>c.objectId===item.object.id&&c.revision===item.object.revision).map(c=>c.kind))];
  if(item.state==="CHANGED_SINCE_REVIEW"&&kinds.length>0&&kinds.every(k=>k==="language-only")&&!options.includeLanguageOnly)return[];
  return[{object:item.object,kind:item.state==="NEVER_REVIEWED"?"new":"changed",lastReviewedRevision:item.lastReview?.reviewedRevision??null,currentRevision:item.object.revision,changeKinds:kinds}];
 });
}
