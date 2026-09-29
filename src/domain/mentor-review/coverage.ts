import type{AcademicGraph,AcademicObject}from"../academic-graph";

export type ReviewCoverageRecord={
 id:string;reviewerId:string;objectId:string;reviewedRevision:number;reviewedAt:string;
 status:"reviewed"|"accepted"|"needs-work";
};
export type CoverageState="CURRENTLY_COVERED"|"CHANGED_SINCE_REVIEW"|"NEVER_REVIEWED";
export type CoverageItem={object:AcademicObject;state:CoverageState;lastReview:ReviewCoverageRecord|null};

export function buildCoverageMap(graph:AcademicGraph,reviews:readonly ReviewCoverageRecord[],reviewerId:string):CoverageItem[]{
 return graph.objects.map(object=>{
  const relevant=reviews.filter(r=>r.reviewerId===reviewerId&&r.objectId===object.id).sort((a,b)=>b.reviewedRevision-a.reviewedRevision||b.reviewedAt.localeCompare(a.reviewedAt));
  const last=relevant[0]??null;
  return{object,lastReview:last,state:last===null?"NEVER_REVIEWED":last.reviewedRevision===object.revision?"CURRENTLY_COVERED":"CHANGED_SINCE_REVIEW"};
 });
}
export function coverageSummary(items:readonly CoverageItem[]){
 return{
  currentlyCovered:items.filter(x=>x.state==="CURRENTLY_COVERED").length,
  changedSinceReview:items.filter(x=>x.state==="CHANGED_SINCE_REVIEW").length,
  neverReviewed:items.filter(x=>x.state==="NEVER_REVIEWED").length,
 };
}
