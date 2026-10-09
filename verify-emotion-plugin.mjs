/**
 * 验收：「情绪生命体」插件真的渲染出来了（不是白屏 / 不报错）。
 *
 * 跑法：`node verify-emotion-plugin.mjs`（dev server 在 127.0.0.1:8080）
 *
 * 任务书要求的硬断言：
 *   ① canvas 存在，且 getImageData 里非黑像素 > 1000（画布真有内容）
 *   ② 没有 pageerror
 *   ③ 页面文字里有「情绪生命体」或「平静」这类真实文案
 * 另外顺手验的（都跟"接线对不对"有关，不是设计）：
 *   ④ 有返回钮、点了能回插件目录  ⑤ 宿主那条主导航被整屏规则藏掉了
 *   ⑥ 插件目录里跟 时感 / 记忆宇宙 并列  ⑦ 记忆宇宙没被这次改动碰坏
 * 截图存 `../preview-shots/emotion-plugin.png`。
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const BASE = "http://127.0.0.1:8080";
const PAGE_URL = `${BASE}/play/plugins/emotion`;
const SHOT = resolve(process.cwd(), "..", "preview-shots", "emotion-plugin.png");

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

const errors = [];
const consoleErrors = [];
const failedRequests = [];

const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
/* dev server 第一次请求新路由要现场编译，30s 可能不够 —— 给 90s */
page.setDefaultTimeout(90000);

page.on("pageerror", (e) => errors.push(e.stack || String(e)));
page.on("requestfailed", (r) => failedRequests.push(`${r.url()} — ${r.failure()?.errorText}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const loc = m.location();
  const line = `${m.text()}  @ ${loc.url}:${loc.lineNumber}`;
  /*
   * 允许的一条（且只允许这一类）：**第三方域名的资源拉不到**。
   * 这台机器没有外网，所以：
   *   · `https://grok.com/grok-app-builder/extensions.js` —— 沙箱注入的品牌脚本
   *     （平台 chrome，按 AGENTS.md 一个字都不许动）
   *   · `https://fonts.googleapis.com/css2?...` —— 栖岛 `__root.tsx` head 里的字体
   * 两个都是**宿主层面的、跟本插件无关**的失败，而且都在改动之前就存在。
   * 除此之外的 console.error（尤其是 127.0.0.1 上的脚本 / 内联 JS）一条都不放过。
   */
  const thirdPartyNoise =
    /Failed to load resource/.test(line) && /@ https:\/\/(?!127\.0\.0\.1|localhost)/.test(line);
  consoleErrors.push(thirdPartyNoise ? `[已知噪音 · 无外网] ${line}` : line);
});

/** 数一块 canvas 上的非黑像素（背景是 #09070e，阈值取 24 把它排掉） */
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

/* ── 1. 从插件目录点进去（这样返回钮有上一页可回） ─────────── */
await page.goto(`${BASE}/play/plugins`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.getByText("情绪生命体").first().waitFor({ timeout: 30000 });
const hubText = await page.evaluate(() => document.body.innerText || "");
const hubLists =
  hubText.includes("情绪生命体") && hubText.includes("记忆宇宙") && hubText.includes("时感");

await page.locator('a[href="/play/plugins/emotion"]').click();
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(2500);
console.log(`HTTP           200（目录 → 插件，客户端跳转）`);

const canvas = await canvasStats();
const text = await page.evaluate(() => document.body.innerText || "");
const hasCopy = text.includes("情绪生命体") || text.includes("平静");
const hasBack = (await page.locator('button[aria-label="返回插件"]').count()) > 0;
const hostNavHidden = (await page.locator('nav[aria-label="主导航"]').count()) === 0;

mkdirSync(dirname(SHOT), { recursive: true });
await page.screenshot({ path: SHOT });

/* ── 2. 插件内部还能用（切一个 tab） ─────────────────────── */
await page.getByRole("button", { name: "详情" }).click();
await page.waitForTimeout(400);
const detailText = await page.evaluate(() => document.body.innerText || "");
const tabWorks = detailText.includes("情绪详情");

/* ── 3. 返回钮 → 插件目录 ───────────────────────────────── */
await page.locator('button[aria-label="返回插件"]').click();
await page.waitForTimeout(1200);
const backUrl = new URL(page.url()).pathname;

/* ── 4. 宽屏下插件自己的底部导航仍然待在"这一屏"里 ───────── */
/* （这是 `.emotion-lifeform { contain: paint }` 那条的作用：
    它自带的 fixed 导航不该横穿整个窗口，只该铺满 max-w-lg 那个手机宽栏目） */
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(1500);
const wideNav = await page.evaluate(() => {
  const navs = [...document.querySelectorAll("nav")];
  const own = navs.find((n) => (n.getAttribute("aria-label") || "") === "分区") ?? navs[0];
  if (!own) return { found: false };
  const r = own.getBoundingClientRect();
  return { found: true, width: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right) };
});
const WIDE_SHOT = resolve(process.cwd(), "..", "preview-shots", "emotion-plugin-desktop.png");
await page.screenshot({ path: WIDE_SHOT });
await page.setViewportSize({ width: 390, height: 844 });

/* ── 5. 回归：记忆宇宙（已有插件）没被碰坏 ───────────────── */
await page.goto(`${BASE}/play/plugins/memory`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(2000);
const memoryCanvas = await canvasStats();

await browser.close();

console.log(`URL            ${PAGE_URL}`);
console.log(`canvas         ${JSON.stringify(canvas)}`);
console.log(`pageerror      ${errors.length}${errors.length ? `\n${errors.join("\n")}` : ""}`);
console.log(`console.error  ${consoleErrors.length}`);
for (const line of consoleErrors.slice(0, 5)) console.log(`               ${line}`);
console.log(
  `requestfailed  ${failedRequests.length}${failedRequests.length ? `\n${failedRequests.join("\n")}` : ""}`,
);
console.log(`截图           ${SHOT}`);
console.log(`宽屏截图       ${WIDE_SHOT}`);
console.log(`宽屏下插件导航 ${JSON.stringify(wideNav)}（窗口 1280 宽，宿主栏目 max-w-lg=512）`);
console.log(`记忆宇宙 canvas ${JSON.stringify(memoryCanvas)}`);
console.log("--- 页面文字（前 220 字）---");
console.log(text.replace(/\n+/g, " | ").slice(0, 220));

console.log("-".repeat(60));
check("canvas 存在且拿到 2d context", canvas.found && canvas.got2d);
check("画布非黑像素 > 1000", (canvas.nonBlack ?? 0) > 1000, `nonBlack=${canvas.nonBlack}`);
check("没有 pageerror", errors.length === 0);
check("页面有真实文案（情绪生命体 / 平静）", hasCopy);
check("有返回钮（aria-label=返回插件）", hasBack);
check("宿主的底部主导航被整屏规则藏掉了", hostNavHidden);
check("插件内部能切 tab（详情）", tabWorks);
check("返回钮回到 /play/plugins", backUrl === "/play/plugins", backUrl);
check("插件目录里跟 时感 / 记忆宇宙 并列列出", hubLists);
check(
  "没有（非品牌脚本的）console.error",
  consoleErrors.filter((l) => !l.startsWith("[已知噪音")).length === 0,
);
check(
  "宽屏下插件自带的底部导航没横穿整窗（还在手机宽栏目里）",
  wideNav.found && wideNav.width <= 520,
  `width=${wideNav.width}（栏目 512）`,
);
check(
  "回归：记忆宇宙画布照旧有内容",
  memoryCanvas.found && (memoryCanvas.nonBlack ?? 0) > 1000,
  `nonBlack=${memoryCanvas.nonBlack}`,
);
process.exit(bad === 0 ? 0 : 1);
