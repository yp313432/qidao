/**
 * 验思考链弹层：盖没盖住底部导航栏（用户截图里那条露出来的导航）。
 *
 * 办法：拦掉**上游**请求，返回一段假的流式回复（自带思考链），
 * 这样 App 会真的走完"发消息 → 收到思考 → 出现「点开看」"的完整路径。
 * 顺便验一下「发完消息导航立刻回来」。
 */
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:8080";
const OUT = "C:/Users/yanping/Desktop/ds-workspace/preview-shots";

const THINKING =
  "先看看他是不是有事。这条思考链故意写长一点，用来验证弹层底部的文字会不会被底部导航栏遮住。" +
  "再多写几句，让它一定要能滚动起来。第三句在这里。第四句也在这里。第五句。" +
  "第六句用来确认滚到底之后最后一行仍然完整可见。第七句。第八句收尾。";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));

// 假上游：返回 OpenAI 兼容的 SSE
await page.route("**/mock.local/**", async (route) => {
  const chunks = [
    { choices: [{ delta: { reasoning_content: THINKING } }] },
    { choices: [{ delta: { content: "我在的。这条是假回复，只为把界面跑通。" } }] },
    { choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
  ];
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  await route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
    body,
  });
});

// 1) 先打开一次，让库建起来
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

// 2) 配好"自定义上游"（指向我们的假地址）
const cfg = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("qidao-store", 1);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const raw = await new Promise((res, rej) => {
    const tx = db.transaction("kv", "readonly");
    const g = tx.objectStore("kv").get("aster-app");
    g.onsuccess = () => res(g.result);
    g.onerror = () => rej(g.error);
  });
  const parsed = JSON.parse(raw);
  parsed.state.settings = {
    ...parsed.state.settings,
    showThinking: true,
    customBaseUrl: "https://mock.local/v1",
    customApiKey: "mock-key",
    upstreamModel: "mock-model",
  };
  await new Promise((res) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
    tx.oncomplete = res;
  });
  return { ok: true, upstreamModel: parsed.state.settings.upstreamModel };
});
console.log("配好假上游:", JSON.stringify(cfg));

// 3) 重新加载，发一条消息
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

const navState = () =>
  page.evaluate(() => {
    const nav = document.querySelector(".glass-nav-bar") ?? document.querySelector("nav");
    if (!nav) return { found: false };
    const cs = getComputedStyle(nav);
    const r = nav.getBoundingClientRect();
    return {
      z: Number(cs.zIndex) || null,
      opacity: cs.opacity,
      visible: Number(cs.opacity) > 0.5 && r.bottom > 0 && r.top < window.innerHeight,
      顶边: Math.round(r.top),
    };
  });

await page.click("textarea");
await page.waitForTimeout(500);
await page.fill("textarea", "在吗");
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);

const navAfter = await navState();
console.log("\n① 发完消息后的导航:", JSON.stringify(navAfter), navAfter.visible ? "✅ 回来了" : "❌ 还躲着");
await page.screenshot({ path: `${OUT}/fix1-nav-after-send.png`, timeout: 60000 });

// 4) 等助手消息带出思考链，点「点开看」
await page.waitForTimeout(2500);
const btn = await page.$('button:has-text("点开看")');
console.log("\n③ 找到「点开看」:", btn ? "是" : "否");
if (!btn) {
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 200));
  console.log("   页面文字:", t);
  await page.screenshot({ path: `${OUT}/debug-think-nobutton.png`, timeout: 60000 });
} else {
  await btn.click();
  await page.waitForTimeout(1000);
  const layer = await page.evaluate(() => {
    const sheet = document.querySelector('[role="dialog"][aria-modal="true"]');
    const nav = document.querySelector(".glass-nav-bar") ?? document.querySelector("nav");
    if (!sheet) return { 弹层: false };
    const sz = Number(getComputedStyle(sheet).zIndex);
    const nz = nav ? Number(getComputedStyle(nav).zIndex) || null : null;
    const nr = nav ? nav.getBoundingClientRect() : null;
    // 面板 = 弹层根的直接子元素里、不带 absolute 的那个（遮罩是 absolute inset-0）
    const panel = [...sheet.children].find(
      (el) => getComputedStyle(el).position !== "absolute",
    );
    const pr = panel ? panel.getBoundingClientRect() : null;
    const scroller = panel?.querySelector(".overflow-y-auto");
    const scs = scroller ? getComputedStyle(scroller) : null;
    return {
      弹层: true,
      弹层z: sz,
      导航z: nz,
      层级_弹层在上: nz === null ? "（导航没设 z-index，靠 DOM 顺序）" : sz > nz,
      面板顶: pr ? Math.round(pr.top) : null,
      面板底: pr ? Math.round(pr.bottom) : null,
      导航顶: nr ? Math.round(nr.top) : null,
      面板盖住导航: pr && nr ? pr.bottom >= nr.top : null,
      滚区paddingBottom: scs ? scs.paddingBottom : "(没找到滚区)",
      navH变量: getComputedStyle(document.documentElement).getPropertyValue("--aster-nav-h").trim(),
    };
  });
  console.log("   层级检查:", JSON.stringify(layer, null, 2));
  await page.screenshot({ path: `${OUT}/fix3-think-sheet.png`, timeout: 60000 });

  await page.evaluate(() => {
    const box = document.querySelector('[role="dialog"][aria-modal="true"] .overflow-y-auto');
    if (box) box.scrollTop = box.scrollHeight;
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/fix3-think-sheet-bottom.png`, timeout: 60000 });
  console.log("   已存截图 fix3-think-sheet.png / -bottom.png");
}

console.log("\n控制台错误:", errs.length ? [...new Set(errs)].join(" | ") : "(none)");
await browser.close();
