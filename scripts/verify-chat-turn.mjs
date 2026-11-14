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
  "@/lib/prompt": `export const promptToolsFor = () => [];
    export const systemPrompt = () => "test system";
    export const assembleMessages = (_, history) => [{role:"system", content:"test system"}, ...history];
    export const actionFeedback = () => "";
    export const pickWorldEntries = () => ({always:[], hit:[]});`,
  "@/lib/awareness": "export const buildContext = () => ({});",
  "@/lib/stickers": "export const DEFAULT_STICKER_GROUP = 'default'; export const stickerGroupList = () => [];",
  "@/lib/branding": "export const resolveAiName = () => '小克';",
  "@/lib/models": "export const isOwnApi = () => true; export const QUOTA_LIMIT = 1000;",
  "@/lib/announce": "export const announceAssistantMessage = () => {};",
  "@/lib/toast": "export const pushToast = () => {};",
  "@/lib/summarizer": "export const maybeSummarize = async () => {};",
  "@/lib/voice-bubble": `export const buildVoiceAttachment = async () => null;
    export const shouldVoiceReply = () => false; export const sweepVoiceAudio = () => {};`,
  "@/lib/tool-select": "export const selectActionKinds = ({allKinds}) => ({kinds:allKinds,groups:[]});",
  "@/lib/tokens": "export const estimateTokens = () => 0;",
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
    actionLog:[], pendingActions:[], mcp:[], httpTools:[], skills:[],
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
    const toolCalls = i === 0 ? calls("亲近") : i === 1 && mode !== "mixed" ? calls("温柔") : [];
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
  const expected = first + "\n\n" + second + "\n\n" + last;
  assert.equal(message.content, expected);
  assert.deepEqual(executed.map((a) => a.kind), ["emotion.report", "sticker.send"]);
  assert.equal(message.attachments.length, 1);
  assert.equal(message.steps.filter((s) => s.kind === "call" && s.call.ok).length, 2);
  assert.equal(message.steps.filter((s) => s.kind === "call" && s.call.category === "skipped").length, 2);
  assert.match(message.thinking, /想靠近/);
  const visible = snapshots.filter(Boolean);
  const start = visible.findIndex((text) => text.includes(first));
  assert.ok(start >= 0);
  assert.ok(visible.slice(start).every((text) => text.includes(first)), "first paragraph must never disappear");
  assert.equal(requests.length, 3);
  return message;
}

test("native chat preserves successive paragraphs and executes emotion/sticker once", async () => {
  await runScenario("native");
});
test("text fallback preserves successive paragraphs and executes emotion/sticker once", async () => {
  await runScenario("text");
});
test("native tools and text action blocks share the same per-reply limits", async () => {
  await runScenario("native", "mixed");
});
