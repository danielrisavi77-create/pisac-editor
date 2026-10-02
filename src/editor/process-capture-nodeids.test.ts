import{createHash}from"node:crypto";
import{describe,expect,it}from"vitest";
import{Schema}from"@tiptap/pm/model";
import{EditorState}from"@tiptap/pm/state";
import{LocalProcessCapture,collectTouchedNodeIds,verifyCapturedProcess}from"./process-capture";

const schema=new Schema({nodes:{doc:{content:"block+"},paragraph:{group:"block",content:"text*",attrs:{nodeId:{default:null}}},text:{group:"inline"}},marks:{bold:{}}});
const doc=()=>schema.node("doc",null,[schema.node("paragraph",{nodeId:"p1"},schema.text("abc")),schema.node("paragraph",{nodeId:"p2"},schema.text("xyz"))]);

describe("capture touched node ids",()=>{
 it("binds an insertion to the stable paragraph node id",()=>{const state=EditorState.create({schema,doc:doc()});expect(collectTouchedNodeIds(state.tr.insertText("!",2))).toEqual(["p1"]);});
 it("binds a mapless formatting step to the stable paragraph node id",()=>{const state=EditorState.create({schema,doc:doc()});const mark=schema.marks.bold.create();expect(collectTouchedNodeIds(state.tr.addMark(1,4,mark))).toEqual(["p1"]);});
 it("binds a deletion spanning two blocks to both stable ids",()=>{const state=EditorState.create({schema,doc:doc()});expect(collectTouchedNodeIds(state.tr.delete(2,7))).toEqual(["p1","p2"]);});
 it("returns no invented id when the touched node has no stable nodeId",()=>{const d=schema.node("doc",null,[schema.node("paragraph",null,schema.text("abc"))]);const state=EditorState.create({schema,doc:d});expect(collectTouchedNodeIds(state.tr.insertText("!",2))).toEqual([]);});
 it("verification rejects forged touched-node metadata",async()=>{let state=EditorState.create({schema,doc:doc()});const hash=async(t:string)=>createHash("sha256").update(t).digest("hex");const cap=new LocalProcessCapture(state.doc,{documentId:"d",sessionId:"s",hash});const tr=state.tr.insertText("!",2);cap.record(tr);state=state.apply(tr);const bundle=await cap.seal(state.doc);expect(bundle.events[0].event.touchedNodeIds).toEqual(["p1"]);const forged=structuredClone(bundle);forged.events[0].event.touchedNodeIds=["p2"];expect(await verifyCapturedProcess(forged,schema,hash)).toBe(false);});
});
