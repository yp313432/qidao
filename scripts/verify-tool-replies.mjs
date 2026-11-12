import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith("/chat-client.ts")) {
    const boundary = {
      "./models": "export const getModel = () => ({maxTokens:32000});",
      "./attachments": "export const attachmentsToText = () => '';",
      "./prompt": "export const assembleMessages = () => [];",
      "./platform": "export const isNativeApp = () => false;",
      "./tokens": "export const estimateTokens = () => 0;",
    }[specifier];
    if (boundary) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(boundary) };
  }
  if (specifier.startsWith("@/")) return { shortCircuit: true,
    url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href };
  if (specifier.startsWith("./") && context.parentURL?.endsWith("/chat-client.ts")) {
    return { shortCircuit: true, url: new URL(specifier + ".ts", context.parentURL).href };
  }
  return next(specifier, context);
} });
const { runToolLoop, toolResultMessages } = await import("../src/lib/tool-loop.ts");
const { makeServerRound } = await import("../src/lib/chat-client.ts");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const tool = { index: 0, id: "verify", name: "emotion_report", args: '{"primaryEmotion":"calm"}' };
const outcome = { ok: true, category: "ok", result: "核对结果", notice: "核对成功", title: "核对" };

async function replay(rounds, extra = {}) {
  let count = 0, displayed = "", thought = "";
  const snapshots = [], requests = [];
  const result = await runToolLoop({
    tools: null, baseMessages: [],
    onDelta: (d) => { thought += d.thinking || ""; },
    onContent: (text, round) => { displayed = text; snapshots.push({ text, round }); },
    send: async ({ onDelta, messages }) => {
      requests.push(messages);
      const r = rounds[count++];
      for (const d of r.deltas ?? []) onDelta(d);
      return { content: "", thinking: "", toolCalls: [], ...r.result };
    },
    runActions: async (calls) => calls.map(() => outcome),
    ...extra,
  });
  return { result, displayed, thought, snapshots, count, requests };
}

test("tool-before answer is replaced by final answer, in live snapshots and final storage", async () => {
  const first = "答案是 A。";
  const final = "答案是 A。工具核对后补充依据。";
  const r = await replay([
    { deltas: [{ thinking: "先核对。", content: first }], result: { content: first, thinking: "先核对。", toolCalls: [tool] } },
    { deltas: [{ thinking: "根据结果回答。", content: "答案是 A。" }, { content: "工具核对后补充依据。" }], result: { content: final } },
  ]);
  assert.equal(r.displayed, final);
  assert.equal(r.result.content, final);
  assert.equal(r.thought, "先核对。根据结果回答。");
  assert.equal(r.snapshots.find((s) => s.round === 2).text, "答案是 A。");
  assert.equal(r.requests[1].find((m) => m.role === "assistant").content, first);
  assert.equal(r.requests[1].find((m) => m.role === "assistant").reasoning_content, "先核对。");
});

test("several tool rounds do not concatenate drafts into one final reply", async () => {
  const r = await replay(["第一份草稿。", "第二份草稿。", "最终回答。"].map((content, i) => ({
    deltas: [{ content }], result: { content, toolCalls: i < 2 ? [{ ...tool, id: "c" + i }] : [] },
  })));
  assert.equal(r.displayed, "最终回答。");
  assert.equal(r.result.content, "最终回答。");
  assert.equal(r.result.rounds.length, 2);
});

test("buffered complete responses and genuine chunk streaming use the same round boundaries", async () => {
  for (const chunked of [false, true]) {
    const content = "这是最后的完整回答。";
    const r = await replay([
      { deltas: [{ content: "先回答一次。" }], result: { content: "先回答一次。", toolCalls: [tool] } },
      { deltas: chunked ? [{ content: "这是最后的" }, { content: "完整回答。" }] : [], result: { content } },
    ]);
    assert.equal(r.displayed, content);
    assert.equal(r.result.content, content);
  }
});

test("intentional repetition inside one reply is retained", async () => {
  const r = await replay([{ deltas: [{ content: "好。" }, { content: "好。" }], result: { content: "好。好。" } }]);
  assert.equal(r.displayed, "好。好。");
  assert.equal(r.result.content, "好。好。");
});

test("an empty last request preserves the last nonempty draft without concatenation", async () => {
  const r = await replay([
    { deltas: [{ content: "已收到。" }], result: { content: "已收到。", toolCalls: [tool] } },
    { deltas: [{ content: " " }], result: { content: " " } },
  ]);
  assert.equal(r.result.content, "已收到。");
});

test("abort after a tool keeps partial reply and reports that the loop stopped", async () => {
  const ac = new AbortController();
  const r = await replay([{ deltas: [{ content: "先核对。" }], result: { content: "先核对。", toolCalls: [tool] } }], {
    signal: ac.signal, runActions: async () => { ac.abort(); return [outcome]; },
  });
  assert.equal(r.count, 1);
  assert.equal(r.result.content, "先核对。");
  assert.equal(r.result.stoppedBy, "aborted");
});

test("tool history keeps text and reasoning separate, with backward-compatible empty content", () => {
  assert.equal(toolResultMessages([tool], [outcome])[0].content, "");
  const messages = toolResultMessages([tool], [outcome], "真实思考", "工具前说过的话");
  assert.equal(messages[0].content, "工具前说过的话");
  assert.equal(messages[0].reasoning_content, "真实思考");
  assert.equal(messages[1].content, "核对结果");
});

test("server transport accumulates content, thinking, calls and usage from the actual stream", async () => {
  globalThis.fetch = async () => new Response([
    { thinking: "核对一次。", content: "我先核对。" },
    { toolCalls: [{ index: 0, id: "srv", type: "function", function: { name: "emotion_", arguments: '{"primary' } }] },
    { toolCalls: [{ index: 0, function: { name: "report", arguments: 'Emotion":"calm"}' } }] },
    { usage: { prompt: 10, completion: 5 } }, { done: true },
  ].map((d) => `data: ${JSON.stringify(d)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  const deltas = [];
  const result = await makeServerRound({ messages: [{ role: "user", content: "核对" }] })({ messages: [], tools: null,
    onDelta: (d) => deltas.push(d) });
  assert.equal(result.content, "我先核对。");
  assert.equal(result.thinking, "核对一次。");
  assert.equal(result.toolCalls[0].name, "emotion_report");
  assert.equal(result.toolCalls[0].args, '{"primaryEmotion":"calm"}');
  assert.equal(result.usage.prompt, 10);
  assert.equal(deltas.filter((d) => d.content).length, 1);
});
