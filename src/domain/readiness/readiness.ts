export type ReadinessSeverity="blocker"|"warning"|"info";
export type ReadinessArea="graph"|"mentor-review"|"evidence"|"protected-facts"|"analysis"|"instructions"|"lekta";
export type ReadinessFinding={id:string;area:ReadinessArea;severity:ReadinessSeverity;message:string;sourceIds:readonly string[]};

export type ReadinessInput={
 graphIssues:readonly {kind:string;id?:string;linkId?:string}[];
 coverage:readonly {object:{id:string;label:string};state:"CURRENTLY_COVERED"|"CHANGED_SINCE_REVIEW"|"NEVER_REVIEWED"}[];
 evidence:readonly {id:string;status:"VALID"|"RECHECK_REQUIRED"}[];
 protectedFacts:readonly {id:string;status:"UNCHANGED"|"CHANGED"|"MISSING"|"AMBIGUOUS"}[];
 analysis:readonly {id:string;status:"CURRENT"|"STALE"}[];
 instructionIssues:readonly {id:string;message:string;blocking:boolean}[];
 lekta:{status:"not-run"|"clean"|"findings";findingCount:number};
};

export type ReadinessReport={readyForSubmission:boolean;findings:readonly ReadinessFinding[]};

export function evaluateAcademicReadiness(input:ReadinessInput):ReadinessReport{
 const f:ReadinessFinding[]=[];
 for(const x of input.graphIssues)f.push({id:`graph:${x.id??x.linkId??x.kind}`,area:"graph",severity:x.kind==="orphan"?"warning":"blocker",message:`Academic Graph: ${x.kind}`,sourceIds:[x.id??x.linkId??x.kind]});
 for(const x of input.coverage)if(x.state!=="CURRENTLY_COVERED")f.push({id:`coverage:${x.object.id}`,area:"mentor-review",severity:"warning",message:x.state==="CHANGED_SINCE_REVIEW"?`${x.object.label} promijenjen je nakon zadnjeg pregleda.`:`${x.object.label} još nije pregledan u ovom mentorskom scopeu.`,sourceIds:[x.object.id]});
 for(const x of input.evidence)if(x.status==="RECHECK_REQUIRED")f.push({id:`evidence:${x.id}`,area:"evidence",severity:"blocker",message:"Potpora tvrdnje zahtijeva novu provjeru.",sourceIds:[x.id]});
 for(const x of input.protectedFacts)if(x.status!=="UNCHANGED")f.push({id:`fact:${x.id}`,area:"protected-facts",severity:"blocker",message:`Zaštićeni element ${x.id} nije potvrđen kao nepromijenjen (${x.status}).`,sourceIds:[x.id]});
 for(const x of input.analysis)if(x.status==="STALE")f.push({id:`analysis:${x.id}`,area:"analysis",severity:"blocker",message:`Analitički rezultat ${x.id} vezan je uz zastarjeli ulaz.`,sourceIds:[x.id]});
 for(const x of input.instructionIssues)f.push({id:`instruction:${x.id}`,area:"instructions",severity:x.blocking?"blocker":"warning",message:x.message,sourceIds:[x.id]});
 if(input.lekta.status==="not-run")f.push({id:"lekta:not-run",area:"lekta",severity:"warning",message:"Lekta provjera još nije pokrenuta.",sourceIds:[]});
 if(input.lekta.status==="findings")f.push({id:"lekta:findings",area:"lekta",severity:"warning",message:`Lekta ima ${input.lekta.findingCount} nalaza za pregled.`,sourceIds:[]});
 return{readyForSubmission:!f.some(x=>x.severity==="blocker"),findings:f};
}
