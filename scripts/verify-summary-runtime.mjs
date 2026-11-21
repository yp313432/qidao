// Exercise the real summary planner/store boundary with a scripted upstream, without React or network.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const fixture = globalThis.__qidaoSummaryFixture = {};
registerHooks({ resolve(specifier, context, next) {
  const boundary = {
    "@/lib/store": "export const useApp={getState:()=>globalThis.__qidaoSummaryFixture.state};",
    "@/lib/chat-client": `export const historyForApi=(messages)=>messages;
      export const makeDirectRound=(req)=>(args)=>globalThis.__qidaoSummaryFixture.send(req,args);
      export const makeServerRound=makeDirectRound;`,
    "@/lib/utils": "export const uid=()=>crypto.randomUUID();",
  }[specifier];
  if (boundary) return { shortCircuit:true, url:"data:text/javascript,"+encodeURIComponent(boundary) };
  if (specifier.startsWith("@/")) return { shortCircuit:true, url:new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href };
  return next(specifier,context);
} });
const { summarizeBatch, maybeSummarize, summarizeNow } = await import("../src/lib/summarizer.ts");

function setup(count=0,previous) {
  const conversation={id:"conv",messages:Array.from({length:count},(_,i)=>({id:`m${i}`,role:i%2?"assistant":"user",content:`第${i}条真实交流。`})),summary:previous};
  const requests=[],patches=[],logs=[];
  fixture.state={settings:{replyStyle:"default",keepRecent:16,contextBudget:12000,autoCompact:true,summaryEvery:50},
    model:"sonnet",conversations:[conversation],emotionEvents:[{primaryEmotion:"安心",at:Date.now()}],requestLog:logs,
    logRequest:(entry)=>{const i=logs.findIndex((old)=>old.requestId===entry.requestId);if(i<0)logs.unshift(entry);else logs[i]={...logs[i],...entry};},
    patchSummary:(_id,patch)=>{patches.push(patch);conversation.summary={...patch,updatedAt:Date.now()};},
  };
  const output = "标题：约定\n我记得她说过的话，也记得自己怎样回应。现在回看，那份约定还在心里。\n【要点】\n- [约定] 用户请助手别催她休息。";
  fixture.send=async(req,args)=>{
    requests.push({req,args});args.onDelta({content:output});
    args.onDelta({usage:{prompt:1000,cached:800}});
    return {content:output,thinking:"",toolCalls:[],finishReason:"stop",usage:{prompt:1000,cached:800,completion:60}};
  };
  return{conversation,requests,patches,logs};
}

test("summary uses only its own system instruction and supplied context, and records its actual usage",async()=>{
  const state=setup();
  const result=await summarizeBatch({prompt:"请回顾真实对话",conversationId:"conv",replyId:"parent-reply"});
  assert.match(result,/我记得/);
  assert.equal(state.requests.length,1);const {req,args}=state.requests[0];
  assert.equal(args.tools,null);assert.equal(args.messages.length,2);
  assert.match(args.messages[0].content,/现在的心态/);
  assert.doesNotMatch(args.messages[0].content,/栖岛里有什么|emotion.report|当前有效权限|```qidao/);
  assert.equal(req.maxTokens,4096);assert.equal(req.model,"haiku");
  assert.equal(state.logs.length,1);assert.equal(state.logs[0].purpose,"summary");
  assert.equal(state.logs[0].replyId,"parent-reply");assert.equal(state.logs[0].prompt,1000);assert.equal(state.logs[0].cached,800);
  assert.equal(state.logs[0].completion,60);assert.equal(state.logs[0].inputEstimate.toolCount,0);
});

test("a subsequent batch stores only new coverage and provides the recent mood as context",async()=>{
  const previous={text:"此前约好不催她休息。",upToIndex:60,covered:60,tokens:20,sourceTokens:500,updatedAt:0,passes:1};
  const state=setup(130,previous);
  await maybeSummarize({conversationId:"conv",replyId:"parent",history:[],systemTokens:100,toolTokens:100});
  assert.equal(state.requests.length,1);assert.equal(state.patches.length,1);
  assert.equal(state.patches[0].upToIndex,110);assert.equal(state.patches[0].covered,50);
  assert.equal(state.patches[0].blocks[0].text, "用户请助手别催她休息。");
  const prompt=state.requests[0].args.messages[1].content;
  assert.doesNotMatch(prompt,/此前约好不催她休息/);assert.match(prompt,/安心/);
  assert.match(prompt,/第60条真实交流/);assert.match(prompt,/第109条真实交流/);
  assert.ok(state.patches[0].upToIndex<=state.conversation.messages.length-fixture.state.settings.keepRecent);
});

test("short conversations do not spend a summary request",async()=>{
  const state=setup(40);
  await maybeSummarize({conversationId:"conv",history:[],systemTokens:100,toolTokens:100});
  assert.equal(state.requests.length,0);assert.equal(state.patches.length,0);
});

test("truncated or failed summaries never advance coverage or overwrite the previous memory",async()=>{
  for(const failure of ["length","error","too-long","missing-points"]){
    const previous={text:"仍需保留的约定。",upToIndex:60,covered:60,tokens:10,sourceTokens:500,updatedAt:0};
    const state=setup(130,previous);
    fixture.send=async()=>({content:failure==="too-long"?"长".repeat(1700):"只写了一半",thinking:"",toolCalls:[],finishReason:failure==="length"?"length":"stop",error:failure==="error"?"network error":undefined});
    await maybeSummarize({conversationId:"conv",history:[],systemTokens:100,toolTokens:100});
    assert.equal(state.patches.length,0);assert.equal(state.conversation.summary,previous);
  }
});

test("manual compaction takes the oldest unprocessed prefix rather than skipping it",async()=>{
  const state=setup(12);fixture.state.settings.keepRecent=2;
  state.conversation.messages.forEach((message,i)=>{message.content=`唯一标记${i}：`+"字".repeat(5000);});
  await summarizeNow("conv");
  assert.equal(state.patches[0].upToIndex,4);
  const prompt=state.requests[0].args.messages[1].content;
  assert.match(prompt,/唯一标记0/);assert.match(prompt,/唯一标记3/);
  const source=prompt.split("本次需要回顾的原文：")[1];
  assert.doesNotMatch(source,/唯一标记9/);
});
