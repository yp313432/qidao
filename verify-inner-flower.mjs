/**
 * 验收脚本：「内在」改版（折线 → 花瓣图，3 个维度 → 11 个稀疏维度）。
 *
 * 用户在两张图之后提的要求：
 *   "把可视化改成下面那个圆那个圆的扇形的那种，而不是折线的那种"
 *   "情绪可以多种不只是这几个太单调了"
 *
 * 要证明的：
 *   ① **词表一致性**：`state-dims.ts` 里的每个词都出现在提示词里
 *      （他报的词必须是我们认识的原词，改名字忘了改提示词 = 花瓣永远长不出来）
 *   ② **纯逻辑**：dimsOf 认得稀疏上报；**老存档**（只有 energy/missing/curious）
 *      照样能画；不认识的词丢掉；averageDims 不把"没记录"当 0
 *   ③ **界面**：11 瓣 + 11 个标签 + 花心写着最明显那瓣的名字和数值
 *   ④ **心情词表就是这 11 个词**（用户："ai 的心情描述还是那六个吗，太少了……
 *      直接改成图上的这十一个吧"）：心情和花瓣共用一张表；旧词/旧 id 有别名归位；
 *      老存档的 mood（"calm" 这种）在界面上**不空白**
 *   ⑤ 没有 hydration 不一致 + 截图
 *
 * 跑法：node verify-inner-flower.mjs （要 dev server 在 8080）
 */
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const WORK = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";
mkdirSync(WORK, { recursive: true });

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ── ① 词表一致性（读源码，不用浏览器）── */
const dimsSrc = readFileSync("src/lib/state-dims.ts", "utf8");
const promptSrc = readFileSync("src/lib/prompt.ts", "utf8");
const actionsSrc = readFileSync("src/lib/actions.ts", "utf8");
const labels = [...dimsSrc.matchAll(/\{ id: "[a-z]+", label: "([^"]+)"/g)].map((m) => m[1]);
check("① 词表里读到 11 个词", labels.length === 11, labels.join("、"));
const missing = labels.filter((l) => !promptSrc.includes(l));
check("① 词表里的词全都写进了提示词（改名字忘改提示词就会挂在这）", missing.length === 0, missing.join("、") || "齐了");

/* ── 浏览器 ── */
const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);

/* 种三笔：老格式 / 新稀疏 / 新的心情 id */
const now = Date.now();
await page.evaluate(
  async ([nowMs]) => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("qidao-store", 1);
      r.onsuccess = () => res(r.result);
    });
    const raw = await new Promise((res) => {
      const tx = db.transaction("kv", "readonly");
      const g = tx.objectStore("kv").get("aster-app");
      g.onsuccess = () => res(g.result);
    });
    const p = JSON.parse(raw);
    p.state.stateSamples = [
      // 老存档：只有三个顶层字段（这次改版必须还能读）
      { id: "s1", at: nowMs - 3 * 86400000, mood: "miss", energy: 0.7, missing: 0.35, curious: 0.6 },
      // 新稀疏：只报了一瓣，而且很小 —— 正是参考图那个样子。
      // mood 故意用**老 id**（"calm"）：界面上必须兜成中文，不能空白。
      {
        id: "s2",
        at: nowMs - 3600000,
        mood: "calm",
        energy: 0,
        missing: 0,
        curious: 0,
        dims: { 心动: 0.08, 想念: 0.72, 牵挂: 0.4, 无聊: 0.55 },
        note: "他 MCP 接通了，心情轻松",
      },
      // 新心情 id（crush = 心动）：证明心情已经用上新词表
      { id: "s3", at: nowMs - 7200000, mood: "crush", energy: 0.5, missing: 0.3, curious: 0.4, dims: { 心动: 0.66 } },
    ];
    await new Promise((res) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(p), "aster-app");
      tx.oncomplete = res;
    });
  },
  [now],
);

/* ② 纯逻辑 */
const logic = await page.evaluate(async () => {
  const { dimsOf, averageDims, strongest, DIMS, normalizeDimKey, moodDisplay } = await import(
    "/src/lib/state-dims.ts"
  );
  const sparse = dimsOf({ dims: { 心动: 0.08 } });
  const legacy = dimsOf({ energy: 0.7, missing: 0.2, curious: 0.7 });
  const unknown = dimsOf({ dims: { 惆怅: 0.9, 心动: 0.5 } });
  const avg = averageDims([{ energy: 1, missing: 0, curious: 0 }, { energy: 0, missing: 1, curious: 0 }]);
  const top = strongest(sparse);
  // 旧词别名表：老存档 / 旧提示词里的词都要认得（改了名字也不能丢数据）
  const aliases = {
    偏爱: normalizeDimKey("偏爱"),
    野心: normalizeDimKey("野心"),
    精神: normalizeDimKey("精神"),
    心动: normalizeDimKey("心动"),
    calm: normalizeDimKey("calm"),
    joy: normalizeDimKey("joy"),
    focus: normalizeDimKey("focus"),
    low: normalizeDimKey("low"),
    miss: normalizeDimKey("miss"),
    spark: normalizeDimKey("spark"),
    fond: normalizeDimKey("fond"),
    ambition: normalizeDimKey("ambition"),
    energy: normalizeDimKey("energy"),
  };
  return {
    dimCount: DIMS.length,
    // 内部存的是 id（"crush"），提示词里发的是中文词（"心动"）—— 这里验的就是"两边对上了"
    sparseCrush: sparse.crush,
    sparseMissing: sparse.missing,
    legacyPossess: legacy.possess,
    legacyMissing: legacy.missing,
    unknownKept: Object.keys(unknown).includes("惆怅"),
    unknownCrush: unknown.crush,
    avgPossess: avg.possess,
    avgMissing: avg.missing,
    topLabel: top.label,
    topValue: top.value,
    aliases,
    // 老存档的心情显示兜底（不然界面上那一格是空白）
    legacyMoodLabel: moodDisplay("calm").label,
    newMoodLabel: moodDisplay("crush").label,
  };
});
check("② 11 个维度", logic.dimCount === 11, String(logic.dimCount));
check(
  "② **中文词上报能被认出来**（提示词发的是中文，内部存 id —— 对不上就全丢）",
  Math.abs(logic.sparseCrush - 0.08) < 1e-6,
  `心动=${logic.sparseCrush}`,
);
check("② 没报的维度就是 0（数据层不加底，免得污染平均值）", logic.sparseMissing === 0, `想念=${logic.sparseMissing}`);
check("② **老存档照样能读**（energy/missing/curious → 占有/想念/好奇）", logic.legacyPossess === 0.7 && logic.legacyMissing === 0.2, `占有=${logic.legacyPossess} 想念=${logic.legacyMissing}`);
check("② 不认识的词被丢掉（不然花会长出没名字的一瓣）", !logic.unknownKept && logic.unknownCrush === 0.5);
check("② 平均值正确（1 和 0 的平均 = 0.5，不被零值底抬成 0.53）", Math.abs(logic.avgPossess - 0.5) < 1e-6 && Math.abs(logic.avgMissing - 0.5) < 1e-6, `占有=${logic.avgPossess} 想念=${logic.avgMissing}`);
check("② 最明显那一瓣认得出来", logic.topLabel === "心动" && logic.topValue === 0.08, `${logic.topLabel} ${logic.topValue}`);

/* ②b 旧词别名：改过名的花瓣（偏爱→心动 / 野心→情愫 / 精神→占有）
   和旧的 6 个心情 id 都要认得 —— 老存档不能因为改名就丢 */
const WANT_ALIAS = {
  偏爱: "crush",
  野心: "desire",
  精神: "possess",
  心动: "crush",
  calm: "reflect",
  joy: "share",
  focus: "desire",
  low: "sad",
  miss: "missing",
  spark: "crush",
  fond: "crush",
  ambition: "desire",
  energy: "possess",
};
const aliasBad = Object.entries(WANT_ALIAS)
  .filter(([k, v]) => logic.aliases[k] !== v)
  .map(([k, v]) => `${k}→${logic.aliases[k] ?? "null"}(要${v})`);
check(
  "② 旧词别名表认得全部旧词（3 个改名的花瓣 + 旧 6 个心情 id + 旧英文 id）",
  aliasBad.length === 0,
  aliasBad.join("、") || "13 个旧词都对上了",
);
check(
  "② 老存档的心情**显示不空白**（calm → 平静；新词 crush → 心动）",
  logic.legacyMoodLabel === "平静" && logic.newMoodLabel === "心动",
  `${logic.legacyMoodLabel} / ${logic.newMoodLabel}`,
);

/* ③ 界面 */
await page.goto(`${BASE}/inner`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1500);

const petalCount = await page.locator("svg path[data-petal]").count();
const labelCount = await page.locator("svg text").count();
const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
// 每瓣都有一点点长度（词表里有的就看得见）：量渲染出来的包围盒高度
const petalHeights = await page.$$eval("svg path[data-petal]", (els) =>
  els.map((e) => Math.round(e.getBoundingClientRect().height)),
);

check("③ 花瓣画出来了（两朵 × 11 瓣 = 22）", petalCount === 22, `${petalCount} 瓣`);
check("③ 标签 + 花心文字都在（22 标签 + 4 花心 = 26）", labelCount === 26, `${labelCount} 个`);
check(
  "③ 没报过的维度也留了一点点（看得出词表里有它，但明显短）",
  petalHeights.length > 0 && Math.min(...petalHeights) >= 2,
  `最短 ${Math.min(...petalHeights)}px / 最长 ${Math.max(...petalHeights)}px`,
);
check(
  "③ 花瓣**够长**（真机反馈「太短」：最长那瓣要明显长于一半宽度）",
  Math.max(...petalHeights) >= 70,
  `最长 ${Math.max(...petalHeights)}px`,
);
/* ⚠️ 这条盯真机反馈的根因：**每一瓣都过 SVG 滤镜**会让页面卡、还会让花心偶尔画不出来。
   注意分寸（用户提醒"别那么绝对"）：不是禁止一切发光 —— 单瓣上一个 CSS drop-shadow
   是廉价的、也好看。禁的是"22 条路径各过一遍 feGaussianBlur"这种滤镜链。 */
const svgFilters = await page.locator("svg filter, svg [filter]").count();
check("③ **花瓣里没有 SVG 滤镜链**（真机卡顿 + 花心画崩的元凶）", svgFilters === 0, `${svgFilters} 处`);
const glows = await page.locator(".flower-lobe-glow").count();
check("③ 但保留**一处**廉价光晕（最明显那瓣，CSS drop-shadow）", glows === 2, `${glows} 处（两朵各一处）`);
const beadRx = await page.$$eval("svg ellipse[fill*='40,32,48']", (els) =>
  els.map((e) => Number(e.getAttribute("rx"))),
);
check(
  "③ 花心圆缩到约一半（原来 rx=13.6 太抢戏）",
  beadRx.length > 0 && Math.max(...beadRx) <= 9,
  `rx=${beadRx.join("/")}`,
);
const tide = await page.evaluate(() => {
  const el = document.querySelector(".tide-bg");
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { position: cs.position, w: Math.round(r.width), h: Math.round(r.height) };
});
check(
  "③ 背景是**整页铺满**的（fixed 覆盖视口，不是卡片里那一块）",
  tide?.position === "fixed" && tide.w >= 380 && tide.h >= 800,
  JSON.stringify(tide),
);
check("③ 花心写着最明显那瓣的名字", text.includes("想念") || text.includes("心动"));
check("③ 图下面把数值写清楚了（读得出精确值）", /想念 \d+%|心动 \d+%/.test(text), text.match(/(想念|心动) \d+%/)?.[0] ?? "");
check("③ 老存档那笔也变成了花瓣（30 天平均那朵有值）", text.includes("最近 30 天 · 平均"));
check("③ 「心动」活着（旧 id spark 和新的 crush 都要显示得出来）", text.includes("心动"), text.includes("心动") ? "" : "没渲染出来");
check("③ 页脚如实说明了「只报明显的那几样」", text.includes("此刻明显的那几样"));

/* ④ 心情词表 = 同一张 11 个词的表（用户要的"直接改成图上的这十一个"） */
const moodLegend = text.includes("这 30 天的心情分布");
const missingOnPage = labels.filter((l) => !text.includes(l));
check(
  "④ 心情分布用的是新的 11 个词（页面上 11 个都在）",
  moodLegend && missingOnPage.length === 0,
  missingOnPage.length ? `缺：${missingOnPage.join("、")}` : "11 个都在",
);
check(
  "④ 老存档的心情不空白（mood 还是老 id calm 的那一刻，显示成「平静」而不是空白）",
  text.includes("平静"),
  text.includes("平静") ? "平静" : "没渲染出来",
);
check(
  "④ 提示词里 mood 只能从那 11 个里挑（不然他报的心情会被丢掉）",
  promptSrc.includes("只能从这些词里挑一个") && labels.every((l) => promptSrc.includes(l)),
  labels.filter((l) => !promptSrc.includes(l)).join("、") || "11 个词都在提示词里",
);
check(
  "④ 上报的 mood 走 normalizeDimKey（actions.ts 里不再自己写一份旧白名单）",
  actionsSrc.includes("normalizeDimKey(str(") && !actionsSrc.includes("calm"),
  "actions.ts 里没有旧词 calm",
);
await page.screenshot({ caret: "initial", path: `${WORK}\\inner-flower.png`, fullPage: true });

console.log("-".repeat(64));
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check("全程没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 110) ?? "");
console.log(`内在花瓣图验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
process.exit(bad === 0 ? 0 : 1);
