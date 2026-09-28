import{describe,expect,it}from"vitest";import{createAnalysisResult,createReproducibleResult,evaluateAnalysisResult,type DatasetArtifact}from"./lineage";
const d4:DatasetArtifact={id:"ds",version:"v4",fingerprint:"abc",label:"N=238"};
const r=()=>createAnalysisResult({id:"r31",analysisId:"a1",datasetId:"ds",datasetVersion:"v4",datasetFingerprint:"abc",label:"p",value:".031",confidence:"declared"});
describe("analysis lineage",()=>{
 it("is current for the exact dataset version and fingerprint",()=>expect(evaluateAnalysisResult(r(),d4)).toEqual({status:"CURRENT"}));
 it("becomes stale when dataset version changes",()=>expect(evaluateAnalysisResult(r(),{...d4,version:"v5",fingerprint:"def"})).toEqual({status:"STALE",reason:"dataset-version-changed"}));
 it("becomes stale when bytes change under the same version label",()=>expect(evaluateAnalysisResult(r(),{...d4,fingerprint:"tampered"})).toEqual({status:"STALE",reason:"dataset-fingerprint-changed"}));
 it("does not allow ordinary code to mint reproducible confidence",()=>expect(()=>createAnalysisResult({...r(),confidence:"reproducible"})).toThrow("verified execution"));
 it("requires explicit execution evidence for reproducible results",()=>{const x=createReproducibleResult({id:"r32",analysisId:"a1",datasetId:"ds",datasetVersion:"v5",datasetFingerprint:"def",label:"p",value:".044"},{verified:true,engine:"jamovi",executionId:"exec-1"});expect(x.confidence).toBe("reproducible");});
});
