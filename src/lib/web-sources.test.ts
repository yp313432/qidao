import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { collectWebSources, messageWebSources, sourceForUrl, sourceKey, webReceiptFromCall } from "./web-sources.ts";
import { runWebAction } from "./web-actions.ts";
import { callSentence } from "./call-sentence.ts";
import type { ToolCallRecord } from "./types.ts";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return { shortCircuit: true, url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href };
  return next(specifier, context);
} });
const originalFetch = globalThis.fetch;
const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor); else Reflect.deleteProperty(globalThis, "location");
});
const hit = { title: "大学官网资料", url: "https://example.com/person", snippet: "研究方向与公开简介。" };
const call = (kind: "web.search" | "web.fetch", receipt: object, args = {}): ToolCallRecord => ({
  kind, name: kind.replace(".", "_"), args: JSON.stringify(args), ok: true, result: JSON.stringify({ version: 1, kind, ...receipt }),
});
const search = (results = [hit]) => call("web.search", { ok: true, query: "人物 研究方向", engine: "duckduckgo", results });
const fetchCall = (ok: boolean) => ({ ...call("web.fetch", { ok, url: hit.url,
  ...(ok ? { title: "正式简介", text: "实际读取的网页正文。" } : { why: "网页需要执行 JavaScript" }) }), ok });
const message = (calls: ToolCallRecord[]) => ({ steps: calls.map((c) => ({ kind: "call" as const, call: c })) });

test("search hits are candidate summaries, not claimed full-page reads", () => {
  const sources = collectWebSources(message([search()]));
  assert.equal(sources[0].state, "summary");
  assert.equal(sources[0].snippet, hit.snippet);
  assert.equal(sources[0].excerpt, undefined);
  assert.equal(sources[0].engine, "duckduckgo");
});

test("an unreadable page preserves all earlier search results", () => {
  const sources = collectWebSources(message([search([hit, { ...hit, title: "另一个来源", url: "https://example.org/article" }]), fetchCall(false)]));
  assert.equal(sources.length, 2);
  assert.equal(sources[0].state, "unavailable");
  assert.equal(sources[0].snippet, hit.snippet);
  assert.match(sources[0].why!, /JavaScript/);
  assert.equal(sources[1].state, "summary");
});

test("successful reads attach actual text and survive a later failed retry", () => {
  const sources = collectWebSources(message([search(), fetchCall(true), fetchCall(false)]));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].state, "read");
  assert.equal(sources[0].title, "正式简介");
  assert.equal(sources[0].excerpt, "实际读取的网页正文。");
  assert.equal(sources[0].snippet, hit.snippet);
});

test("multiple searches share stable source numbers; rounds and steps do not duplicate cards", () => {
  const first = search(), second = search([{ ...hit, url: hit.url + "#section" }, { ...hit, title: "新资料", url: "https://example.org/new" }]);
  const sources = collectWebSources({ ...message([first, second]), rounds: [{ round: 1, calls: [first] }, { round: 2, calls: [second] }] });
  assert.deepEqual(sources.map((s) => s.index), [1, 2]);
  assert.equal(sourceForUrl(sources, hit.url + "#details")?.index, 1);
  assert.equal(sourceForUrl(sources, "https://invented.example/no-result"), undefined);
  assert.equal(sourceKey("https://example.com/?x=1&signature=a#part"), "https://example.com/?x=1&signature=a");
});

test("legacy saved receipts become clickable sources, including encoded Chinese URLs", () => {
  const old = { kind: "web.search", name: "web_search", args: '{"query":"王为 四川大学"}', ok: true,
    result: "搜「王为 四川大学」找到 2 条（结果来自 bing-rss）：\n1. 王为 - 大学官网\n   https://example.com/%E7%8E%8B%E4%B8%BA\n   教师简介。\n2. 公开论文资料\n\nhttps://example.org/paper\n摘要内容。\n（要用哪条就再读它的正文。）" };
  const sources = collectWebSources(message([old]));
  assert.equal(sources.length, 2);
  assert.equal(sources[0].title, "王为 - 大学官网");
  assert.equal(sources[0].url, "https://example.com/%E7%8E%8B%E4%B8%BA");
  assert.equal(sources[1].snippet, "摘要内容。");
  assert.equal(sources[0].state, "summary");
});

test("gate prefixes and suffixes do not lose structured tool results", () => {
  const wrapped = search();
  wrapped.result = `按你的授权直接执行：${wrapped.result}（这个动作确实执行了）`;
  assert.equal(collectWebSources(message([wrapped])).length, 1);
});

test("invalid/private URLs and unrelated tool payloads cannot become citations", () => {
  const invalid = ["javascript:alert(1)", "http://127.1/", "http://192.168.1.2/", "https://secret@example.com/", "file:///tmp/a"];
  const sources = collectWebSources(message([search(invalid.map((url) => ({ ...hit, url })))]));
  assert.deepEqual(sources, []);
  assert.equal(webReceiptFromCall({ ...search(), kind: "memory.add", name: "memory_add" }), null);
  assert.deepEqual(collectWebSources({}), []);
  assert.equal(webReceiptFromCall({ ...search(), result: "{broken json", args: "not json" }), null);
});

test("empty purported full-page reads are not displayed as successfully read", () => {
  const receipt = webReceiptFromCall(call("web.fetch", { ok: true, url: hit.url, text: "  " }));
  assert.equal(receipt?.ok, false);
  assert.equal(collectWebSources(message([call("web.fetch", { ok: true, url: hit.url, text: "" })]))[0].state, "unavailable");
  const old = { kind: "web.fetch", name: "web_fetch", args: JSON.stringify({ url: hit.url }), ok: true,
    result: `读到了：旧标题\n${hit.url}（HTTP 200）` };
  assert.equal(webReceiptFromCall(old)?.ok, false, "a legacy receipt header alone is not article content");
});

test("cached source arrays stay stable while new message snapshots update read status", () => {
  const old = message([search()]);
  assert.equal(messageWebSources(old), messageWebSources(old));
  const updated = message([search(), fetchCall(true)]);
  assert.equal(messageWebSources(updated)[0].state, "read");
  assert.equal(messageWebSources(old)[0].state, "summary");
});

test("tool labels describe search and page outcomes without dumping JSON", () => {
  assert.equal(callSentence(search(), "小克").line, "小克 找到 1 个来源");
  assert.match(callSentence(fetchCall(false), "小克").line, /这页正文未读到/);
  assert.doesNotMatch(callSentence(fetchCall(false), "小克").line, /搜索失败/);
});

test("real search executor emits structured sources and a page failure stays page-scoped", async () => {
  Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "https:" } });
  globalThis.fetch = async (url) => String(url).startsWith("/api/search")
    ? Response.json({ ok: true, engine: "duckduckgo", results: [hit] })
    : Response.json({ ok: false, why: "正文是 JS 渲染的空壳" }, { status: 502 });
  const searched = JSON.parse(await runWebAction({ kind: "web.search", query: "人物 研究方向" }));
  assert.equal(searched.kind, "web.search");
  assert.equal(searched.ok, true);
  assert.deepEqual(searched.results, [hit]);
  const unread = JSON.parse(await runWebAction({ kind: "web.fetch", url: hit.url }));
  assert.equal(unread.kind, "web.fetch");
  assert.equal(unread.ok, false);
  assert.match(unread.summary, /只针对该网页/);
  assert.match(unread.summary, /搜索摘要/);
});

test("action-loop success/failure classification preserves structured web receipts", async () => {
  const { looksRefused } = await import("./tool-loop.ts");
  assert.equal(looksRefused(search().result), false);
  assert.equal(looksRefused(fetchCall(false).result), true);
  assert.equal(looksRefused(`按你的授权直接执行：${fetchCall(false).result}`), true);
});
