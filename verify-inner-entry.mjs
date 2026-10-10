/**
 * 验收脚本：「内在」页 —— 花拆掉之后只剩入口。
 *
 * 背景：这页原来那朵 11 瓣情绪花拆了（`inner-flower.tsx` 整份删除），
 * 原地留一条去「星屿」的入口卡。
 *
 * ⚠️ 2026-10 更新：连**数据通道也一起退了** —— `lib/state-dims.ts`、动作
 * `state.report`、store 里的 `stateSamples` 全部删除（用户："就是那 11 个就不用了"）。
 * 所以原来那条"11 个词一个都不在页面上"的断言换成了**两条更硬、且不会被误伤的**：
 *   ① 旧词表的定义文件**已经不存在**（词表退休的根证据，不靠搜词）；
 *   ①b 页面上没有那 4 个**只属于旧词表**的花瓣词（分享欲 / 情愫 / 反思 / 占有）——
 *       另外 7 个（想念 / 心动 / 牵挂 / 好奇 / 难过 / 生气）在新词表 217 词里本来就有，
 *       拿它们全文搜会误伤，所以不当判据。
 *
 * 要证明的（"入口在、花不在"）：
 *   ① 旧词表退休 + 页面上没有旧词表独有的是词
 *   ② **没有花瓣 DOM**：`.flower-lobe-glow` / `[data-petal]` 一个都没有
 *   ③ **入口在**：恰好一条链接指向 `/play/plugins/emotion`，点了真的能到
 *   ④ **没有 pageerror**；**空数据（全新 context，IndexedDB 全空）下不白屏**
 *   ⑤ 配套死 CSS 已从 `styles.css` 里删干净（`.flower-breathe / -grow /
 *      -lobe-glow / -petal` 与它们 4 个 keyframes 零命中）
 *
 * 跑法：node verify-inner-entry.mjs （要 dev server 在 8080）
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const WORK = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";
mkdirSync(WORK, { recursive: true });

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ── ① 旧词表：定义文件已删（词表退休的根证据，不靠搜词）── */
check(
  "① 旧词表源头没了（`src/lib/state-dims.ts` 已删除）",
  !existsSync("src/lib/state-dims.ts"),
  existsSync("src/lib/state-dims.ts") ? "文件还在" : "已删除",
);
/** 只属于旧 11 维、且新词表 217 词里没有的那 4 个 —— 拿它们当判据不会误伤 */
const RETIRED_ONLY_WORDS = ["分享欲", "情愫", "反思", "占有"];

/* ── ⑤ 死 CSS：源码级确认删干净了（`aster-flower-breathe` 是另一件事，不算）── */
const cssSrc = readFileSync("src/styles.css", "utf8");
const deadCss = [...cssSrc.matchAll(/\.flower-(?:breathe|grow|lobe-glow|petal)\b/g)].map((m) => m[0]);
const deadKeyframes = [...cssSrc.matchAll(/@keyframes\s+flower-(?:breathe|grow|lobe-glow)\b/g)].map((m) => m[0]);
check(
  "⑤ 花那 4 条死 CSS 已经删干净（.flower-breathe / -grow / -lobe-glow / -petal）",
  deadCss.length === 0,
  deadCss.join("、") || "零命中",
);
check("⑤ 配套的 3 个 keyframes 也没了", deadKeyframes.length === 0, deadKeyframes.join("、") || "零命中");

/* ── 浏览器：390x844（跟真机一致）── */
const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => {
  pageErrors.push(e.message);
  console.log("  ⚠️ 页面报错:", e.message);
});
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

await page.goto(`${BASE}/inner`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1800);

const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");

/* ① 旧词表独有词不在页面上 */
const onPage = RETIRED_ONLY_WORDS.filter((w) => text.includes(w));
check(
  "① 旧词表独有的 4 个花瓣词一个都不在页面上（分享欲/情愫/反思/占有）",
  onPage.length === 0,
  onPage.length ? `漏了：${onPage.join("、")}` : "一个都没有",
);

/* ② 花不在 */
const glows = await page.locator(".flower-lobe-glow").count();
const petals = await page.locator("[data-petal]").count();
check("② 没有花瓣 DOM（`.flower-lobe-glow` 零个）", glows === 0, `${glows} 个`);
check("② 没有花瓣 DOM（`[data-petal]` 零个）", petals === 0, `${petals} 个`);
/* 拆花别把整页的样子也拆了：背景潮水得还在 */
const tide = await page.evaluate(() => {
  const el = document.querySelector(".tide-bg");
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { position: cs.position, w: Math.round(r.width), h: Math.round(r.height) };
});
check(
  "② 背景潮水还在（只拆了花，没把整页的样子一起拆掉）",
  tide?.position === "fixed" && tide.w >= 380 && tide.h >= 800,
  JSON.stringify(tide),
);

/* ③ 入口在、点了能到 */
const entry = page.locator('a[href*="/play/plugins/emotion"]');
const entryCount = await entry.count();
check("③ 入口在（恰好一条链接指向 /play/plugins/emotion）", entryCount === 1, `${entryCount} 条`);
check("③ 入口是**看得见**的（不是 hidden / 零尺寸）", entryCount === 1 && (await entry.first().isVisible()));
check("③ 入口写着「星屿」", text.includes("星屿"));
check("③ 入口给出来路（玩乐 → 插件 → 星屿）", text.includes("玩乐 → 插件 → 星屿"));

let clicked = false;
if (entryCount === 1) {
  await entry.first().click();
  try {
    await page.waitForURL(/\/play\/plugins\/emotion/, { timeout: 20000 });
    clicked = true;
  } catch {
    clicked = false;
  }
}
check("③ **真的点得到**（点完地址栏落在 /play/plugins/emotion）", clicked, page.url());

/* 回到首页留档 */
await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ caret: "initial", path: `${WORK}\\inner-entry.png`, fullPage: true });

/* ④ 空数据：全新 context（IndexedDB 全空）也不白屏 */
const clean = await browser.newContext({ viewport: { width: 390, height: 844 } });
const cleanPage = await clean.newPage();
const cleanErrors = [];
cleanPage.on("pageerror", (e) => {
  cleanErrors.push(e.message);
  console.log("  ⚠️ 空数据页面报错:", e.message);
});
await cleanPage.goto(`${BASE}/inner`, { waitUntil: "domcontentloaded", timeout: 60000 });
await cleanPage.waitForTimeout(1500);
const cleanText = (await cleanPage.locator("body").innerText()).replace(/\s+/g, " ").trim();
check("④ 空数据下**不白屏**（正文有字，不是空白页）", cleanText.length >= 40, `${cleanText.length} 字`);
check(
  "④ 空数据下入口照样在",
  (await cleanPage.locator('a[href*="/play/plugins/emotion"]').count()) === 1,
);
check(
  "④ 空数据下也没有花瓣 / 也没有那 4 个旧词表独有词",
  (await cleanPage.locator(".flower-lobe-glow, [data-petal]").count()) === 0 &&
    RETIRED_ONLY_WORDS.every((w) => !cleanText.includes(w)),
);
check("④ **空数据下没有 pageerror**", cleanErrors.length === 0, cleanErrors[0]?.slice(0, 120) ?? "");
await cleanPage.screenshot({ caret: "initial", path: `${WORK}\\inner-entry-empty.png`, fullPage: true });

/* ④b 有数据时也没有 pageerror */
check("④ `/inner` 全程没有 pageerror", pageErrors.length === 0, pageErrors[0]?.slice(0, 120) ?? "");

console.log("-".repeat(64));
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check("全程没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 110) ?? "");
console.log(`内在入口验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
process.exit(bad === 0 ? 0 : 1);
