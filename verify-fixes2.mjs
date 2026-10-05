/**
 * 验这轮五条修复。
 * 重点是第 5 条：底部导航**永远不消失**（前两次我都改错了方向）。
 */
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:8080";
const OUT = "C:/Users/yanping/Desktop/ds-workspace/preview-shots";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));

const navVisible = () =>
  page.evaluate(() => {
    const nav = document.querySelector(".glass-nav-bar");
    if (!nav) return { found: false };
    const r = nav.getBoundingClientRect();
    const cs = getComputedStyle(nav);
    const wrap = nav.closest(".fixed");
    const ws = wrap ? getComputedStyle(wrap) : null;
    return {
      found: true,
      可见: Number(cs.opacity) > 0.5 && r.bottom > 0 && r.top < window.innerHeight,
      外层透明: ws ? ws.opacity : null,
      外层transform: ws ? ws.transform : null,
      顶边: Math.round(r.top),
    };
  });

/* ── 第 5 条：导航栏常驻 ───────────────────────── */
console.log("=== ⑤ 导航栏是不是永远在 ===");
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);

console.log("  ① 刚进页面:", JSON.stringify(await navVisible()));
await page.click("textarea");
await page.waitForTimeout(800);
console.log("  ② 点开键盘（聚焦输入框）:", JSON.stringify(await navVisible()));
await page.fill("textarea", "测试");
await page.waitForTimeout(500);
console.log("  ③ 打了字:", JSON.stringify(await navVisible()));
// 让它失焦（等于收起键盘）
await page.evaluate(() => document.activeElement?.blur());
await page.waitForTimeout(700);
console.log("  ④ 收起键盘（失焦）:", JSON.stringify(await navVisible()));
await page.screenshot({ path: `${OUT}/fix-nav-persist.png`, timeout: 60000 });

/* ── 第 1 条：名字顺序 ────────────────────────── */
console.log("\n=== ① 名字顺序（AI 在左）===");
await page.goto(BASE + "/play", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);
const names = await page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  const h1 = document.querySelector("h1")?.innerText.trim() ?? "";
  // 卡片里那行名字
  const card = document.querySelector("section.aster-card");
  const cardPs = card ? [...card.querySelectorAll("p")].map((p) => p.innerText.trim()) : [];
  return { 顶部标题: h1, 卡片里那行: cardPs[cardPs.length - 1] ?? "" };
});
console.log("  顶部标题:", names.顶部标题);
console.log("  卡片里那行:", names.卡片里那行);
const bothSame = names.顶部标题.startsWith("辰") && names.卡片里那行.startsWith("辰");
console.log(`  两处一致（都以 AI 的名字开头）: ${bothSame ? "✅" : "❌"}`);

/* ── 第 3 条：时感返回钮 ─────────────────────── */
console.log("\n=== ③ 时感有没有返回钮 ===");
await page.goto(BASE + "/play/shigan", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
const back = await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="返回玩乐"]');
  if (!b) return { 有: false };
  const r = b.getBoundingClientRect();
  const cs = getComputedStyle(b);
  return { 有: true, 位置: `${Math.round(r.left)},${Math.round(r.top)}`, 可见: r.width > 0 && cs.opacity !== "0" };
});
console.log("  返回钮:", JSON.stringify(back));
await page.screenshot({ path: `${OUT}/fix-shigan-back.png`, timeout: 60000 });
if (back.有) {
  await page.click('button[aria-label="返回玩乐"]');
  await page.waitForTimeout(2500);
  const url = page.url();
  console.log(`  点它之后到: ${url} ${url.includes("/play") && !url.includes("shigan") ? "✅ 回到玩乐了" : "❌"}`);
}

/* ── 第 2 条：工具的保存按钮能不能看到 ──────── */
console.log("\n=== ② 新建工具时「保存」在不在视口内 ===");
for (const [route, label, openText] of [
  ["/tools", "HTTP", "新建 HTTP 工具"],
  ["/tools", "MCP", "添加 MCP 服务器"],
]) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  if (label === "MCP") {
    const tab = await page.$('button:has-text("MCP")');
    if (tab) {
      await tab.click();
      await page.waitForTimeout(1500);
    }
  }
  const opener = await page.$(`button:has-text("${openText}")`);
  if (!opener) {
    console.log(`  ${label}: 没找到「${openText}」按钮`);
    continue;
  }
  await opener.click();
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "保存");
    if (!save) return { 有: false };
    const r = save.getBoundingClientRect();
    return {
      有: true,
      底边: Math.round(r.bottom),
      屏高: window.innerHeight,
      在视口内: r.bottom <= window.innerHeight && r.top >= 0,
    };
  });
  console.log(`  ${label}: ${JSON.stringify(info)} ${info.有 && info.在视口内 ? "✅ 看得见" : "❌"}`);
  await page.screenshot({ path: `${OUT}/fix-tool-save-${label}.png`, timeout: 60000 });
}

console.log("\n控制台错误:", errs.length ? [...new Set(errs)].join(" | ") : "(none)");
await browser.close();
