/**
 * 验收（真浏览器）：**AI 上报的一笔真情绪，真的驱动了「星屿」插件**。
 *
 * 跑法：`node verify-emotion-real-data.mjs`（dev server 在 127.0.0.1:8080）
 *
 * 这条链子跟用户的要求一一对应：
 *   ① 空库 → 插件回落它自带的模拟场景（**不白屏**），截图 `emotion-fallback.png`
 *   ② 走**真上报入口**塞一笔情绪（`lib/actions.ts` 的 `emotion.report`，页内动态 import）
 *      —— 不是直接改 store 假装数据
 *   ③ 界面**当场跟着变**（主情绪标题 / 强度 / 画布颜色 / 标签），截图 `emotion-real.png`
 *   ④ 词表外的词当场被判无效（库里的条数不变）
 *   ⑤ quote > 40 字 / summary > 20 字在入库前就被截断
 *   ⑥ 顺带在真浏览器里对一遍手册：`emotionLexiconSection()` 有 13 组、
 *      每轮系统提示词（`buildManual()`）里**没有**词表正文
 *   ⑦ 没有 pageerror；画布非黑像素 > 1000
 *
 * 截图会写到两处（仓库惯例的 `../preview-shots` + 仓库内 `./preview-shots`）。
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

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
  // 无外网导致的第三方资源失败：跟这次改动无关，照 verify-emotion-plugin.mjs 的口径放行
  const thirdPartyNoise =
    /Failed to load resource/.test(line) && /@ https:\/\/(?!127\.0\.0\.1|localhost)/.test(line);
  consoleErrors.push(thirdPartyNoise ? `[已知噪音 · 无外网] ${line}` : line);
});

async function waitInteractive(p = page) {
  await p.waitForFunction(() => document.documentElement.dataset.theme !== undefined, { timeout: 60000 });
}

/** 数画布上的非黑像素 + 记一个"颜色指纹"（用来证明画面**真的**变了） */
async function canvasStats(selector = "canvas") {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const ctx = el.getContext("2d");
    if (!ctx) return { found: true, got2d: false };
    const { width, height } = el;
    const data = ctx.getImageData(0, 0, width, height).data;
    let nonBlack = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 24 || data[i + 1] > 24 || data[i + 2] > 24) {
        nonBlack++;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
    }
    const mean = nonBlack ? [Math.round(r / nonBlack), Math.round(g / nonBlack), Math.round(b / nonBlack)] : [0, 0, 0];
    return { found: true, got2d: true, width, height, nonBlack, mean };
  }, selector);
}

const rgb = (s) => `rgb(${(s.mean ?? []).join(",")})`;
const colorDistance = (a, b) =>
  Math.round(Math.hypot(a.mean[0] - b.mean[0], a.mean[1] - b.mean[1], a.mean[2] - b.mean[2]));

/** 把栖岛 store 里的情绪事件清空（模拟"空库"）*/
async function clearEmotionEvents() {
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
    parsed.state.emotionEvents = [];
    await new Promise((res) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
      tx.oncomplete = res;
    });
  });
}

/** 读库里的情绪事件（真的落到 IndexedDB 里才算数） */
async function readEmotionEvents() {
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
    return JSON.parse(raw).state.emotionEvents ?? [];
  });
}

/** 走**真上报入口**：页内动态 import `lib/actions.ts`（跟 AI 调工具时同一条路） */
async function reportEmotion(action) {
  return page.evaluate(async (a) => {
    const mod = await import("/src/lib/actions.ts");
    return await mod.runAction(a, { navigate: () => {} });
  }, action);
}

/* ────────────── ① 空库：回落模拟场景（不白屏）+ 截图 ────────────── */

await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
await waitInteractive();
await clearEmotionEvents();

await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("canvas", { timeout: 60000 });
await page.waitForTimeout(2600);

const fallbackCanvas = await canvasStats();
const fallbackText = await page.evaluate(() => document.body.innerText || "");
const fallbackTitle = await page.evaluate(
  () => document.querySelector("h2.font-display")?.innerText?.trim() ?? "",
);

for (const dir of SHOT_DIRS) {
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, "emotion-fallback.png") });
}

/* ────────────── ⑥ 手册（真浏览器里再对一遍） ────────────── */

const manualFacts = await page.evaluate(async () => {
  const man = await import("/src/lib/manual.ts");
  const section = man.emotionLexiconSection();
  const built = man.buildManual({
    permissions: { state_report: "allow" },
    titles: [{ id: "state_report", title: "给自己记一笔状态" }],
    displayName: "yan",
    aiName: "星芒",
  });
  return {
    groups: (section.match(/^[A-M]\. /gm) ?? []).length,
    hasTerms: ["怦然", "吃醋", "欲言又止", "恍然大悟"].every((t) => section.includes(t)),
    builtHasTerms: ["怦然", "吃醋", "欲言又止", "恍然大悟"].some((t) => built.includes(t)),
    builtHasPointer: built.includes("emotion.lexicon"),
    sectionLen: section.length,
    builtLen: built.length,
  };
});

/* ────────────── ④ 词表外的词：当场无效 ────────────── */

const before = await readEmotionEvents();
const badWord = await reportEmotion({ kind: "emotion.report", primaryEmotion: "天花板上的猫", intensity: 0.5 });
const afterBad = await readEmotionEvents();

/* ────────────── ⑤ 字数：quote / summary 入库前就截断 ────────────── */

const clipped = await reportEmotion({
  kind: "emotion.report",
  primaryEmotion: "心动",
  secondaryEmotions: ["羞涩", "天花板上的猫"],
  intensity: 0.82,
  confidence: 0.7,
  dimensions: { attraction: 0.9, shyness: 0.4, 天花板: 1 },
  suggestedMode: "flirtatious",
  category: "intimacy",
  evidence: [{ quote: "他".repeat(60), summary: "想".repeat(30) }],
  memoryQuery: { emotion: "心动", topic: "刚才那句" },
});
await page.waitForTimeout(600);
const stored = await readEmotionEvents();
const first = stored[0] ?? {};

/* ────────────── ③ 界面当场跟着变（不刷新）+ 真数据截图 ────────────── */

const realCanvas = await canvasStats();
const realText = await page.evaluate(() => document.body.innerText || "");
const realTitle = await page.evaluate(
  () => document.querySelector("h2.font-display")?.innerText?.trim() ?? "",
);
const realA11y = await page.evaluate(() => document.querySelector("p.sr-only")?.textContent?.trim() ?? "");

for (const dir of SHOT_DIRS) {
  await page.screenshot({ path: resolve(dir, "emotion-real.png") });
}

/* ────────────── ⑥b 按需取词表（真动作）+ 详情页的真依据 ────────────── */

const lexiconText = await reportEmotion({ kind: "emotion.lexicon" });
await page.getByRole("button", { name: "详情" }).click();
await page.waitForTimeout(500);
const detailText = await page.evaluate(() => document.body.innerText || "");
for (const dir of SHOT_DIRS) {
  await page.screenshot({ path: resolve(dir, "emotion-real-detail.png") });
}
await page.getByRole("button", { name: "状态", exact: true }).click();
await page.waitForTimeout(400);

/* ────────────── ② 第二笔：轨迹里两条都在（历史留得住） ────────────── */

const second = await reportEmotion({
  kind: "emotion.report",
  primaryEmotion: "吃醋",
  secondaryEmotions: ["不甘"],
  intensity: 0.74,
  confidence: 0.46,
  dimensions: { attraction: 0.4, unease: 0.58 },
  suggestedMode: "daily",
  category: "tension",
  evidence: [{ summary: "他今天回得慢" }],
});
await page.waitForTimeout(800);
const afterSecond = await readEmotionEvents();
const secondTitle = await page.evaluate(
  () => document.querySelector("h2.font-display")?.innerText?.trim() ?? "",
);

/* ────────────── 刷新一遍：真数据真的存下来了（不是只活在内存里） ────────────── */

await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("canvas", { timeout: 60000 });
await page.waitForTimeout(2200);
const reloadTitle = await page.evaluate(
  () => document.querySelector("h2.font-display")?.innerText?.trim() ?? "",
);
const reloadText = await page.evaluate(() => document.body.innerText || "");

await browser.close();

/* ────────────────────────────── 报告 ────────────────────────────── */

console.log(`URL            ${PAGE_URL}`);
console.log(`回落（空库）    标题「${fallbackTitle}」 · 画布 ${JSON.stringify(fallbackCanvas)}`);
console.log(`真数据          标题「${realTitle}」 · 画布 ${JSON.stringify(realCanvas)}`);
console.log(`无障碍播报      ${realA11y}`);
console.log(`上报回执        无效词：「${badWord}」`);
console.log(`上报回执        第一笔：「${clipped}」`);
console.log(`上报回执        第二笔：「${second}」`);
console.log(`库里条数        改动前 ${before.length} → 无效词后 ${afterBad.length} → 第一笔后 ${stored.length} → 第二笔后 ${afterSecond.length}`);
console.log(`入库的 quote    ${JSON.stringify(first.evidence?.[0]?.quote ?? "")}（${Array.from(first.evidence?.[0]?.quote ?? "").length} 字）`);
console.log(`入库的次情绪    ${JSON.stringify(first.secondaryEmotions ?? [])}`);
console.log(`手册            那一节 ${manualFacts.sectionLen} 字符 / 提示词 ${manualFacts.builtLen} 字符`);
console.log(`截图            ${SHOT_DIRS.map((d) => `${d}\\emotion-{fallback,real}.png`).join("  +  ")}`);
if (consoleErrors.length) {
  console.log("console.error:");
  for (const line of consoleErrors.slice(0, 5)) console.log(`  ${line}`);
}

console.log("-".repeat(64));
check("没有 pageerror", errors.length === 0, errors.join("\n"));
check(
  "没有（非品牌脚本的）console.error",
  consoleErrors.filter((l) => !l.startsWith("[已知噪音")).length === 0,
);
check("空库也能画出来（画布非黑像素 > 1000，不是白屏）", (fallbackCanvas.nonBlack ?? 0) > 1000, `nonBlack=${fallbackCanvas.nonBlack}`);
check(
  "空库时显示的是插件自带的模拟场景",
  fallbackText.includes("模拟数据") && fallbackText.includes("演示流程"),
  `标题「${fallbackTitle}」`,
);
check(
  "手册那一节有 13 组 + 真词（在真浏览器里再对一遍）",
  manualFacts.groups === 13 && manualFacts.hasTerms,
  `组数 ${manualFacts.groups}`,
);
check(
  "每轮系统提示词里没有词表正文、但有怎么取的指引",
  manualFacts.builtHasTerms === false && manualFacts.builtHasPointer,
);
check(
  "词表外的词被判无效（库里的条数没变）",
  String(badWord).includes("不在情绪词表里") && afterBad.length === before.length,
  `${before.length} → ${afterBad.length}`,
);
check("表里的词上报成功（库里真的多了一条）", stored.length === before.length + 1, `现在 ${stored.length} 条`);
check(
  "quote 60 字 → 入库时 ≤40 字；summary 与 quote 并存时以 quote 为准",
  Array.from(first.evidence?.[0]?.quote ?? "").length <= 40 &&
    Array.from(first.evidence?.[0]?.quote ?? "").length > 0 &&
    first.evidence?.length === 1,
  `${Array.from(first.evidence?.[0]?.quote ?? "").length} 字`,
);
check(
  "次情绪 0~2 个、表外的丢掉（报了 羞涩 + 天花板上的猫 → 只留 羞涩）",
  JSON.stringify(first.secondaryEmotions) === JSON.stringify(["羞涩"]),
  JSON.stringify(first.secondaryEmotions),
);
check(
  "维度只留已知的六个键（天花板 那个键被丢掉）",
  first.dimensions && !("天花板" in first.dimensions) && first.dimensions.attraction === 0.9,
);
check(
  "界面**当场**跟着变：主情绪标题从模拟场景变成真上报的那一笔",
  realTitle === "心动 · 羞涩" && fallbackTitle !== realTitle,
  `「${fallbackTitle}」→「${realTitle}」`,
);
check(
  "强度/置信度按上报显示（无障碍播报里能看到）",
  realA11y.includes("心动") && realA11y.includes("82") && realA11y.includes("70"),
  realA11y,
);
check(
  "标签从「模拟数据」变成「他自己上报的」",
  realText.includes("他自己上报的") && realText.includes("真实上报"),
);
check(
  "画布颜色真的换了（不是只换文字）",
  colorDistance(fallbackCanvas, realCanvas) > 4,
  `${rgb(fallbackCanvas)} → ${rgb(realCanvas)}（距离 ${colorDistance(fallbackCanvas, realCanvas)}）`,
);
check("真数据下画布照旧有内容（> 1000）", (realCanvas.nonBlack ?? 0) > 1000, `nonBlack=${realCanvas.nonBlack}`);
check(
  "详情页显示的是**他真引的那一句**（不是模拟对话片段）",
  detailText.includes("他引的那一句") && detailText.includes("他他他"),
  detailText.includes("模拟对话片段") ? "还在标模拟" : "",
);
check(
  "按需取词表（emotion.lexicon 真动作）→ 13 组一次给全",
  (lexiconText.match(/^[A-M]\. /gm) ?? []).length === 13 &&
    ["怦然", "吃醋", "欲言又止"].every((t) => lexiconText.includes(t)),
  `${(lexiconText.match(/^[A-M]\. /gm) ?? []).length} 组 · ${lexiconText.length} 字符`,
);
check(
  "第二笔接得上（轨迹留得住历史），而且镜头跟到最新那笔",
  afterSecond.length === before.length + 2 && secondTitle === "吃醋 · 不甘",
  `库里 ${afterSecond.length} 条 · 标题「${secondTitle}」`,
);
check(
  "刷新之后真数据还在（真的存下来了：IndexedDB + 插件按 id 找回那一条）",
  reloadTitle === "吃醋 · 不甘" && reloadText.includes("真实上报"),
  `刷新后标题「${reloadTitle}」`,
);

console.log("-".repeat(64));
console.log(bad === 0 ? "✅ 全部通过：真数据驱动插件，空库回落模拟" : `❌ ${bad} 项不通过`);
process.exit(bad === 0 ? 0 : 1);
