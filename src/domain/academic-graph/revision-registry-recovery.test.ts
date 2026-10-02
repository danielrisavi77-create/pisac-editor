import{describe,expect,it}from"vitest";import{requiredRevisionRegistryRepair}from"./revision-registry-recovery";
const b={documentId:"doc",bindingId:"b4",objectId:"CLAIM-014",objectType:"claim"as const,objectRevision:4,nodeId:"n",boundAt:"2026-10-02T09:00:00Z",bindingVersion:1,previousBindingId:null};
const r={revisionId:"r5",documentId:"doc",objectId:"CLAIM-014",revision:5,baseRevision:4,bindingId:"b4",openedAt:"2026-10-02T10:00:00Z",lastActivityAt:"2026-10-02T10:30:00Z",sealedAt:"2026-10-02T11:00:00Z",activity:[{sessionId:"s",eventIndexes:[0]}],afterText:"x"};
describe("revision registry recovery",()=>{
 it("repairs only the missing registry phase for the exact document/object/binding",()=>expect(requiredRevisionRegistryRepair(b,[r])).toEqual({documentId:"doc",objectId:"CLAIM-014",objectType:"claim",objectRevision:5,nodeId:"n",boundAt:"2026-10-02T11:00:00Z"}));
 it("ignores revisions belonging to another document",()=>expect(requiredRevisionRegistryRepair(b,[{...r,documentId:"other"}])).toBeNull());
 it("rejects larger, unrelated or non-forward mismatches",()=>{expect(()=>requiredRevisionRegistryRepair(b,[{...r,revision:6}])).toThrow("unsafe mismatch");expect(()=>requiredRevisionRegistryRepair(b,[{...r,bindingId:"other"}])).toThrow("unsafe mismatch");});
});
