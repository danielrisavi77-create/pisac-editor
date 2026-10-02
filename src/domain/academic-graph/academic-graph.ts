export const ACADEMIC_OBJECT_TYPES = [
  "research-question","hypothesis","concept","variable","dataset","analysis",
  "result","claim","source","section","conclusion","decision","review"
] as const;
export type AcademicObjectType=(typeof ACADEMIC_OBJECT_TYPES)[number];

export const ACADEMIC_RELATIONS = [
  "addresses","tests","operationalizes","uses","produces","supports","challenges",
  "interprets","appears-in","contributes-to","documents","reviews"
] as const;
export type AcademicRelation=(typeof ACADEMIC_RELATIONS)[number];

export type AcademicObject={id:string;type:AcademicObjectType;label:string;revision:number};
export type AcademicLink={id:string;from:string;to:string;relation:AcademicRelation};
export type AcademicGraph={objects:readonly AcademicObject[];links:readonly AcademicLink[]};

export type GraphIssue =
 | {kind:"duplicate-object";id:string}
 | {kind:"duplicate-link";id:string}
 | {kind:"dangling-link";linkId:string;missingId:string}
 | {kind:"self-link";linkId:string}
 | {kind:"orphan";id:string};

export type AcademicPath={target:AcademicObject;links:readonly AcademicLink[]};

export function validateAcademicGraph(graph:AcademicGraph):GraphIssue[]{
 const issues:GraphIssue[]=[];const ids=new Set<string>();const linkIds=new Set<string>();
 for(const o of graph.objects){if(ids.has(o.id))issues.push({kind:"duplicate-object",id:o.id});ids.add(o.id);}
 const connected=new Set<string>();
 for(const l of graph.links){
  if(linkIds.has(l.id))issues.push({kind:"duplicate-link",id:l.id});linkIds.add(l.id);
  if(l.from===l.to)issues.push({kind:"self-link",linkId:l.id});
  if(!ids.has(l.from))issues.push({kind:"dangling-link",linkId:l.id,missingId:l.from});else connected.add(l.from);
  if(!ids.has(l.to))issues.push({kind:"dangling-link",linkId:l.id,missingId:l.to});else connected.add(l.to);
 }
 for(const o of graph.objects)if(!connected.has(o.id))issues.push({kind:"orphan",id:o.id});
 return issues;
}

export function traceAcademicPaths(graph:AcademicGraph,startId:string,maxDepth=10):AcademicPath[]{
 if(!Number.isSafeInteger(maxDepth)||maxDepth<1)throw new Error("traceAcademicPaths: invalid maxDepth");
 const byId=new Map(graph.objects.map(o=>[o.id,o]));if(!byId.has(startId))return[];
 const adjacency=new Map<string,AcademicLink[]>();for(const l of graph.links){if(!byId.has(l.from)||!byId.has(l.to)||l.from===l.to)continue;const a=adjacency.get(l.from)??[];a.push(l);adjacency.set(l.from,a);}
 const seen=new Set([startId]);const q:[string,AcademicLink[]][]=[[startId,[]]];const out:AcademicPath[]=[];
 while(q.length){const [id,path]=q.shift()!;if(path.length>=maxDepth)continue;for(const l of adjacency.get(id)??[]){if(seen.has(l.to))continue;seen.add(l.to);const next=[...path,l];out.push({target:byId.get(l.to)!,links:next});q.push([l.to,next]);}}
 return out;
}

export function objectsOfType(graph:AcademicGraph,type:AcademicObjectType):AcademicObject[]{return graph.objects.filter(o=>o.type===type);}
