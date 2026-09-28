import { describe, expect, it } from "vitest";
import { projectReviewAttention } from "./project";
import { createSharePackage, revokeSharePackage, type SharePackageId } from "../collaboration";

const pkg=(revision:number)=>createSharePackage({
 id:(`share-${revision}`) as SharePackageId,documentId:"doc-1",ownerId:"student-1",recipientId:"mentor-1",
 scope:{revision,visibility:"review"},createdAt:"2026-09-28T12:00:00Z",
});
const input=(shares: ReturnType<typeof pkg>[] = [])=>({
 requestId:"req-1",documentId:"doc-1",currentRevision:4,ownerId:"student-1",
 evaluation:{status:"REREVIEW_REQUIRED",reason:"missing"} as const,sharePackages:shares,
});

describe("Attention projection privacy",()=>{
 it("shows private invalidation to the owner",()=>{
  expect(projectReviewAttention(input(),{kind:"owner",userId:"student-1"})).toEqual([{
   id:"review:req-1:r4",kind:"REVIEW_REREQUIRED",requestId:"req-1",revision:4,reason:"missing",visibility:"private-owner"
  }]);
 });
 it("does not reveal private v4 to a mentor who only has v3",()=>{
  expect(projectReviewAttention(input([pkg(3)]),{kind:"recipient",userId:"mentor-1"})).toEqual([]);
 });
 it("shows rereview after v4 is explicitly shared for review",()=>{
  const result=projectReviewAttention(input([pkg(3),pkg(4)]),{kind:"recipient",userId:"mentor-1"});
  expect(result).toHaveLength(1); expect(result[0]).toMatchObject({revision:4,visibility:"shared-recipient"});
 });
 it("does not expose attention to another mentor",()=>{
  expect(projectReviewAttention(input([pkg(4)]),{kind:"recipient",userId:"mentor-2"})).toEqual([]);
 });
 it("revocation removes future attention visibility",()=>{
  const revoked=revokeSharePackage(pkg(4),"2026-09-28T13:00:00Z");
  expect(projectReviewAttention(input([revoked]),{kind:"recipient",userId:"mentor-1"})).toEqual([]);
 });
 it("produces no item while the review basis remains valid",()=>{
  const valid={...input([pkg(4)]),evaluation:{status:"VALID",resolution:"moved"} as const};
  expect(projectReviewAttention(valid,{kind:"owner",userId:"student-1"})).toEqual([]);
  expect(projectReviewAttention(valid,{kind:"recipient",userId:"mentor-1"})).toEqual([]);
 });
 it("does not let a non-owner use the owner projection",()=>{
  expect(projectReviewAttention(input(),{kind:"owner",userId:"someone-else"})).toEqual([]);
 });
});
