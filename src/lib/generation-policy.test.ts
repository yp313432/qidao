import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_IDLE_TIMEOUT_MS, withModelIdleTimeout, ModelIdleTimeoutError, readModelChunk, shouldRecoverThinking } from "./generation-policy.ts";
import { mergeReplyText, StreamTextAccumulator, canFinishAfterSideEffects } from "./reply-text.ts";
import { splitSegments } from "./segment.ts";
import { buildSummaryPrompt, summarySystemPrompt, cleanSummaryText, planSummary, SUMMARY_MAX_CHARS } from "./summary.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("等待上限为180秒，仅无数据时触发，持续思考可以超过单个等待窗口", async () => {
  assert.equal(MODEL_IDLE_TIMEOUT_MS, 180_000);
  await assert.rejects(withModelIdleTimeout(undefined, () => {}, async () => new Promise(() => {}), 10), ModelIdleTimeoutError);
  let count = 0;
  const result = await withModelIdleTimeout(undefined, () => count++, async (_signal, receive) => {
    for (let i = 0; i < 4; i++) { await sleep(15); receive({ thinking: "继续思考" }); }
    return "完成";
  }, 45);
  assert.equal(result, "完成"); assert.equal(count, 4);
});

test("用户主动停止和预先停止均及时退出，迟到数据不会继续修改回复", async () => {
  const controller = new AbortController(); let count = 0;
  const request = withModelIdleTimeout(controller.signal, () => count++, async (_signal, receive) => {
    await sleep(20); receive("迟到数据"); return "晚到";
  }, 100);
  controller.abort(new DOMException("用户停止", "AbortError"));
  await assert.rejects(request, { name: "AbortError" });
  await sleep(30); assert.equal(count, 0);
  await assert.rejects(withModelIdleTimeout(controller.signal, () => {}, async () => "不应执行", 100), { name: "AbortError" });
});

test("无响应的流在取消时释放读取，不依赖上游自行关闭", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const reader = stream.getReader(); const controller = new AbortController();
  const result = readModelChunk(reader, controller.signal);
  controller.abort(new DOMException("停止", "AbortError"));
  await assert.rejects(result, { name: "AbortError" }); assert.equal(cancelled, true);
  reader.releaseLock();
});

test("思考恢复只尝试一次，停止、权限错误、待处理工具和已有正文均不恢复", () => {
  const state = { hasText: false, hasThinking: true, aborted: false, pendingTools: false, attempts: 0, finishReason: "length" };
  assert.equal(shouldRecoverThinking(state), true);
  for (const patch of [{ attempts: 1 }, { aborted: true }, { pendingTools: true }, { hasText: true }, { finishReason: "content_filter" }, { error: "HTTP 401 invalid key" }]) assert.equal(shouldRecoverThinking({ ...state, ...patch }), false);
  assert.equal(shouldRecoverThinking({ ...state, finishReason: undefined, error: "等待上游超时" }), true);
});

test("超过十二句继续自然分泡，旧存档的有限上限也不会把尾部合并", () => {
  const text = Array.from({ length: 40 }, (_, i) => `第${i + 1}句。`).join("");
  for (const maxParts of [undefined, 1, 6, 12]) {
    const parts = splitSegments(text, { maxParts });
    assert.equal(parts.length, 40); assert.equal(parts.join(""), text);
  }
  const code = "```js\nconst x = '一。二。';\n```";
  assert.deepEqual(splitSegments(code), [code]);
});

test("工具续答去除长边界重叠和完全重复段落，保留真正新增内容", () => {
  assert.equal(mergeReplyText("先前的回答。刚才核实的内容已经清楚。", "刚才核实的内容已经清楚。现在补充依据。"), "先前的回答。刚才核实的内容已经清楚。现在补充依据。");
  const old = "这是一整段已经显示过的长回答，不必再重播。";
  assert.equal(mergeReplyText(old, `还有一点。\n\n${old}\n\n新的依据。`), `${old}\n\n还有一点。\n\n新的依据。`);
  assert.equal(mergeReplyText("前文。", "新增内容。"), "前文。\n\n新增内容。");
});

test("累计快照转换为新增片段，普通流里的有意重复保留", () => {
  const stream = new StreamTextAccumulator();
  const one = "这是一段足够长的初始回答。";
  assert.equal(stream.append(one), one);
  assert.equal(stream.append(one + "新的补充。"), "新的补充。");
  assert.equal(stream.append(one + "新的补充。"), "");
  const delta = new StreamTextAccumulator();
  delta.append("好。"); delta.append("好。"); assert.equal(delta.text, "好。好。");
});

test("只有成功的附带动作可省续答，查询、失败、待确认和过程性正文仍继续", () => {
  assert.equal(canFinishAfterSideEffects("我也想抱抱你。", ["emotion.report", "sticker.send"], [{ ok: true }, { ok: true }]), true);
  assert.equal(canFinishAfterSideEffects("已提交。", ["media.pause"], [{ ok: false, category: "pending" }]), false);
  assert.equal(canFinishAfterSideEffects("已暂停。", ["media.pause"], [{ ok: false, category: "skipped" }]), false);
  assert.equal(canFinishAfterSideEffects("[表情包]", ["sticker.send"], [{ ok: true }]), false);
  assert.equal(canFinishAfterSideEffects('{"primaryEmotion":"开心","intensity":0.5}', ["emotion.report"], [{ ok: true }]), false);
  assert.equal(canFinishAfterSideEffects("我去查一下。", ["emotion.report"], [{ ok: true }]), false);
  assert.equal(canFinishAfterSideEffects("查完告诉你。", ["web.search"], [{ ok: true }]), false);
});

test("总结是当前心态的自然回顾，不强制四栏或按旧记忆年龄删减", () => {
  const text = buildSummaryPrompt([{ role: "user", content: "今天有点累，别催我。" }, { role: "assistant", content: "好，我陪你。" }], undefined, { mood: "温柔", now: "2026-11-15" });
  assert.match(text, /以现在的心态/); assert.match(text, /温柔/); assert.match(text, /今天有点累/);
  assert.match(summarySystemPrompt(), /第一人称/);
  assert.doesNotMatch(text + summarySystemPrompt(), /只写四段|每段一行|旧摘要最多只能占|不抒情/);
});

test("超长/截断总结不被裁切后冒充完整记忆，外层代码围栏只去壳", () => {
  assert.equal(cleanSummaryText("```text\n我记得她说今天很累。\n```"), "我记得她说今天很累。");
  assert.equal(cleanSummaryText("字".repeat(SUMMARY_MAX_CHARS + 1)), null);
  assert.equal(cleanSummaryText("不完整的回忆", true), null);
});

test("达到消息阈值的后续批次仍能触发，最近原文不被总结覆盖", () => {
  const messages = Array.from({ length: 70 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: `第${i}条` }));
  const plan = planSummary({ messages, keepRecent: 16, everyMessages: 50, historyTokens: 100, historyRoom: 10000 });
  assert.equal(plan.should, true); assert.equal(plan.batch.length, 50); assert.equal(plan.upToIndex, 50);
  const next = planSummary({ messages: messages.slice(0, 50), summary: { text: "此前的回顾", upToIndex: 0, covered: 50, tokens: 10, updatedAt: 0, sourceTokens: 100 }, keepRecent: 0, everyMessages: 50, historyTokens: 100, historyRoom: 10000 });
  assert.equal(next.should, true); assert.equal(next.batch.length, 50);
});
