import{describe,expect,it}from"vitest";import{Schema}from"@tiptap/pm/model";import{EditorState}from"@tiptap/pm/state";import{collectTouchedNodeIds}from"./process-capture";
const schema=new Schema({nodes:{doc:{content:"block+"},paragraph:{group:"block",content:"text*",attrs:{nodeId:{default:null}}},text:{group:"inline"}},marks:{}});
const doc=()=>schema.node("doc",null,[schema.node("paragraph",{nodeId:"p1"},schema.text("abc")),schema.node("paragraph",{nodeId:"p2"},schema.text("xyz"))]);
describe("capture touched node ids",()=>{
 it("binds an insertion to the stable paragraph node id",()=>{const state=EditorState.create({schema,doc:doc()});const tr=state.tr.insertText("!",2);expect(collectTouchedNodeIds(tr)).toEqual(["p1"]);});
 it("binds a deletion spanning two blocks to both stable ids",()=>{const state=EditorState.create({schema,doc:doc()});const tr=state.tr.delete(2,7);expect(collectTouchedNodeIds(tr)).toEqual(["p1","p2"]);});
 it("returns no invented id when the touched node has no stable nodeId",()=>{const d=schema.node("doc",null,[schema.node("paragraph",null,schema.text("abc"))]);const state=EditorState.create({schema,doc:d});expect(collectTouchedNodeIds(state.tr.insertText("!",2))).toEqual([]);});
});