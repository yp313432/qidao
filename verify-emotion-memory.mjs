/**
 * 验收：**「星屿」的记忆检索接上了栖岛真记忆**。
 *
 * 跑法：`node verify-emotion-memory.mjs`（dev server 在 127.0.0.1:8080）
 *
 * 这条链子跟用户的要求一一对应：
 *   ① 纯 node 断言（不起浏览器）：`searchQidaoMemories()` 的口径 ——
 *      **标签真命中才算**、没命中就空数组 + 「暂无可关联的历史记忆。」、
 *      `links` 只有 `retrieved_for_query` 且 `explanation` 说清为什么连上、
 *      真实连线（`links`）能补一层、归档的不上桌、`isDemoData === false`
 *   ② 真浏览器（390x844，Edge）：往栖岛 store / IndexedDB 播种**带标签**的记忆，
 *      详情面板里**真的连上了那一行说明**（截图）
 *   ③ 点那一行 → **就地展开**（全文 + 形成时间 + 被想起次数 + 去记忆宇宙的路）
 *   ④ 只播种**标签不命中**的记忆 → 诚实显示「暂无可关联的历史记忆。」（不硬连）
 *   ⑤ 检索前后**库里的记忆条数不变**（适配器只读，绝不写回）
 *
 * 截图写到两处（仓库惯例的 `../preview-shots` + 仓库内 `./preview-shots`）：
 *   · `memory-linked.png`      连上了（折叠：一行说明）
 *   · `memory-linked-open.png` 点开了（全文 / 时间 / 次数）
 *   · `memory-none.png`        没命中（诚实显示）
 *
 * ⚠️ 只连已经在跑的 8080，**不占别的端口**（不碰 verify-tool-native.mjs 那套）。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * ① 先要能直接 import 那个 `.ts`（Node 的类型擦除）。
 * 没带 flag 就自己再跑一遍带 flag 的 —— 保证 `node verify-emotion-memory.mjs`
 * 这一条命令就能跑完，不用记参数。
 */
if (!process.execArgv.includes("--experimental-strip-types")) {
  const self = fileURLToPath(import.meta.url);
  const child = spawnSync(process.execPath, ["--experimental-strip-types", self, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(child.status ?? 1);
}

const { chromium } = await import("playwright");
const { mkdirSync, readFileSync } = await import("node:fs");
const { resolve } = await import("node:path");

const BASE = "http://127.0.0.1:8080";
const PAGE_URL = `${BASE}/play/plugins/emotion`;
const SHOT_DIRS = [
  resolve(process.cwd(), "..", "preview-shots"),
  resolve(process.cwd(), "preview-shots"),
];

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ══════════════════ ① 纯 node 断言：口径（不起浏览器）══════════════════ */

console.log("【一】适配器口径（pure node + 真 import 那个 .ts）");

/** 每次都拿一份**干净**的模块（不然上一次的 setMemorySource 会串台） */
let nonce = 0;
async function loadAdapter() {
  nonce += 1;
  return import(`./src/plugins/emotion-lifeform/lib/memory/qidao-adapter.ts?v=${nonce}`);
}

const adapterSrc = readFileSync(resolve("src/plugins/emotion-lifeform/lib/memory/qidao-adapter.ts"), "utf8");
check(
  "适配器里**没有**任何 store 写方法（只读：没有 addMemory / updateMemory / reinforce / archive）",
  !/addMemory|updateMemory|archiveMemory|deleteMemory|reinforceMemory|confirmMemory|setState\s*\(/.test(adapterSrc),
);

const A = await loadAdapter();
const { searchQidaoMemories, hasRealMemories, setMemorySource, qidaoMemoryAdapter, EMPTY_RELATION_NOTE } = A;

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
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
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

const library = [
  mk("m-heart", "被人记住一个很小的习惯时，会有一点说不清的心动。", ["心动", "想被珍惜"], {
    recallCount: 3,
    createdAt: NOW - 4 * 86400000,
    links: ["m-linked"],
  }),
  mk("m-linked", "上周一起听雨的那个晚上，没有被催促，所以很安心。", ["安心"], {
    recallCount: 1,
    createdAt: NOW - 6 * 86400000,
  }),
  mk("m-other", "喜欢喝美式，不加糖。", ["咖啡"]),
  mk("m-archived", "已收起来的一条（归档的不该出现）。", ["心动"], { status: "archived", links: ["m-heart"] }),
];

const frozenBefore = JSON.stringify(library);
const hit = searchQidaoMemories(library, { emotion: "心动" }).result;

check(
  "命中：只返回标签真命中的那一条（+ 沿真连线补的一条）",
  hit.memories.length === 2,
  `返回 ${hit.memories.length} 条：${hit.memories.map((m) => m.id).join(", ")}`,
);
check("命中：标签不命中的记忆**不出现**（没瞎连）", !hit.memories.some((m) => m.id === "m-other"));
check("命中：归档的那条不上桌", !hit.memories.some((m) => m.id === "m-archived"));
check(
  "命中：explanation 说明**为什么连上**（标签命中「心动」）",
  String(hit.links.find((l) => l.memoryId === "m-heart")?.explanation).includes("标签命中「心动」"),
  hit.links.find((l) => l.memoryId === "m-heart")?.explanation ?? "(没有这条 link)",
);
check(
  "命中：沿栖岛自己的连线补上来的那条也写清了依据",
  String(hit.links.find((l) => l.memoryId === "m-linked")?.explanation).includes("图谱里连着"),
  hit.links.find((l) => l.memoryId === "m-linked")?.explanation ?? "(没有这条 link)",
);
check("命中：links.kind 只有 retrieved_for_query", hit.links.every((l) => l.kind === "retrieved_for_query"));
check(
  "命中：links 和 memories 一一对应",
  hit.links.length === hit.memories.length && hit.memories.every((m) => hit.links.some((l) => l.memoryId === m.id)),
);
check("命中：isDemoData === false（真数据）", hit.isDemoData === false && hit.memories.every((m) => m.isDemoData === false));
check(
  "命中：record 字段映射齐（title / summary / sourceLabel / createdAt / tags）",
  (() => {
    const m = hit.memories[0];
    return (
      typeof m.title === "string" &&
      m.title.length > 0 &&
      [...m.title].length <= 15 &&
      m.summary.includes("心动") &&
      m.sourceLabel === "对话" &&
      !Number.isNaN(Date.parse(m.createdAt)) &&
      Array.isArray(m.tags) &&
      m.tags.length > 0
    );
  })(),
  JSON.stringify({ title: hit.memories[0].title, sourceLabel: hit.memories[0].sourceLabel, createdAt: hit.memories[0].createdAt }),
);
check("命中：展开要用的 recallCount 也在", hit.memories.find((m) => m.id === "m-heart")?.recallCount === 3);

const miss = searchQidaoMemories(library, { emotion: "恼怒" }).result;
check(
  "没命中：空数组 + 「暂无可关联的历史记忆。」（不硬连）",
  miss.memories.length === 0 && miss.links.length === 0 && miss.relationNote === EMPTY_RELATION_NOTE,
  `note="${miss.relationNote}"`,
);
check("没命中：isDemoData 还是 false（真库、真没命中，不是模拟）", miss.isDemoData === false);
check("空查询（情绪和主题都空）→ 什么都不返回", searchQidaoMemories(library, {}).result.memories.length === 0);

const topicHit = searchQidaoMemories(library, { topic: "咖啡" }).result;
check(
  "主题真命中标签（`咖啡` 命中标签 `咖啡`）才算数",
  topicHit.memories.some((m) => m.id === "m-other") && String(topicHit.links[0]?.explanation).includes("主题命中「咖啡」"),
  topicHit.links[0]?.explanation ?? "(空)",
);
const contentOnly = searchQidaoMemories([mk("m-text", "今天有点心动，说不清为什么。", ["天气"])], { emotion: "心动" }).result;
check("正文里恰好出现那几个字**不算**命中（宁可少连）", contentOnly.memories.length === 0, `返回 ${contentOnly.memories.length} 条`);
check("单字标签：一模一样才算（主题 `累` 命中标签 `累`）", searchQidaoMemories([mk("m-1char", "标签只有一个字。", ["累"])], { topic: "累" }).result.memories.length === 1);
check(
  "单字查询词不去蹭长标签（`累` 不命中 `很累很累`）",
  searchQidaoMemories([mk("m-1char2", "标签是一个长词。", ["很累很累"])], { topic: "累" }).result.memories.length === 0,
);
check("只读：检索两次，传进去的数组一个字节都没变", JSON.stringify(library) === frozenBefore);

const B = await loadAdapter();
check("还没接来源时：QidaoMemoryAdapter 检索是空的（不硬编）", (await B.qidaoMemoryAdapter.search({ emotion: "心动" })).memories.length === 0);
let pushed = 0;
const unsubscribe = B.subscribeMemorySource(() => {
  pushed += 1;
});
B.setMemorySource(() => library);
const viaBinding = await B.qidaoMemoryAdapter.search({ emotion: "心动" });
check("接上来源之后：hasRealMemories() === true", B.hasRealMemories() === true);
check("接上来源之后：真的能搜到那一条", viaBinding.memories.some((m) => m.id === "m-heart"), `返回 ${viaBinding.memories.length} 条`);
check("记忆一变就吹哨（界面靠它重新检索）", pushed >= 1, `收到 ${pushed} 次`);
unsubscribe();
const pushedAtUnsub = pushed;
B.setMemorySource(() => library);
check("退订之后不再吹哨", pushed === pushedAtUnsub);
B.setMemorySource(null);
check("来源撤掉之后：hasRealMemories() 回到 false", B.hasRealMemories() === false);
check(
  "适配器名字 + 接口形状（search / hasRealMemories）",
  qidaoMemoryAdapter.name === "QidaoMemoryAdapter" &&
    typeof qidaoMemoryAdapter.search === "function" &&
    typeof hasRealMemories === "function",
);

/* ══════════════════ ② 真浏览器 ══════════════════ */

console.log("\n【二】真浏览器（390x844 · Edge）");

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

async function waitInteractive(p = page) {
  await p.waitForFunction(() => document.documentElement.dataset.theme !== undefined, { timeout: 60000 });
}

/**
 * 往栖岛 store 里**播种**：记忆 +（可选）一笔真上报的情绪事件。
 *
 * 顺序照 `verify-plugin-area.mjs` / `verify-summary.mjs` 那套（踩过才定下来的）：
 * **goto 进来 → 写库 → reload**（store 持久化是异步的，不 reload 页面内存里还是旧快照）。
 *
 * ⚠️ 为什么还要塞情绪事件（第一版就是栽在这）：插件默认停在第一个**模拟场景**
 * 「平静」（它的 `memoryQuery` 是「从容」）—— 我们的记忆标签是「心动」，
 * 那当然不命中。要验"真的连上了"，就得让插件正在看的那一笔情绪**本来就带
 * `memoryQuery: { emotion: "心动" }`** —— 也就是走真上报那条链，而不是去改插件。
 */
async function seedMemories(list, label, emotionEvent = null) {
  await page.goto(BASE + "/play", { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitInteractive();
  await page.waitForTimeout(1200);
  const written = await page.evaluate(
    async ({ memories, event }) => {
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
      parsed.state.memories = memories.map((m, i) => ({
        id: m.id,
        kind: m.kind ?? "preference",
        content: m.content,
        source: m.source ?? "对话",
        confidence: 0.9,
        strength: 1,
        status: m.status ?? "active",
        tags: m.tags,
        links: m.links ?? [],
        recallCount: m.recallCount ?? 0,
        createdAt: now - (i + 1) * 86400000,
        updatedAt: now - 3600000,
        lastRecalledAt: now - 1800000,
        ...(m.at ? { at: m.at } : {}),
      }));
      if (event) {
        parsed.state.emotionEvents = [
          {
            id: event.id,
            at: now,
            primaryEmotion: event.primaryEmotion,
            secondaryEmotions: event.secondaryEmotions ?? [],
            intensity: event.intensity ?? 0.82,
            confidence: event.confidence ?? 0.7,
            dimensions: { attraction: 0.9, longing: 0.4, shyness: 0.5, restraint: 0.3, warmth: 0.6, unease: 0.2 },
            suggestedMode: event.suggestedMode ?? "flirtatious",
            category: event.category ?? "intimacy",
            evidence: [{ quote: "你刚才那句，我看了两遍" }],
            memoryQuery: event.memoryQuery,
            sourceType: "conversation_inference",
          },
        ];
      } else {
        parsed.state.emotionEvents = [];
      }
      await new Promise((res) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
        tx.oncomplete = res;
      });
      return { memories: (parsed.state.memories ?? []).length, events: (parsed.state.emotionEvents ?? []).length };
    },
    { memories: list, event: emotionEvent },
  );
  console.log(`    [播种·${label}] 写进库 ${written.memories} 条记忆 / ${written.events} 笔情绪事件`);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await waitInteractive();
}

/** 读库里的记忆（证明"没写回"用） */
async function readMemories() {
  return page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("qidao-store", 1);
      r.onsuccess = () => res(r.result);
    });
    const raw = await new Promise((res) => {
      const tx = db.transaction("kv", "readonly");
      const g = tx.objectStore("kv").get("aster-app");
      g.onsuccess = () => res(g.result);
    });
    return JSON.parse(raw).state.memories ?? [];
  });
}

async function canvasStats(selector = "canvas") {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const ctx = el.getContext("2d");
    if (!ctx) return { found: true, got2d: false };
    const { width, height } = el;
    const data = ctx.getImageData(0, 0, width, height).data;
    let nonBlack = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 24 || data[i + 1] > 24 || data[i + 2] > 24) nonBlack++;
    }
    return { found: true, got2d: true, width, height, nonBlack };
  }, selector);
}

/** 把「记忆引用」那一栏滚进视野 —— 截图要看得见那一行才算证据 */
async function scrollMemoryIntoView() {
  await page.evaluate(() => {
    document.querySelector("[data-memory-id]")?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(400);
}

async function shot(name) {
  const paths = SHOT_DIRS.map((dir) => resolve(dir, name));
  for (const dir of SHOT_DIRS) mkdirSync(dir, { recursive: true });
  for (const p of paths) await page.screenshot({ path: p });
  return paths;
}

/**
 * 点那一行 → 就地展开。
 *
 * ⚠️ 这里用 DOM 的 `btn.click()`，不用 Playwright 的 `locator.click()`：
 * 插件那块面板在自己的滚动容器里（外加 `.emotion-lifeform` 的 `contain: paint`），
 * Playwright 的"先滚进视野再点"在这套嵌套布局上会点空（试过几版都是 clicking
 * 成功但 React 没收到）—— 而这次要验的是**点了会不会展开**，不是鼠标轨迹。
 */
async function clickMemoryToggle(id) {
  return page.evaluate((memoryId) => {
    const btn = document.querySelector(`[data-memory-id="${memoryId}"] button[data-memory-toggle]`);
    if (!btn) return "no-button";
    btn.click();
    return "clicked";
  }, id);
}

/** 打开「详情」面板（记忆引用就在那一栏），并等那一栏真的算完 */
async function openDetail() {
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("canvas", { timeout: 60000 });
  await waitInteractive();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "详情" }).click();
  await page.waitForTimeout(1500);
  // 等"正在检索记忆…"消失 —— 不然读到的可能是没算完的那一帧
  await page
    .waitForFunction(() => !document.body.innerText.includes("正在检索记忆"), { timeout: 30000 })
    .catch(() => undefined);
}

/* ── ②-1 带标签的记忆（`心动` 命中）→ 真的连上 ───────────────────────── */

await seedMemories(
  [
    {
      id: "m-heart",
      content: "被人记住一个很小的习惯时，会有一点说不清的心动。",
      tags: ["心动", "想被珍惜"],
      recallCount: 3,
      links: ["m-linked"],
    },
    { id: "m-linked", content: "上周一起听雨的那个晚上，没有被催促，所以很安心。", tags: ["安心"], recallCount: 1 },
    { id: "m-other", content: "喜欢喝美式，不加糖。", tags: ["咖啡"] },
    { id: "m-archived", content: "已经收起来的一条，不该出现在引用里。", tags: ["心动"], status: "archived" },
  ],
  "有命中",
  { id: "ev-heart", primaryEmotion: "心动", secondaryEmotions: ["羞涩"], memoryQuery: { emotion: "心动" } },
);

const dbBefore = await readMemories();
await openDetail();
const linkedText = await page.evaluate(() => document.body.innerText || "");
const cards = await page.locator("[data-memory-id]").count();
const heartLine = (await page.locator('[data-memory-id="m-heart"]').first().innerText()).split("\n")[0] ?? "";
const linkHrefs = await page.locator("[data-memory-id] a").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
await scrollMemoryIntoView();
const linkedPaths = await shot("memory-linked.png");
const linkedCanvas = await canvasStats();

check("详情面板里**真的出现了**那一行说明（连上了）", cards >= 1 && linkedText.includes("心动"), `卡片 ${cards} 张 · 说明「${heartLine}」`);
check("插件看的确实是那笔真上报的「心动」（不是第一个模拟场景）", linkedText.includes("他自己上报的"), "");
check("那一行写清了为什么连上（标签命中「心动」）", String(heartLine).includes("标签命中「心动」"), String(heartLine));
check(
  "标签不命中的记忆（咖啡）**没有**被连上（不硬连）",
  !linkedText.includes("喜欢喝美式"),
  linkedText.includes("喜欢喝美式") ? "美式那条出现了" : "没出现",
);
check("归档的那条没有上桌", !linkedText.includes("已经收起来的一条"));
check("展开前只有一行：记忆全文**还没渲染**（点了才渲染）", !linkedText.includes("说不清为什么"));
check("连接说明是老实话（这几条是他记忆里真有的）", linkedText.includes("这几条是他记忆里真有的"));

/* ── ③ 点那一行 → 当场展开 ─────────────────────────────────────────── */

const clickResult = await clickMemoryToggle("m-heart");
await page.waitForTimeout(900);
const openText = await page.evaluate(() => document.body.innerText || "");
const opened = await page.locator('[data-memory-id="m-heart"] [data-memory-open]').count();
const universeLink = await page.locator('[data-memory-open] a').first().getAttribute("href");
await scrollMemoryIntoView();
const openPaths = await shot("memory-linked-open.png");

check("点一下就就地展开（DOM 里真的多出展开块）", clickResult === "clicked" && opened === 1, `${clickResult} · 展开块 ${opened} 个`);
check("展开里有记忆全文", openText.includes("有一点说不清的心动"));
check("展开里有形成时间", /形成于\s*\d{4}/.test(openText), (openText.match(/形成于[^\n]*/) ?? [""])[0]);
check("展开里有被想起次数（recallCount = 3）", openText.includes("被想起过 3 次"));
check(
  "展开里有去记忆宇宙的入口（/play/plugins/memory）",
  openText.includes("在记忆宇宙里看") && String(universeLink).includes("/play/plugins/memory"),
  `href=${universeLink}`,
);
check("（折叠时没渲染过任何链接，展开才有）", linkHrefs.length === 0, `折叠时链接 ${linkHrefs.length} 个`);

const dbAfter = await readMemories();
check("检索 / 展开**没有写回记忆**（库里条数不变）", dbAfter.length === dbBefore.length, `${dbBefore.length} → ${dbAfter.length}`);

/* ── ④ 只播种标签不命中的记忆 → 诚实显示「暂无可关联」─────────────── */

await seedMemories(
  [
    { id: "n-coffee", content: "喜欢喝美式，不加糖。", tags: ["咖啡", "口味"], recallCount: 2 },
    { id: "n-cat", content: "养了一只猫，叫团子。", tags: ["猫", "宠物"] },
  ],
  "无命中",
  { id: "ev-angry", primaryEmotion: "恼怒", secondaryEmotions: [], memoryQuery: { emotion: "恼怒" } },
);

const dbBeforeNone = await readMemories();
await openDetail();
const noneText = await page.evaluate(() => document.body.innerText || "");
const noneCards = await page.locator("[data-memory-id]").count();
await page.evaluate(() => {
  const paras = [...document.querySelectorAll("p")];
  paras.find((p) => p.textContent?.includes("暂无可关联"))?.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(400);
const nonePaths = await shot("memory-none.png");

check("标签不命中时不硬连：一张记忆卡都没有", noneCards === 0, `卡片 ${noneCards} 张`);
check(
  "诚实显示「暂无可关联的历史记忆。」",
  noneText.includes("暂无可关联的历史记忆"),
  (noneText.match(/暂无可关联[^\n]*/) ?? [""])[0],
);
check("也没把不命中的记忆偷偷列出来", !noneText.includes("团子") && !noneText.includes("美式"));

const dbAfterNone = await readMemories();
check("这一轮也没写回（库里条数不变）", dbAfterNone.length === dbBeforeNone.length, `${dbBeforeNone.length} → ${dbAfterNone.length}`);

await browser.close();

/* ══════════════════ 报告 ══════════════════ */

console.log("-".repeat(64));
console.log(`URL            ${PAGE_URL}`);
console.log(`连上那一行      「${heartLine}」`);
console.log(`截图            连上 ${linkedPaths[0]}`);
console.log(`                展开 ${openPaths[0]}`);
console.log(`                没命中 ${nonePaths[0]}`);
console.log(`画布            nonBlack=${linkedCanvas.nonBlack}`);
if (consoleErrors.length) {
  console.log("console.error:");
  for (const line of consoleErrors.slice(0, 5)) console.log(`  ${line}`);
}
console.log("-".repeat(64));

check("没有 pageerror", errors.length === 0, errors.join("\n"));
check("没有（非品牌脚本的）console.error", consoleErrors.filter((l) => !l.startsWith("[已知噪音")).length === 0);
check("画布非黑像素 > 1000（不是白屏）", (linkedCanvas.nonBlack ?? 0) > 1000, `nonBlack=${linkedCanvas.nonBlack}`);
check("三张截图都落地了（两处各一份 = 6 个文件）", [...linkedPaths, ...openPaths, ...nonePaths].length === 6);

console.log("-".repeat(64));
console.log(bad === 0 ? "✅ 全部通过：记忆检索走栖岛真记忆（标签真命中才连 / 没命中不硬连 / 不写回）" : `❌ ${bad} 项不通过`);
process.exit(bad === 0 ? 0 : 1);
