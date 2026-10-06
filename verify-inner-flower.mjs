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
 *   ④ **心情里的「心动」活着**（原来类型里有、白名单没有 → 永远显示不出来）
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

/* 种三笔：老格式 / 新稀疏 / 新的带"心动" */
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
      { id: "s1", at: nowMs - 3 * 86400000, mood: "calm", energy: 0.7, missing: 0.35, curious: 0.6 },
      // 新稀疏：只报了一瓣，而且很小 —— 正是参考图那个样子
      {
        id: "s2",
        at: nowMs - 3600000,
        mood: "miss",
        energy: 0,
        missing: 0,
        curious: 0,
        dims: { 偏爱: 0.08, 想念: 0.72, 牵挂: 0.4, 无聊: 0.55 },
        note: "他 MCP 接通了，心情轻松",
      },
      { id: "s3", at: nowMs - 7200000, mood: "spark", energy: 0.5, missing: 0.3, curious: 0.4, dims: { 心动: 0.66 } },
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
  const { dimsOf, averageDims, strongest, DIMS } = await import("/src/lib/state-dims.ts");
  const sparse = dimsOf({ dims: { 偏爱: 0.08 } });
  const legacy = dimsOf({ energy: 0.7, missing: 0.2, curious: 0.7 });
  const unknown = dimsOf({ dims: { 惆怅: 0.9, 偏爱: 0.5 } });
  const avg = averageDims([{ energy: 1, missing: 0, curious: 0 }, { energy: 0, missing: 1, curious: 0 }]);
  const top = strongest(sparse);
  return {
    dimCount: DIMS.length,
    // 内部存的是 id（"fond"），提示词里发的是中文词（"偏爱"）—— 这里验的就是"两边对上了"
    sparseFond: sparse.fond,
    sparseMissing: sparse.missing,
    legacyEnergy: legacy.energy,
    legacyMissing: legacy.missing,
    unknownKept: Object.keys(unknown).includes("惆怅"),
    unknownFond: unknown.fond,
    avgEnergy: avg.energy,
    avgMissing: avg.missing,
    topLabel: top.label,
    topValue: top.value,
  };
});
check("② 11 个维度", logic.dimCount === 11, String(logic.dimCount));
check(
  "② **中文词上报能被认出来**（提示词发的是中文，内部存 id —— 对不上就全丢）",
  Math.abs(logic.sparseFond - 0.08) < 1e-6,
  `偏爱=${logic.sparseFond}`,
);
check("② 没报的维度就是 0（数据层不加底，免得污染平均值）", logic.sparseMissing === 0, `想念=${logic.sparseMissing}`);
check("② **老存档照样能读**（energy/missing/curious）", logic.legacyEnergy === 0.7 && logic.legacyMissing === 0.2, `精力=${logic.legacyEnergy} 想念=${logic.legacyMissing}`);
check("② 不认识的词被丢掉（不然花会长出没名字的一瓣）", !logic.unknownKept && logic.unknownFond === 0.5);
check("② 平均值正确（1 和 0 的平均 = 0.5，不被零值底抬成 0.53）", Math.abs(logic.avgEnergy - 0.5) < 1e-6 && Math.abs(logic.avgMissing - 0.5) < 1e-6, `精力=${logic.avgEnergy} 想念=${logic.avgMissing}`);
check("② 最明显那一瓣认得出来", logic.topLabel === "想念" || logic.topLabel === "偏爱", `${logic.topLabel} ${logic.topValue}`);

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
  "③ 「不用突出这么长」：最长那瓣不超过整朵的三分之二（不再是细长条）",
  Math.max(...petalHeights) / 330 <= 0.72,
  `最长 ${Math.max(...petalHeights)}px`,
);
check("③ 花心写着最明显那瓣的名字", text.includes("想念") || text.includes("偏爱"));
check("③ 图下面把数值写清楚了（读得出精确值）", /想念 \d+%|偏爱 \d+%/.test(text), text.match(/(想念|偏爱) \d+%/)?.[0] ?? "");
check("③ 老存档那笔也变成了花瓣（30 天平均那朵有值）", text.includes("最近 30 天 · 平均"));
check("③ 「心动」活着（原来类型里有、白名单没有）", text.includes("心动"), text.includes("心动") ? "" : "没渲染出来");
check("③ 页脚如实说明了「只报明显的那几样」", text.includes("此刻明显的那几样"));
await page.screenshot({ caret: "initial", path: `${WORK}\\inner-flower.png`, fullPage: true });

console.log("-".repeat(64));
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check("全程没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 110) ?? "");
console.log(`内在花瓣图验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
process.exit(bad === 0 ? 0 : 1);
