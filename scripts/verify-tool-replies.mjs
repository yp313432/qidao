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
const { runToolLoop, toolResultMessages, createTurnActionRunner } = await import("../src/lib/tool-loop.ts");
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

test("a verbatim replay extends the answer without retracting it or duplicating the prefix", async () => {
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

test("several tool rounds preserve every distinct paragraph in live snapshots and final storage", async () => {
  const r = await replay(["第一份草稿。", "第二份草稿。", "最终回答。"].map((content, i) => ({
    deltas: [{ content }], result: { content, toolCalls: i < 2 ? [{ ...tool, id: "c" + i }] : [] },
  })));
  assert.equal(r.displayed, "第一份草稿。\n\n第二份草稿。\n\n最终回答。");
  assert.equal(r.result.content, r.displayed);
  assert.ok(r.snapshots.filter((s) => s.round >= 2).every((s) => s.text.startsWith("第一份草稿。")));
  assert.equal(r.result.rounds.length, 2);
});

test("buffered complete responses and genuine chunk streaming use the same round boundaries", async () => {
  for (const chunked of [false, true]) {
    const content = "这是最后的完整回答。";
    const r = await replay([
      { deltas: [{ content: "先回答一次。" }], result: { content: "先回答一次。", toolCalls: [tool] } },
      { deltas: chunked ? [{ content: "这是最后的" }, { content: "完整回答。" }] : [], result: { content } },
    ]);
    assert.equal(r.displayed, "先回答一次。\n\n" + content);
    assert.equal(r.result.content, r.displayed);
  }
});

test("intentional repetition inside one reply is retained", async () => {
  const r = await replay([{ deltas: [{ content: "好。" }, { content: "好。" }], result: { content: "好。好。" } }]);
  assert.equal(r.displayed, "好。好。");
  assert.equal(r.result.content, "好。好。");
});

test("an empty last request keeps the already displayed answer", async () => {
  const r = await replay([
    { deltas: [{ content: "已收到。" }], result: { content: "已收到。", toolCalls: [tool] } },
    { deltas: [{ content: " " }], result: { content: " " } },
  ]);
  assert.equal(r.result.content, "已收到。");
  assert.equal(r.displayed, "已收到。");
});

test("a token-by-token continuation never drops the paragraph before the tool", async () => {
  const first = "我也想靠近你。";
  const tail = "再抱紧一点。";
  const r = await replay([
    { deltas: [...first].map((content) => ({ content })), result: { toolCalls: [tool] } },
    { deltas: [...tail].map((content) => ({ content })) },
  ]);
  assert.equal(r.result.content, first + "\n\n" + tail);
  assert.ok(r.snapshots.filter((s) => s.round === 2).every((s) => s.text.startsWith(first)));
});

test("emotion and sticker limits span batches and different arguments, while other tools can repeat", async () => {
  const executed = [];
  const run = createTurnActionRunner(async (calls) => {
    executed.push(...calls);
    return calls.map(() => outcome);
  });
  const call = (name, value) => ({ ...tool, name, args: JSON.stringify({ value }) });
  const first = await run([call("emotion_report", "想抱你"), call("emotion_report", "想亲你"),
    call("sticker_send", "开心"), call("sticker_send", "害羞")]);
  assert.deepEqual(first.map((o) => o.category), ["ok", "skipped", "ok", "skipped"]);
  const second = await run([call("emotion_report", "温柔"), call("sticker_send", "拥抱"),
    call("web_search", "A"), call("web_search", "B")]);
  assert.deepEqual(second.map((o) => o.category), ["skipped", "skipped", "ok", "ok"]);
  assert.deepEqual(executed.map((c) => c.name), ["emotion_report", "sticker_send", "web_search", "web_search"]);
  assert.match(second[0].result, /没有再次执行/);
});

test("failed parameters may be corrected; successful and pending actions keep their slot", async () => {
  let attempts = 0;
  const run = createTurnActionRunner(async () => [++attempts === 1
    ? { ...outcome, ok: false, category: "badargs" } : outcome]);
  assert.equal((await run([tool]))[0].category, "badargs");
  assert.equal((await run([tool]))[0].category, "ok");
  assert.equal((await run([tool]))[0].category, "skipped");
  assert.equal(attempts, 2);
  const pending = createTurnActionRunner(async () => [{ ...outcome, ok: false, category: "pending" }]);
  assert.equal((await pending([tool, tool]))[1].category, "skipped");
  let timeouts = 0;
  const running = createTurnActionRunner(async () => {
    timeouts += 1;
    return [{ ...outcome, ok: false, category: "skipped" }];
  });
  await running([tool, tool]);
  assert.equal(timeouts, 1); // 没等到回执不等于没执行，不能重新入队。
});

test("concurrent calls share the slot; a new reply gets fresh slots", async () => {
  let release;
  const run = createTurnActionRunner(async () => {
    await new Promise((resolve) => { release = resolve; });
    return [outcome];
  });
  const first = run([tool]);
  assert.equal((await run([tool]))[0].category, "skipped");
  release();
  assert.equal((await first)[0].category, "ok");
  assert.equal((await createTurnActionRunner(async () => [outcome])([tool]))[0].category, "ok");
});

test("suppressed native calls get tool receipts and do not erase the ongoing reply", async () => {
  let executions = 0;
  const run = createTurnActionRunner(async (calls) => {
    executions += calls.length;
    return calls.map(() => outcome);
  });
  const r = await replay(["先抱抱你。", "靠在我怀里。", "这样暖和吗？"].map((content, i) => ({
    deltas: [{ content }], result: { content, toolCalls: i < 2
      ? [{ ...tool, id: "c" + i, args: JSON.stringify({ primaryEmotion: i ? "温柔" : "心动" }) }] : [] },
  })), { runActions: run });
  assert.equal(executions, 1);
  assert.equal(r.result.content, "先抱抱你。\n\n靠在我怀里。\n\n这样暖和吗？");
  assert.equal(r.result.rounds[1].calls[0].category, "skipped");
  assert.match(r.requests[2].filter((m) => m.role === "tool")[1].content, /没有再次执行/);
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

