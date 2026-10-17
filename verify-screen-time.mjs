/**
 * 屏幕时间页的界面验收（网页版能验的部分）。
 *
 * 用户的请求（2026-11）："我还加个功能，就是能看到屏幕使用时长，
 * 就是知道我一天每个app用了多久那个。"
 *
 * ⚠️ 真机那份数据（UsageStats）在网页里根本不存在 —— 所以这里验的是
 * **网页版必须优雅降级**：显示"这一页只能在手机上用"，而不是一个 0 分钟的空列表
 * （那会让人以为"我一天没玩手机"，比没有这个功能还糟）。
 *
 * 原生那条链（SenseBridgePlugin.usage）只有真机/APK 能验，这里验不到。
 */
import { chromium, devices } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const results = [];
const fail = [];
function check(name, ok, extra = "") {
  results.push(`${ok ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`);
  if (!ok) fail.push(name);
}

const browser = await chromium.launch({
  channel: "msedge",
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  ...devices["Pixel 7"],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") fail.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => fail.push(`pageerror: ${e.message}`));

/* 离线也要能开（页面不依赖网络） */
const boot = async (path) => {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(700);
};

console.log("=== 1. 玩乐首页有「屏幕时间」入口 ===");
await boot("/play");
const entry = page.locator('a[href="/play/screen-time"]');
check("玩乐首页有「屏幕时间」入口", (await entry.count()) === 1);
check(
  "入口文案是「屏幕时间」",
  (await entry.first().innerText()).replace(/\s+/g, "").includes("屏幕时间"),
);

console.log("=== 2. 点进去是 /play/screen-time，标题对 ===");
await entry.first().click();
await page.waitForTimeout(900);
const url = new URL(page.url()).pathname;
check("点进去到了 /play/screen-time", url === "/play/screen-time", url);
check("页面上有「屏幕时间」标题", (await page.locator("body").innerText()).includes("屏幕时间"));

console.log("=== 3. 网页版必须优雅降级（不是 0 分钟空列表）===");
const text = await page.locator("body").innerText();
check("网页版说「这一页只能在手机上用」", text.includes("这一页只能在手机上用"));
check("没有编一个 0 分钟的空列表", !text.includes("0 分钟"));
check("没有把「还没打开使用情况访问」当成网页版的问题", !text.includes("去开「使用情况访问」"));

console.log("=== 4. 合计卡片 + 今天/近 7 天切换 ===");
check("有「今天 / 近 7 天」两个切换", (await page.getByRole("button", { name: "今天" }).count()) >= 1 && (await page.getByRole("button", { name: "近 7 天" }).count()) >= 1);
await page.getByRole("button", { name: "近 7 天" }).click();
await page.waitForTimeout(600);
check(
  "切到近 7 天后卡片标题跟着变（last 7 days）",
  (await page.locator("body").innerText()).toLowerCase().includes("last 7 days"),
);

console.log("=== 5. 返回钮回玩乐 ===");
await page.locator('header a[aria-label^="返回"]').first().click();
await page.waitForTimeout(800);
check("返回后是玩乐首页", new URL(page.url()).pathname === "/play", new URL(page.url()).pathname);

console.log("=== 6. 没有横向溢出 ===");
const overflow = await page.evaluate(() => {
  const w = window.innerWidth;
  return [...document.querySelectorAll("body *")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.right > w + 1 && !["IFRAME", "VIDEO", "AUDIO"].includes(el.tagName);
  }).length;
});
check("页面没有元素越出屏幕右边", overflow === 0, `溢出 ${overflow} 个`);

console.log("=== 7. 没有页面报错 ===");
check("没有页面报错", fail.filter((f) => f.startsWith("console:") || f.startsWith("pageerror:")).length === 0);

console.log("\n" + results.join("\n"));
console.log(`\n${fail.length === 0 ? "全部通过（0 个失败）" : `❌ 失败 ${fail.length} 项：\n` + fail.join("\n")}`);
await browser.close();
process.exit(fail.length === 0 ? 0 : 1);
