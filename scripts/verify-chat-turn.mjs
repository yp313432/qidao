// Exercise the real chat hook, parser, tool loop and action runner without React/DOM dependencies.
// Only rendering, store persistence, upstream transport and unrelated services are substituted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const f = globalThis.__qidaoTurnFixture = {};
const boundary = {
  react: `export const useCallback = (fn) => { globalThis.__qidaoTurnFixture.callbacks.push(fn); return fn; };
    export const useRef = (current) => ({current});
    export const useState = (value) => [value, () => {}];
    export const useSyncExternalStore = (_, snapshot) => snapshot();`,
  "@/lib/store": `export const useApp = (selector) => selector(globalThis.__qidaoTurnFixture.state);
    useApp.getState = () => globalThis.__qidaoTurnFixture.state;`,
  "@/lib/chat-client": `export const historyForApi = (messages) => messages;
    export const makeDirectRound = () => (args) => globalThis.__qidaoTurnFixture.native(args);
    export const makeServerRound = makeDirectRound;
    export const streamChat = (...args) => globalThis.__qidaoTurnFixture.text(...args);`,
  "@/lib/prompt": `export const promptToolsFor = (mcp = []) => mcp.filter((server)=>server.enabled).map((server)=>({kind:"mcp",name:server.name,tools:server.tools}));
    export const systemPrompt = () => "test system";
    export const systemPromptSections = () => [{id:"system",title:"系统",text:"test system"}];
    export const perceptionBlock = () => "";
    export const assembleMessages = (_, history) => [{role:"system", content:"test system"}, ...history];
    export const actionFeedback = () => "";
    export const pickWorldEntries = () => ({always:[], hit:[]});`,
  "@/lib/awareness": "export const buildContext = () => ({});",
  "@/lib/stickers": "export const DEFAULT_STICKER_GROUP = 'default'; export const stickerGroupList = () => [];",
  "@/lib/branding": "export const resolveAiName = () => '小克';",
  "@/lib/models": "export const isOwnApi = () => true; export const QUOTA_LIMIT = 1000; export const getModel = () => ({maxTokens:16384});",
  "@/lib/announce": "export const announceAssistantMessage = () => {};",
  "@/lib/toast": "export const pushToast = () => {};",
  "@/lib/summarizer": "export const maybeSummarize = async () => {};",
  "@/lib/voice-bubble": `export const buildVoiceAttachment = async () => null;
    export const shouldVoiceReply = () => false; export const sweepVoiceAudio = () => {};`,
  "@/lib/tool-select": "export const selectActionKinds = ({allKinds}) => ({kinds:allKinds,groups:[]});",
  "@/lib/tokens": "export const estimateTokens = () => 0; export const shortHash = () => 'test';",
  "@/lib/breadcrumbs": "export const crumb = () => {}; export const setPhase = () => {};",
  "@/lib/tool-protocol": "export const shouldUseNativeTools = () => true;",
  "@/lib/utils": "export const uid = () => crypto.randomUUID();",
  "@/lib/voice": "export const resolveVoiceLang = () => 'zh'; export const speak = () => {};",
};
registerHooks({ resolve(specifier, context, next) {
  const mock = specifier === "@/lib/store" || context.parentURL?.endsWith("/use-chat.ts")
    ? boundary[specifier] : undefined;
  if (mock) return { shortCircuit:true, url:"data:text/javascript," + encodeURIComponent(mock) };
  if (specifier.startsWith("@/")) return { shortCircuit:true,
    url:new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href };
  return next(specifier, context);
} });
// The native watchdog is unrelated to these finite, scripted streams.
globalThis.window = { setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {} };
const { useChatStream } = await import("../src/lib/use-chat.ts");
const emotions = (word) => ({ kind:"emotion.report", primaryEmotion:word, group:"close" });
const sticker = (feel) => ({ kind:"sticker.send", feel });
const actions = (word) => [emotions(word), sticker(word)];
const textBlock = (word) => "\n\n```qidao\n" + JSON.stringify(actions(word)) + "\n```";
const calls = (word) => actions(word).map(({kind, ...args}, index) =>
  ({ index, id:crypto.randomUUID(), name:kind.replaceAll(".", "_"), args:JSON.stringify(args) }));

async function runScenario(protocol, mode = protocol) {
  const message = { id:"reply", role:"assistant", content:"" };
  const snapshots = [], executed = [], requests = [];
  let stickers = [], nativeRound = 0, textRound = 0;
  const first = "我也想抱抱你。", second = "靠近一点。", last = "这样暖和吗？";
  f.callbacks = [];
  f.state = {
    settings:{ permissions:{}, mergeSend:false, segmentReply:false, notifications:false },
    model:"test", conversations:[{id:"conv", messages:[message]}],
    actionLog:[], pendingActions:[], mcp:[], httpTools:[], skills:[], requestLog:[],
    logRequest:(entry) => { const rows=f.state.requestLog; const index=rows.findIndex((old)=>old.requestId===entry.requestId); if(index<0)rows.unshift(entry);else rows[index]={...rows[index],...entry}; },
    worldBook:[], stickerLib:[], stickerGroups:[],
    enabledTools:() => [],
    takeReplyStickers:() => { const result = stickers; stickers = []; return result; },
    patchMessage:(_, __, patch) => {
      Object.assign(message, patch);
      if ("content" in patch) snapshots.push(patch.content);
    },
    finalizeAssistant:(_, __, patch) => { Object.assign(message, patch); snapshots.push(patch.content); },
    requestAction:(action) => {
      executed.push(action);
      f.state.actionLog.unshift({title:action.kind, result:"ok", message:"已完成", at:executed.length});
      if (action.kind === "sticker.send") stickers.push("data:image/png;base64,AA==");
    },
  };
  const emit = async (onDelta, text, toolCalls = []) => {
    onDelta({thinking:"想靠近。"});
    for (const content of [...text]) {
      onDelta({content});
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    if (toolCalls.length) onDelta({toolCalls:toolCalls.map((c) => ({index:c.index, id:c.id,
      function:{name:c.name, arguments:c.args}}))});
    // Force an actual live flush before the next request, as on a mobile stream.
    await new Promise((resolve) => setTimeout(resolve, 110));
  };
  f.native = async ({onDelta, messages}) => {
    requests.push(messages);
    const i = nativeRound++;
    const content = i === 0 ? first : mode === "mixed" ? second + textBlock("温柔") : i === 1 ? second : last;
    const toolCalls = i === 0 ? [...calls("亲近"), ...(mode === "mixed" ? [{index:2,id:"lookup",name:"web_search",args:'{"query":"fixture"}'}] : [])] : i === 1 && mode !== "mixed" ? calls("温柔") : [];
    await emit(onDelta, content, toolCalls);
    return {content, thinking:"想靠近。", toolCalls};
  };
  f.text = async (req, onDelta) => {
    requests.push(req.messages);
    const i = textRound++;
    const content = mode === "mixed" ? last : i === 0 ? first + textBlock("亲近")
      : i === 1 ? second + textBlock("温柔") : last;
    await emit(onDelta, content);
  };
  useChatStream({forceProtocol:protocol});
  // The first useCallback is the production runStream callback; no copied execution logic.
  await f.callbacks[0]("conv", "reply", [{role:"user", content:"你暖和吗？"}]);
  const expected = mode === "mixed" ? first + "\n\n" + second : first;
  assert.equal(message.content, expected);
  assert.deepEqual(executed.map((a) => a.kind), ["emotion.report", "sticker.send", ...(mode === "mixed" ? ["web.search"] : [])]);
  assert.equal(message.attachments.length, 1);
  assert.equal(message.steps.filter((s) => s.kind === "call" && s.call.ok).length, mode === "mixed" ? 3 : 2);
  assert.equal(message.steps.filter((s) => s.kind === "call" && s.call.category === "skipped").length, mode === "mixed" ? 2 : 0);
  assert.match(message.thinking, /想靠近/);
  const visible = snapshots.filter(Boolean);
  const start = visible.findIndex((text) => text.includes(first));
  assert.ok(start >= 0);
  assert.ok(visible.slice(start).every((text) => text.includes(first)), "first paragraph must never disappear");
  assert.equal(requests.length, mode === "mixed" ? 2 : 1);
  return message;
}

test("native chat finishes after successful emotion/sticker without another generation", async () => {
  await runScenario("native");
});
test("text fallback finishes after successful emotion/sticker without another generation", async () => {
  await runScenario("text");
});
test("native tools and text action blocks share the same per-reply limits", async () => {
  await runScenario("native", "mixed");
});


async function thinkingScenario(protocol, options = {}) {
  const message = { id:"thinking-reply", role:"assistant", content:"" };
  const requests = [], logs = [];
  f.callbacks = [];
  f.state = { settings:{permissions:{},mergeSend:false,segmentReply:false,notifications:false}, model:"test",
    conversations:[{id:"conv",messages:[message]}], actionLog:[],pendingActions:[],mcp:[],httpTools:[],skills:[],
    worldBook:[],stickerLib:[],stickerGroups:[],requestLog:logs,
    enabledTools:()=>[],takeReplyStickers:()=>[],
    patchMessage:(_c,_m,patch)=>Object.assign(message,patch),
    finalizeAssistant:(_c,_m,patch)=>Object.assign(message,patch),
    logRequest:(entry)=>{const i=logs.findIndex((old)=>old.requestId===entry.requestId);if(i<0)logs.unshift(entry);else logs[i]={...logs[i],...entry};},
    requestAction:()=>{throw Error("answer recovery must not execute actions");},
  };
  let api;
  const generate = async (args) => {
    requests.push(args);
    const first = requests.length === 1;
    if (first || options.failRecovery) {
      args.onDelta({thinking:"已经想清楚了，需要把答案说出来。"});
      args.onDelta({finishReason:"length"});
      if (options.stop) api.stop();
      const usage={prompt:100,completion:80,cached:50};args.onDelta({usage});
      return {content:"",thinking:"已经想清楚了，需要把答案说出来。",toolCalls:[],finishReason:"length",usage};
    }
    assert.equal(args.tools,null,"recovery does not expose executable tools");
    assert.ok(args.messages.some((entry)=>entry.role==="assistant"&&entry.reasoning_content),"preserve the thought in its protocol field");
    assert.match(args.messages.at(-1).content,/不再调用工具/);
    args.onDelta({content:"我想好了，现在把答案告诉你。"});
    args.onDelta({finishReason:"stop"});
    return {content:"我想好了，现在把答案告诉你。",thinking:"",toolCalls:[],finishReason:"stop",usage:{prompt:40,completion:10,cached:20}};
  };
  f.native=generate;
  f.text=async (req,onDelta)=>{await generate({messages:req.messages,onDelta,tools:undefined});};
  api=useChatStream({forceProtocol:protocol});
  await f.callbacks[0]("conv",message.id,[{role:"user",content:"想清楚后告诉我。"}]);
  return {message,requests,logs};
}

test("thinking-only native result gets one answer-only recovery and preserves all usage", async()=>{
  const r=await thinkingScenario("native");
  assert.equal(r.requests.length,2);assert.match(r.message.content,/把答案告诉你/);
  assert.match(r.message.thinking,/已经想清楚/);assert.equal(r.message.requestError,undefined);
  assert.equal(r.message.usage.prompt,140);assert.equal(r.message.usage.cached,70);
  assert.deepEqual(new Set(r.logs.map((entry)=>entry.purpose)),new Set(["chat","recovery"]));
});
test("thinking-only text response uses the same one-shot recovery",async()=>{
  const r=await thinkingScenario("text");assert.equal(r.requests.length,2);assert.match(r.message.content,/把答案告诉你/);
});
test("another thinking-only recovery does not loop or silently succeed",async()=>{
  const r=await thinkingScenario("native",{failRecovery:true});
  assert.equal(r.requests.length,2);assert.match(r.message.requestError,/已尝试补一次/);
});
test("user stop preserves thinking and never starts recovery",async()=>{
  const r=await thinkingScenario("native",{stop:true});
  assert.equal(r.requests.length,1);assert.match(r.message.content,/已停止/);assert.match(r.message.thinking,/已经想清楚/);
});

test("large external catalogs stay local; discovery then execution uses the same permission runner and actual tool totals", async()=>{
  const { externalToolCatalog, searchExternalTools } = await import('../src/lib/tool-discovery.ts');
  const message={id:'discovery-reply',role:'assistant',content:''};const requests=[],logs=[],actions=[];
  const mcp=[{id:'github',name:'GitHub',enabled:true,tools:[{name:'search_repositories',description:'搜索仓库',inputSchema:{type:'object',properties:{query:{type:'string',description:'此说明不要在闲聊中常驻'.repeat(3000)}},required:['query']}}]}];
  f.callbacks=[];
  f.state={settings:{permissions:{mcp_tools:'allow'},mergeSend:false,segmentReply:false,notifications:false},model:'sonnet',
    conversations:[{id:'conv',messages:[message]}],mcp,httpTools:[],skills:[],requestLog:logs,actionLog:[],pendingActions:[],worldBook:[],stickerLib:[],stickerGroups:[],
    enabledTools:()=>mcp,takeReplyStickers:()=>[],patchMessage:(_c,_m,patch)=>Object.assign(message,patch),finalizeAssistant:(_c,_m,patch)=>Object.assign(message,patch),
    logRequest:(entry)=>{const i=logs.findIndex(old=>old.requestId===entry.requestId);if(i<0)logs.unshift(entry);else logs[i]={...logs[i],...entry};},
    requestAction:(action)=>{
      actions.push(action);
      const result=action.kind==='tool.search'?searchExternalTools(externalToolCatalog([{kind:'mcp',name:'GitHub',tools:mcp[0].tools}]),action):'查到两个仓库';
      f.state.actionLog.unshift({title:action.kind,result:'ok',message:result,at:actions.length});
    },
  };
  f.native=async(args)=>{
    requests.push(args);
    const names=args.tools.map(tool=>tool.function.name);
    assert.ok(names.includes('tool_search'));assert.ok(names.includes('tool_call'));
    assert.ok(names.every(name=>!name.startsWith('mcp_')));
    assert.doesNotMatch(JSON.stringify(args.tools),/此说明不要在闲聊中常驻/);
    const index=requests.length;
    const call=index===1?{name:'tool_search',args:'{"query":"GitHub"}'}:index===2?{name:'tool_call',args:'{"server":"GitHub","tool":"search_repositories","args":{"query":"qidao"}}'}:null;
    if(index===2){const body=args.messages.find(m=>m.role==='tool').content;const result=JSON.parse(body.slice(body.indexOf('{'),body.lastIndexOf('}')+1));assert.equal(result.tools[0].call.server,'GitHub');}
    const content=index===3?'查到两个仓库。':'';
    if(content)args.onDelta({content});
    return {content,thinking:'',toolCalls:call?[{...call,id:'step'+index,index:0}]:[],usage:{prompt:100,completion:10,cached:50},finishReason:call?'tool_calls':'stop'};
  };
  useChatStream({forceProtocol:'native'});
  await f.callbacks[0]('conv',message.id,[{role:'user',content:'查一下仓库'}]);
  assert.equal(requests.length,3);assert.deepEqual(actions.map(action=>action.kind),['tool.search','tool.call']);
  assert.equal(message.content,'查到两个仓库。');assert.equal(message.usage.prompt,300);assert.equal(message.usage.requests,3);
  assert.equal(message.usage.tools,logs.reduce((sum,entry)=>sum+entry.inputEstimate.tools,0));
});

test("text compatibility discovers external tools before execution without native tool support",async()=>{
  const message={id:'text-discovery',role:'assistant',content:''};const requests=[],actions=[],logs=[];
  const mcp=[{id:'github',name:'GitHub',enabled:true,tools:[{name:'search_repositories',description:'搜索仓库',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}}]}];
  f.callbacks=[];
  f.state={settings:{permissions:{mcp_tools:'allow'},mergeSend:false,segmentReply:false,notifications:false},model:'sonnet',conversations:[{id:'conv',messages:[message]}],mcp,httpTools:[],skills:[],requestLog:logs,actionLog:[],pendingActions:[],worldBook:[],stickerLib:[],stickerGroups:[],
    enabledTools:()=>mcp,takeReplyStickers:()=>[],patchMessage:(_c,_m,p)=>Object.assign(message,p),finalizeAssistant:(_c,_m,p)=>Object.assign(message,p),
    logRequest:(entry)=>{const i=logs.findIndex(old=>old.requestId===entry.requestId);if(i<0)logs.unshift(entry);else logs[i]={...logs[i],...entry};},
    requestAction:(action)=>{actions.push(action);f.state.actionLog.unshift({title:action.kind,result:'ok',message:action.kind==='tool.search'?'GitHub/search_repositories，参数 query:string；用 tool.call 执行':'实际查到两个仓库',at:actions.length});},
  };
  f.text=async(req,onDelta)=>{
    requests.push(req);assert.equal(req.discoverExternal,true);
    const action=requests.length===1?{kind:'tool.search',query:'GitHub'}:requests.length===2?{kind:'tool.call',server:'GitHub',tool:'search_repositories',args:{query:'qidao'}}:null;
    onDelta({content:action?'```qidao\n'+JSON.stringify(action)+'\n```':'查到两个仓库。'});
    onDelta({usage:{prompt:100,completion:10,cached:50}});
  };
  useChatStream({forceProtocol:'text'});await f.callbacks[0]('conv',message.id,[{role:'user',content:'查一下仓库'}]);
  assert.equal(requests.length,3);assert.deepEqual(actions.map(a=>a.kind),['tool.search','tool.call']);
  assert.equal(message.content,'查到两个仓库。');assert.equal(message.usage.prompt,300);assert.equal(message.usage.requests,3);
  assert.ok(requests[1].messages.some(m=>m.content.includes('query:string')));
});
