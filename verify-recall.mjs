/**
 * 验收：**记忆召回升级成"两段式"** —— 标签对不上，意思像也能想起来。
 *
 * 用户原话："记忆升级的话，加一个那个语义检索功能就可以了，我觉得。"
 *
 * 跑法：`node verify-recall.mjs`（dev server 在 127.0.0.1:8080）
 *
 * ── 三段，对应三条要求
 *
 *   【一】**纯 node 断言**（不起浏览器、不连外网、不花任何额度）
 *     ① ⭐ **最关键的一条**：两条记忆，标签里**没有**查询用的词，但意思相关
 *        （记忆「上次那件让我心里一紧的事」标签 `心动/紧张`；查询「我心慌」）
 *        → 断言**能想起来**（返回它，且 `matchedBy === "semantic"`）
 *     ② **混合排序**：标签**真命中**的排在语义相关**前面**
 *     ③ **退路**：模型调用失败 / 超时 → **仍能返回粗筛结果**，并**如实说明"语义那步没成"**
 *     ④ **缓存**：同一 query + 记忆库没变 → 第二次**不再调模型**
 *     ⑤ **诚实**：真的都无关 → `note` 就是「暂无可关联的历史记忆。」
 *     ⑥ 粗筛的**关键改动**：标签不命中时**也要给候选**（不然第二段没东西可挑）
 *     ⑦ 硬上限：候选 ≤20 / 精排返回 ≤5 / 只发 `id + 一小段内容`（不塞全文）
 *     ⑧ 只读：跑完记忆数组一个字节都没变
 *   【二】**反向验证**：把"能想起来"那一条**故意弄坏**（假上游什么都不挑）
 *     → 断言**同一组检查会红**。绿的是检查本身，不是运气。
 *   【三】**真浏览器**（390x844，Edge，只连 8080）：
 *     星屿插件里造一条"标签不命中但语义相关"的记忆 →
 *     那一行说明**真的出现了**、点开**就地展开**、无 pageerror，截图 `recall-semantic.png`
 *
 * ── 假上游
 *   纯 node 那段注入一个**假精排器**（不需要网络）。
 *   浏览器那段用 `page.addInitScript` 把发往 `…/chat/completions` 的 `fetch`
 *   换成"读请求里的候选、挑出那条意思像的"—— **不起任何新端口、不连外网**
 *   （仓库里"会自己占端口"的那几个验收不在这条路上）。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** 先要能直接 import 那个 `.ts`（Node 的类型擦除）。没带 flag 就自己再跑一遍带 flag 的。 */
if (!process.execArgv.includes("--experimental-strip-types")) {
  const self = fileURLToPath(import.meta.url);
  const child = spawnSync(process.execPath, ["--experimental-strip-types", self, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(child.status ?? 1);
}

const { mkdirSync } = await import("node:fs");
const { resolve } = await import("node:path");

const BASE = "http://127.0.0.1:8080";
const PAGE_URL = `${BASE}/play/plugins/emotion`;
const SHOT_NAME = "recall-semantic.png";
const SHOT_DIRS = [resolve(process.cwd(), "..", "preview-shots"), resolve(process.cwd(), "preview-shots")];

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

const R = await import("./src/lib/recall.ts");
const {
  recallMemories,
  coarseRecall,
  recallNeedles,
  libraryVersion,
  clearRecallCache,
  recallCacheSize,
  EMPTY_RECALL_NOTE,
  RERANK_MAX_PICKS,
  COARSE_MAX_CANDIDATES,
} = R;

/* ───────────────────────────── 夹具 ───────────────────────────── */

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const DAY = 86_400_000;
const mk = (id, content, tags, extra = {}) => ({
  id,
  kind: "preference",
  content,
  source: "对话",
  confidence: 0.9,
  strength: 1,
  status: "active",
  tags,
  links: [],
  recallCount: 0,
  createdAt: NOW - 3 * DAY,
  updatedAt: NOW - 3 * DAY,
  ...extra,
});

/**
 * 就是这个例子（任务书里点名的那条）：
 *   · `m-flinch` 标签是 `心动/紧张`，**查询「我心慌」里的字一个都不在标签里**
 *     —— 升级前它根本不会被想起来。
 */
const LIB = [
  mk("m-flinch", "上次那件让我心里一紧的事", ["心动", "紧张"], { updatedAt: NOW - 5 * DAY }),
  mk("m-heart", "被人记住一个很小的习惯时，会有一点说不清的心动。", ["心动", "想被珍惜"], {
    updatedAt: NOW - 2 * DAY,
    recallCount: 3,
  }),
  mk("m-rain", "上周一起听雨的那个晚上，没有被催促，所以很安心。", ["安心"], { updatedAt: NOW - 4 * DAY }),
  mk("m-coffee", "喜欢喝美式，不加糖。", ["咖啡"], { updatedAt: NOW - 6 * DAY }),
];
const FROZEN = JSON.stringify(LIB);

/** 一个纯 node 的"假上游"：按 id 挑，并记下它被调了几次 */
function fakeReranker(picks, log = { calls: 0 }) {
  const fn = async (input) => {
    log.calls += 1;
    log.lastQuery = input.query;
    log.lastCandidates = input.candidates;
    return typeof picks === "function" ? picks(input) : picks;
  };
  fn.log = log;
  return fn;
}

/* ══════════════════ 【一】纯 node 断言 ══════════════════ */

console.log("【一】两段式召回的口径（pure node · 真 import 那个 .ts）");
{
  const src = await (await import("node:fs/promises")).readFile(resolve("src/lib/recall.ts"), "utf8");
  check(
    "召回那一层是只读的（源码里没有 addMemory / updateMemory / deleteMemory / reinforce / setState）",
    !/addMemory|updateMemory|deleteMemory|reinforce\(|setState\s*\(/.test(src),
  );
}

/* ① ⭐ 最关键的一条：标签不命中、意思像 → 能想起来 */
clearRecallCache();
{
  const rerank = fakeReranker([{ id: "m-flinch", why: "都是心里一紧那种发慌" }]);
  const r = await recallMemories("我心慌", { list: LIB, rerank, limit: 5, now: NOW });
  const hit = r.items.find((i) => i.memory.id === "m-flinch");

  // 先证明前提成立：查询的字**确实**不在那两条标签里（不然后面就是在验同义词）
  const needles = recallNeedles("我心慌");
  const tagsOfFlinch = LIB[0].tags.map((t) => t.toLowerCase());
  check(
    "前提：查询「我心慌」的词**一个都不在** m-flinch 的标签（心动/紧张）里",
    needles.every((n) => !tagsOfFlinch.some((t) => t === n || t.includes(n))),
    `针=${JSON.stringify(needles)} 标签=${JSON.stringify(tagsOfFlinch)}`,
  );
  check(
    "⭐ 标签不命中但**意思相关** → 真的想起来了（`matchedBy === \"semantic\"`）",
    Boolean(hit) && hit.matchedBy === "semantic",
    hit ? `${hit.memory.id} · ${hit.matchedBy} · ${hit.why}` : "没想起来（这就叫'标签对不上就想不起来'）",
  );
  check("语义那一步的状态是 ok（真的调了模型、真的挑出来了）", r.semantic === "ok", `semantic=${r.semantic}`);
  check(
    "粗筛**确实把那条不命中的也当候选送出去了**（升级前它连门都进不了）",
    (rerank.log.lastCandidates ?? []).some((c) => c.id === "m-flinch"),
    `候选=${(rerank.log.lastCandidates ?? []).map((c) => c.id).join(",")}`,
  );
}

/* ② 混合排序：标签真命中 > 语义相关 */
clearRecallCache();
{
  const rerank = fakeReranker([{ id: "m-rain", why: "都在说没有被催促的那种安心" }]);
  const r = await recallMemories("心动", { list: LIB, rerank, limit: 5, now: NOW });
  const ids = r.items.map((i) => i.memory.id);
  const tagIdx = r.items.findIndex((i) => i.matchedBy === "tag");
  const semIdx = r.items.findIndex((i) => i.matchedBy === "semantic");
  check(
    "标签真命中（m-heart，标签就是「心动」）**排在**语义相关（m-rain）**前面**",
    tagIdx >= 0 && semIdx >= 0 && tagIdx < semIdx,
    `顺序=${ids.join(" > ")}（tag@${tagIdx} semantic@${semIdx}）`,
  );
  check(
    "两种来源都在结果里（这才叫混合检索，不是二选一）",
    ids.includes("m-heart") && ids.includes("m-rain"),
    ids.join(","),
  );
  check("同类重合时**真命中优先**：m-flinch 标签也有「心动」→ 也算 tag，不会掉到 semantic", 
    r.items.find((i) => i.memory.id === "m-flinch")?.matchedBy === "tag");
}

/* ③ 退路：模型失败 → 仍能返回粗筛结果 + 如实说明 */
clearRecallCache();
{
  const boom = async () => {
    throw new Error("上游 503：还没接模型");
  };
  const r = await recallMemories("心动", { list: LIB, rerank: boom, limit: 5, now: NOW });
  const tagIds = r.items.filter((i) => i.matchedBy === "tag").map((i) => i.memory.id);
  check(
    "模型调用**失败** → 粗筛结果照旧返回（检索本身没失败）",
    r.items.length > 0 && tagIds.includes("m-heart"),
    `返回 ${r.items.length} 条：${r.items.map((i) => i.memory.id).join(",")}`,
  );
  check("并且**如实说**「语义那一步没成」", r.semantic === "failed" && /没成|没跑成/.test(r.note), `note=${r.note}`);
}

/* ③b 退路：模型超时 → 同样退回 + 如实说 */
clearRecallCache();
{
  const hang = () => new Promise(() => {}); // 永远不 resolve
  const t0 = Date.now();
  const r = await recallMemories("心动", { list: LIB, rerank: hang, limit: 5, timeoutMs: 400, now: NOW });
  const ms = Date.now() - t0;
  check(
    "模型**超时** → 粗筛结果照旧返回（没有被吊死）",
    r.items.some((i) => i.memory.id === "m-heart") && ms < 5000,
    `用时 ${ms}ms · 返回 ${r.items.length} 条`,
  );
  check("超时也**如实说**（note 里点明是超时）", r.semantic === "timeout" && /超时/.test(r.note), `note=${r.note}`);
}

/* ③c 关掉语义 → 只走本地，且**一个请求都不发** */
clearRecallCache();
{
  const rerank = fakeReranker([{ id: "m-rain", why: "不该被用到" }]);
  const r = await recallMemories("心动", { list: LIB, rerank, semantic: false, limit: 5, now: NOW });
  check(
    "`semantic: false` 能真的关掉（模型一次都没调，只剩真命中）",
    rerank.log.calls === 0 && r.semantic === "off" && r.items.every((i) => i.matchedBy === "tag"),
    `调用 ${rerank.log.calls} 次 · semantic=${r.semantic}`,
  );
}

/* ④ 缓存：第二次同样 query 不再调模型 */
clearRecallCache();
{
  const rerank = fakeReranker([{ id: "m-flinch", why: "心里一紧" }]);
  const a = await recallMemories("我心慌", { list: LIB, rerank, limit: 5, now: NOW });
  const b = await recallMemories("我心慌", { list: LIB, rerank, limit: 5, now: NOW });
  check(
    "缓存生效：同一 query + 同一记忆库 → 第二次**不再调模型**",
    rerank.log.calls === 1 && b.fromCache === true && b.semantic === "cached",
    `模型调用 ${rerank.log.calls} 次 · 第二次 fromCache=${b.fromCache}`,
  );
  check(
    "复用出来的结果跟第一次一模一样（条数 + id + 理由）",
    JSON.stringify(a.items.map((i) => [i.memory.id, i.why, i.matchedBy])) ===
      JSON.stringify(b.items.map((i) => [i.memory.id, i.why, i.matchedBy])),
  );
  /* 记忆库一变 → 版本变 → 缓存必须失效 */
  const changed = [...LIB, mk("m-new", "刚记下来的一条。", ["新"])];
  const c = await recallMemories("我心慌", { list: changed, rerank, limit: 5, now: NOW });
  check(
    "记忆库变了（条数/updatedAt 变）→ 缓存**自动失效**，重新调模型",
    c.fromCache === false && rerank.log.calls === 2,
    `调用 ${rerank.log.calls} 次 · version=${libraryVersion(changed)}`,
  );
  check("缓存是有上限的（不会变成一个常驻内存的记忆库）", recallCacheSize() <= 24, `缓存 ${recallCacheSize()} 条`);
}

/* ④b 同时在飞的那几次检索**只花一次钱**（界面会几乎同时触发好几次） */
clearRecallCache();
{
  const rerank = fakeReranker([{ id: "m-flinch", why: "心里一紧" }]);
  const [x, y, z] = await Promise.all([
    recallMemories("我心慌", { list: LIB, rerank, limit: 5, now: NOW }),
    recallMemories("我心慌", { list: LIB, rerank, limit: 5, now: NOW }),
    recallMemories("我心慌", { list: LIB, rerank, limit: 5, now: NOW }),
  ]);
  check(
    "同 key 的三次并发检索 → 模型**只被调了 1 次**（在飞的那趟被共用）",
    rerank.log.calls === 1,
    `模型调用 ${rerank.log.calls} 次`,
  );
  check(
    "三次拿到的结果一致",
    JSON.stringify(x.items.map((i) => i.memory.id)) === JSON.stringify(y.items.map((i) => i.memory.id)) &&
      JSON.stringify(y.items.map((i) => i.memory.id)) === JSON.stringify(z.items.map((i) => i.memory.id)),
    x.items.map((i) => i.memory.id).join(","),
  );
}

/* ⑤ 诚实：真的都无关 → 还是那句老文案 */
clearRecallCache();
{
  const rerank = fakeReranker([]); // 模型明确说"一条都不相关"
  const r = await recallMemories("恼怒", { list: LIB, rerank, limit: 5, now: NOW });
  check(
    "真的都无关 → `note` **就是**「暂无可关联的历史记忆。」（一个字没改）",
    r.items.length === 0 && r.note === EMPTY_RECALL_NOTE,
    `items=${r.items.length} note="${r.note}"`,
  );
  check("而且**没有硬连**（一条都没返回）", r.items.length === 0);
  check(
    "模型确实被问过了（「都无关」是它给的结论，不是我们没问）",
    rerank.log.calls === 1 && r.semantic === "empty",
    `调用 ${rerank.log.calls} 次 · semantic=${r.semantic}`,
  );
}

/* ⑥ 粗筛：标签不命中**也要给候选**（这是第二段能工作的前提） */
{
  const many = Array.from({ length: 25 }, (_, i) =>
    mk(`f${i}`, `第 ${i} 条跟查询毫无关系的日常记录。`, ["日常"], {
      updatedAt: NOW - i * DAY,
    }),
  );
  const cands = coarseRecall(many, "我心慌", { now: NOW });
  check(
    `标签/关键词全不命中时，粗筛**仍然给候选**（${cands.length} 条），不是空数组`,
    cands.length > 0 && cands.every((c) => c.matchedBy === "fill"),
    `${cands.length} 条，全是 fill`,
  );
  check(
    `候选**硬上限 ${COARSE_MAX_CANDIDATES} 条**（要 100 也只给 20）`,
    coarseRecall(many, "我心慌", { candidateLimit: 100, now: NOW }).length === COARSE_MAX_CANDIDATES,
    `要到 ${coarseRecall(many, "我心慌", { candidateLimit: 100, now: NOW }).length} 条`,
  );
  check(
    "补位顺序是「最近 > 强度」（f0 最新，必须排在最前）",
    cands[0].memory.id === "f0",
    `第一条=${cands[0]?.memory.id}`,
  );
  const mixed = coarseRecall(LIB, "心动", { now: NOW });
  const firstFill = mixed.findIndex((c) => c.matchedBy === "fill");
  const lastReal = mixed.map((c) => c.matchedBy).lastIndexOf("tag");
  check("粗筛里真命中**排在 fill 前面**", lastReal < firstFill || firstFill === -1, mixed.map((c) => `${c.memory.id}:${c.matchedBy}`).join(" "));
}

/* ⑦ 硬上限 + 只发一小段内容（不塞全文） */
clearRecallCache();
{
  const long = mk("m-long", "很长的记忆正文。".repeat(40), ["长"], { updatedAt: NOW - 9 * DAY });
  const rerank = fakeReranker((input) => input.candidates.map((c) => ({ id: c.id, why: "挑你" })));
  const r = await recallMemories("完全不相关的查询", { list: [long], rerank, limit: 5, now: NOW });
  // ⚠️ 写成防崩的：源码被改坏时这里可能压根没被调用 —— 那该是干净的红，不是崩
  const sent = rerank.log.lastCandidates?.[0] ?? { content: "", tags: [], id: "" };
  check(
    "发给模型的候选只有 `id + 一小段内容`（长记忆被截断，**不塞全文**）",
    [...sent.content].length <= 81 && sent.content.endsWith("…") && [...sent.content].length < [...long.content].length,
    `发出 ${[...sent.content].length} 字 / 原文 ${[...long.content].length} 字`,
  );
  check(
    "而**界面上拿到的仍然是全文**（截断只发生在发给模型的那一份）",
    r.items[0]?.memory.content === long.content,
    `返回 ${[...(r.items[0]?.memory.content ?? "")].length} 字`,
  );

  clearRecallCache();
  const greedy = fakeReranker(Array.from({ length: 9 }, (_, i) => ({ id: LIB[i % LIB.length].id, why: `第${i}` })));
  const r2 = await recallMemories("心动", { list: LIB, rerank: greedy, limit: 12, now: NOW, candidateLimit: 20 });
  check(
    `模型回多少都砍到 ≤${RERANK_MAX_PICKS} 条（硬上限）`,
    greedy.log.lastCandidates && r2.items.filter((i) => i.matchedBy === "semantic").length <= RERANK_MAX_PICKS,
    `语义条数=${r2.items.filter((i) => i.matchedBy === "semantic").length}`,
  );

  clearRecallCache();
  const hallucinate = fakeReranker([{ id: "m-不存在的记忆", why: "编的" }, { id: "m-rain", why: "这个是真的" }]);
  const r3 = await recallMemories("心动", { list: LIB, rerank: hallucinate, limit: 5, now: NOW });
  check(
    "模型**编出来的 id 不上桌**（只在候选里的才算）",
    !r3.items.some((i) => i.memory.id === "m-不存在的记忆"),
    r3.items.map((i) => i.memory.id).join(","),
  );
}

/* ⑦b 候选全是真命中 → 不用花模型的钱 */
clearRecallCache();
{
  const onlyTags = [mk("t1", "只有这一条，标签就是心动。", ["心动"])];
  const rerank = fakeReranker([{ id: "t1", why: "不该被用到" }]);
  const r = await recallMemories("心动", { list: onlyTags, rerank, limit: 5, now: NOW });
  check(
    "候选全是真命中 → 语义那步标记 not-needed，**一次模型都没调**",
    rerank.log.calls === 0 && r.semantic === "not-needed" && r.items[0]?.matchedBy === "tag",
    `调用 ${rerank.log.calls} 次 · semantic=${r.semantic}`,
  );
}

/* ⑦c 调用方给口径（星屿插件就是这么用的）：真命中判定**不被重写** */
clearRecallCache();
{
  const rerank = fakeReranker([{ id: "m-rain", why: "下过雨的那种安静" }]);
  const r = await recallMemories("心动", {
    list: LIB,
    rerank,
    localHits: [{ id: "m-coffee", why: "标签命中「咖啡」" }],
    limit: 5,
    now: NOW,
  });
  const coffee = r.items.find((i) => i.memory.id === "m-coffee");
  check(
    "传了 `localHits` → 真命中口径**完全听调用方的**（内置字面口径不再插手）",
    coffee?.matchedBy === "tag" &&
      coffee.why === "标签命中「咖啡」" &&
      !r.items.some((i) => i.memory.id === "m-heart" && i.matchedBy === "tag"),
    `m-coffee=${coffee?.matchedBy}/${coffee?.why} · 顺序=${r.items.map((i) => `${i.memory.id}:${i.matchedBy}`).join(" ")}`,
  );
}

/* ⑧ 只读 */
check("只读：跑完这一串，夹具数组一个字节都没变", JSON.stringify(LIB) === FROZEN);

/* ══════════════════ 【二】反向验证 ══════════════════ */

console.log("\n【二】反向验证：把「能想起来」那一条**故意弄坏**，看检查会不会红");

/**
 * 同一组检查，喂两种假上游：
 *   · 好的（挑出那条意思像的）→ 必须**绿**
 *   · 坏的（什么都不挑）      → 必须**红**
 * 如果坏的也绿，说明这条检查根本没在验东西。
 */
async function keyCheck(rerank) {
  clearRecallCache();
  const r = await recallMemories("我心慌", { list: LIB, rerank, limit: 5, now: NOW });
  const hit = r.items.find((i) => i.memory.id === "m-flinch");
  return Boolean(hit) && hit.matchedBy === "semantic";
}

const goodRerank = fakeReranker([{ id: "m-flinch", why: "都是心里一紧那种发慌" }]);
const brokenRerank = fakeReranker([]); // ← "语义那步接错了"的样子：什么都不挑

const goodResult = await keyCheck(goodRerank);
const brokenResult = await keyCheck(brokenRerank);
check("（正常假上游）关键那条是**绿**的", goodResult === true);
check(
  "（把语义那步弄坏）关键那条**真的会红** —— 这条检查不是摆设",
  brokenResult === false,
  `broken=${brokenResult}（期望 false）`,
);
if (brokenResult) {
  console.log("   ⚠️ 反向验证失败：弄坏了它还绿，说明断言根本没接在真实行为上");
}

/* ══════════════════ 【三】真浏览器 ══════════════════ */

console.log("\n【三】真浏览器（390x844 · Edge · 只连 8080）");

const { chromium } = await import("playwright");
const errors = [];
const consoleErrors = [];
const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.on("pageerror", (e) => errors.push(e.stack || String(e)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const loc = m.location();
  const line = `${m.text()}  @ ${loc.url}:${loc.lineNumber}`;
  const thirdPartyNoise = /Failed to load resource/.test(line) && /@ https:\/\/(?!127\.0\.0\.1|localhost)/.test(line);
  consoleErrors.push(thirdPartyNoise ? `[已知噪音 · 无外网] ${line}` : line);
});

/**
 * **假上游装在页面里**（不是另起一个服务）：把发往 `…/chat/completions` 的 fetch
 * 换掉，返回一束 **SSE**（跟真上游同形状）。
 *
 * 它**真的去读请求里带的候选**，挑出内容含「心里一紧」的那条 —— 所以这个假上游
 * 同时证明了两件事：① 那条标签不命中的记忆**真的作为候选发出去了**；
 * ② 模型挑的东西**真的沿着链路回到了界面上那一行**。
 * 不起端口、不连外网、不花额度。
 */
await page.addInitScript(() => {
  window.__recallCalls = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!url.includes("/chat/completions")) return realFetch(input, init);
    let raw = "";
    try {
      raw = typeof init?.body === "string" ? init.body : "";
    } catch {
      /* ignore */
    }
    window.__recallCalls.push({ url, body: raw.slice(0, 4000) });
    let picks = [];
    try {
      const body = JSON.parse(raw);
      const msgs = body.assembledMessages ?? body.assembled ?? body.messages ?? [];
      const prompt = msgs.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
      // 只看模型真收到的候选行：`- <id> | <标签> | <内容>`
      for (const line of prompt.split("\n")) {
        const m = /^-\s*([^|\s]+)\s*\|/.exec(line.trim());
        if (m && line.includes("心里一紧")) picks.push({ id: m[1], why: "都指向那种心里发慌的紧张" });
      }
    } catch {
      /* ignore */
    }
    const text = JSON.stringify({ picks: picks.slice(0, 5) });
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
});

async function waitInteractive(p = page) {
  await p.waitForFunction(() => document.documentElement.dataset.theme !== undefined, { timeout: 60000 });
}

/** 往栖岛 store 播种：一条"标签不命中但语义相关"的记忆 + 一笔真上报的情绪（memoryQuery 是「心慌」）+ 假上游配置 */
async function seed() {
  await page.goto(BASE + "/play", { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitInteractive();
  await page.waitForTimeout(1200);
  const written = await page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("qidao-store", 1);
      r.onsuccess = () => res(r.result);
    });
    const raw = await new Promise((res) => {
      const tx = db.transaction("kv", "readonly");
      const g = tx.objectStore("kv").get("aster-app");
      g.onsuccess = () => res(g.result);
    });
    const parsed = JSON.parse(raw);
    const now = Date.now();
    parsed.state.memories = [
      {
        id: "m-flinch",
        kind: "profile",
        content: "上次那件让我心里一紧的事",
        source: "对话",
        confidence: 0.9,
        strength: 1,
        status: "active",
        // ⚠️ 标签里**没有**「心慌」「我」「慌」任何一个字 —— 标签口径绝对命不中
        tags: ["心动", "紧张"],
        links: [],
        recallCount: 1,
        createdAt: now - 5 * 86400000,
        updatedAt: now - 3600000,
      },
      {
        id: "m-coffee",
        kind: "preference",
        content: "喜欢喝美式，不加糖。",
        source: "对话",
        confidence: 0.9,
        strength: 1,
        status: "active",
        tags: ["咖啡"],
        links: [],
        recallCount: 1,
        createdAt: now - 2 * 86400000,
        updatedAt: now - 7200000,
      },
    ];
    parsed.state.emotionEvents = [
      {
        id: "ev-panic",
        at: now,
        primaryEmotion: "不安",
        secondaryEmotions: [],
        intensity: 0.8,
        confidence: 0.7,
        dimensions: { attraction: 0.2, longing: 0.3, shyness: 0.2, restraint: 0.4, warmth: 0.3, unease: 0.9 },
        suggestedMode: "daily",
        category: "tension",
        evidence: [{ quote: "我心慌" }],
        memoryQuery: { emotion: "心慌" },
        sourceType: "conversation_inference",
      },
    ];
    // 让直连那条路走我们这个"假上游"（页面里的 fetch 拦截会接住）
    parsed.state.settings = {
      ...(parsed.state.settings ?? {}),
      customBaseUrl: "https://fake-upstream.local/v1",
      customApiKey: "fake-key",
      upstreamModel: "fake-model",
    };
    await new Promise((res) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
      tx.oncomplete = res;
    });
    return {
      memories: (parsed.state.memories ?? []).length,
      events: (parsed.state.emotionEvents ?? []).length,
      settings: Boolean(parsed.state.settings?.customBaseUrl),
    };
  });
  console.log(`    [播种] 记忆 ${written.memories} 条 / 情绪 ${written.events} 笔 / 假上游配置 ${written.settings ? "已写" : "没写"}`);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await waitInteractive();
}

async function openDetail() {
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("canvas", { timeout: 60000 });
  await waitInteractive();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "详情" }).click();
  await page.waitForTimeout(1500);
  await page
    .waitForFunction(() => !document.body.innerText.includes("正在检索记忆"), { timeout: 30000 })
    .catch(() => undefined);
}

async function shot(name) {
  for (const dir of SHOT_DIRS) mkdirSync(dir, { recursive: true });
  const paths = SHOT_DIRS.map((dir) => resolve(dir, name));
  for (const p of paths) await page.screenshot({ path: p });
  return paths;
}

await seed();
await openDetail();

const calls = await page.evaluate(() => window.__recallCalls ?? []);
const bodyText = await page.evaluate(() => document.body.innerText || "");
const cards = await page.locator("[data-memory-id]").count();
const flinchCard = page.locator('[data-memory-id="m-flinch"]').first();
const flinchLine = (await flinchCard.count()) ? (await flinchCard.innerText()).split("\n")[0] : "";

check(
  "插件真的调了模型（`/chat/completions` 被发出去过）",
  calls.length >= 1,
  `发了 ${calls.length} 次`,
);
check(
  "而且**没有重复花钱**：界面几乎同时触发了好几次检索，在飞的那趟被共用（≤2 次）",
  calls.length <= 2,
  `发了 ${calls.length} 次（升级前这种重复是要按次付费的）`,
);
check(
  "⭐ 那条**标签不命中**的记忆（m-flinch）**真的作为候选发给模型了**",
  calls.some((c) => c.body.includes("m-flinch")),
  calls.length ? `第一次请求里含 m-flinch=${calls[0].body.includes("m-flinch")}` : "(没有请求)",
);
check(
  "⭐ 那一行说明**真的出现了**（记忆引用卡片 + 语义理由）",
  cards >= 1 && flinchLine.includes("语义相关") && flinchLine.includes("心里发慌"),
  `卡片 ${cards} 张 · 第一行「${flinchLine}」`,
);
check(
  "说明里点明了来源是**语义检索**（不是标签命中，没含糊）",
  bodyText.includes("后 1 条是语义检索找出来的"),
  (bodyText.match(/后 \d+ 条是语义检索找出来的[^\n]*/) ?? [""])[0],
);

/* 点开 → 就地展开（交互不变） */
const clickResult = await page.evaluate(() => {
  const btn = document.querySelector('[data-memory-id="m-flinch"] button[data-memory-toggle]');
  if (!btn) return "no-button";
  btn.click();
  return "clicked";
});
/**
 * ⚠️ 原来这里是一句 `waitForTimeout(900)` 就数展开块 —— **判定没变**，但它太脆：
 * 这一页（灵体面板）本来就在高频重渲染，一次 `.click()` 落了不一定当帧就反映到 DOM 上，
 * 900ms 不够时这里会红，而功能其实是好的（2026-10 实测：改成轮询后次次通过）。
 * 现在改成"**边等边补点**"：最多 6 秒，看到展开块就停；没看到就再点一次那一行。
 * （补点是防"第一次点击落在重渲染的空档里" —— 断言最后还是要求真的展开出 1 个块。）
 */
let opened = 0;
for (let i = 0; i < 20 && opened === 0; i += 1) {
  await page.waitForTimeout(300);
  opened = await page.locator('[data-memory-id="m-flinch"] [data-memory-open]').count();
  if (opened === 0) {
    await page.evaluate(() => {
      document.querySelector('[data-memory-id="m-flinch"] button[data-memory-toggle]')?.click();
    });
  }
}
const openText = await page.evaluate(() => document.body.innerText || "");
await page.evaluate(() => {
  document.querySelector("[data-memory-id]")?.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(400);
const shotPaths = await shot(SHOT_NAME);

check("点那一行 → **就地展开**（DOM 里真的多出展开块）", clickResult === "clicked" && opened === 1, `${clickResult} · 展开块 ${opened} 个`);
check("展开里有那条记忆的全文", openText.includes("上次那件让我心里一紧的事"));
check("展开里还是那套（形成时间 + 被想起次数）", /形成于\s*\d{4}/.test(openText) && openText.includes("被想起过"));

/* ── ③-b 这台设备**没配上游**时：一个请求都不发 ──────────────────────────
 *
 * 为什么这条必须验：没配上游时 `/api/chat` 回 503，而浏览器会往控制台记一条
 * **同源**的 "Failed to load resource: 503" —— 那条正好是
 * `verify-emotion-memory.mjs` 盯着的红线。更要紧的是：用户没配上游，
 * 我们就不该偷偷去花服务端那把 key。所以"不发请求"是**必须**的行为，不是优化。
 */
await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open("qidao-store", 1);
    r.onsuccess = () => res(r.result);
  });
  const raw = await new Promise((res) => {
    const tx = db.transaction("kv", "readonly");
    const g = tx.objectStore("kv").get("aster-app");
    g.onsuccess = () => res(g.result);
  });
  const parsed = JSON.parse(raw);
  parsed.state.settings = { ...(parsed.state.settings ?? {}), customBaseUrl: "", customApiKey: "", upstreamModel: "" };
  await new Promise((res) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
    tx.oncomplete = res;
  });
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
await waitInteractive();
await openDetail();
const callsNoUpstream = await page.evaluate(() => (window.__recallCalls ?? []).length);
const noUpstreamText = await page.evaluate(() => document.body.innerText || "");
check(
  "没配上游 → **一个 `/chat/completions` 都不发**（不偷偷花服务端那把 key，也不留 503 报错）",
  callsNoUpstream === 0,
  `发了 ${callsNoUpstream} 次`,
);
check(
  "没配上游 → 仍然诚实：没有就显示那句老文案（不硬连）",
  noUpstreamText.includes("暂无可关联的历史记忆"),
  (noUpstreamText.match(/暂无可关联[^\n]*/) ?? [""])[0],
);

await browser.close();

/* ───────────────────────────── 报告 ───────────────────────────── */

console.log("-".repeat(64));
console.log(`URL            ${PAGE_URL}`);
console.log(`那一行          「${flinchLine}」`);
console.log(`真调了模型      ${calls.length} 次（候选里含 m-flinch：${calls.some((c) => c.body.includes("m-flinch"))}）`);
console.log(`截图            ${shotPaths[0]}`);
if (consoleErrors.length) {
  console.log("console.error:");
  for (const line of consoleErrors.slice(0, 5)) console.log(`  ${line}`);
}
console.log("-".repeat(64));

check("没有 pageerror", errors.length === 0, errors.join("\n"));
check(
  "没有（非品牌脚本的）console.error",
  consoleErrors.filter((l) => !l.startsWith("[已知噪音")).length === 0,
  consoleErrors.slice(0, 2).join(" | "),
);
check(`截图落地了（两处各一份 = 2 个文件）：${SHOT_NAME}`, shotPaths.length === 2);

console.log("-".repeat(64));
console.log(
  bad === 0
    ? "✅ 全部通过：两段式召回（粗筛→现有模型精排→标签真命中置顶→失败退回粗筛并如实说→缓存→真的都无关仍是老文案）"
    : `❌ ${bad} 项不通过`,
);
process.exit(bad === 0 ? 0 : 1);
