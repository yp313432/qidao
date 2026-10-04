/**
 * 验这五个 bug 修好了没有。
 *
 * ① 发完消息底部导航要立刻回来（不用点一下）
 * ② 输入区两行选择器：模型 / 推理，各弹下一级
 * ③ 思考链弹层要盖住导航栏（不能露一条、不能遮挡）
 * ④ 最大输出长度 + 回复风格 已挪到「系统 → 思考链」
 * ⑤ 三级页返回上级（/permissions → /core 等）
 *
 * 跑法：node verify-fixes.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8080";
const OUT = "C:/Users/yanping/Desktop/ds-workspace/preview-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

const P = (s) => console.log(s);

/* ── ⑤ 三级页返回 ─────────────────────────────── */
P("\n=== ⑤ 三级页的返回目标 ===");
const backChecks = [
  ["/permissions", "/core"],
  ["/worldbook", "/core"],
  ["/inner", "/core"],
  ["/memories", "/core"],
  ["/play/gobang", "/play/tools"],
  ["/play/days", "/play/tools"],
  ["/play/todo", "/play/tools"],
  ["/play/add", "/play/listen"],
];
/*
  ⚠️ 用 domcontentloaded + 显式等 header，**不要用 waitUntil:"commit"**。
  commit 会在响应刚开始时就返回，SSR 的 HTML 还没解析完，
  document.querySelector 抓到 null —— 我在这上面误报过两次。
*/
for (const [route, want] of backChecks) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60000 });
  let href = null;
  try {
    await page.waitForSelector("header", { timeout: 20000 });
    href = await page.evaluate(() => {
      const a = document.querySelector('header a[aria-label^="返回"]');
      return a ? a.getAttribute("href") : null;
    });
  } catch {
    href = "(页面没渲染出来)";
  }
  const ok = href === want;
  P(`  ${route.padEnd(16)} → ${String(href).padEnd(16)} 期望 ${want}  ${ok ? "✅" : "❌"}`);
}

/* ── ① 发完消息导航回来 ───────────────────────── */
P("\n=== ① 发完消息底部导航立刻回来 ===");
await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2500);

const navVisible = async () => {
  return page.evaluate(() => {
    // 找底部导航（nav 或带 glass-nav-bar 的元素）
    const el =
      document.querySelector(".glass-nav-bar") ??
      document.querySelector('nav[class*="glass"]') ??
      document.querySelector("nav");
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      found: true,
      opacity: cs.opacity,
      transform: cs.transform,
      // 真的看得见吗：不透明、且没有整块移出屏幕
      visible: Number(cs.opacity) > 0.5 && r.bottom > 0 && r.top < window.innerHeight,
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
    };
  });
};

const before = await navVisible();
P(`  打字前的导航: ${JSON.stringify(before)}`);

// 聚焦输入框 → 导航应该收下去
await page.click("textarea");
await page.waitForTimeout(600);
const focused = await navVisible();
P(`  聚焦输入框后（应该收起）: visible=${focused.visible} ${focused.visible ? "❌ 没收起" : "✅"}`);

// 打几个字并回车发出（走 Enter 那条路径）
await page.fill("textarea", "测试一下发完导航回不回来");
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
const afterSend = await navVisible();
P(`  发完之后（应该回来）: visible=${afterSend.visible} ${afterSend.visible ? "✅" : "❌ 还是躲着"}`);
await page.screenshot({ path: `${OUT}/fix1-nav-after-send.png`, timeout: 60000 });

/* ── ② 两行选择器 ─────────────────────────────── */
P("\n=== ② 输入区两行选择器 ===");
const rows = await page.evaluate(() => {
  const m = document.querySelector('button[aria-label="选择模型"]');
  const r = document.querySelector('button[aria-label="选择推理力度"]');
  return {
    model: m ? { text: m.textContent.trim(), h: Math.round(m.getBoundingClientRect().height) } : null,
    reason: r ? { text: r.textContent.trim(), h: Math.round(r.getBoundingClientRect().height) } : null,
  };
});
P(`  模型按钮: ${JSON.stringify(rows.model)}`);
P(`  推理按钮: ${JSON.stringify(rows.reason)}`);
P(`  两个都在: ${rows.model && rows.reason ? "✅" : "❌"}`);

// 点推理按钮 → 弹出下一级
if (rows.reason) {
  await page.click('button[aria-label="选择推理力度"]');
  await page.waitForTimeout(500);
  const menu = await page.evaluate(() => {
    const items = [...document.querySelectorAll("button")].filter((b) => {
      const t = b.textContent ?? "";
      return /快答|均衡|深思/.test(t) && b.closest(".glass-menu");
    });
    return items.map((b) => b.textContent.replace(/\s+/g, " ").trim());
  });
  P(`  推理弹层里的选项: ${JSON.stringify(menu)} ${menu.length === 3 ? "✅" : "❌"}`);
  await page.screenshot({ path: `${OUT}/fix2-reason-menu.png`, timeout: 60000 });
  await page.keyboard.press("Escape");
  await page.click("body", { position: { x: 10, y: 300 } });
  await page.waitForTimeout(400);
}

// 点模型按钮 → 弹出下一级
await page.click('button[aria-label="选择模型"]');
await page.waitForTimeout(500);
const modelMenu = await page.evaluate(() => {
  const el = document.querySelector(".glass-menu");
  return el ? el.textContent.replace(/\s+/g, " ").trim().slice(0, 80) : null;
});
P(`  模型弹层内容: ${modelMenu ? JSON.stringify(modelMenu) : "（空 —— 可能还没配上游）"}`);
await page.screenshot({ path: `${OUT}/fix2-model-menu.png`, timeout: 60000 });
await page.click("body", { position: { x: 10, y: 300 } });
await page.waitForTimeout(400);

/* ── ④ 设置项挪位置 ───────────────────────────── */
P("\n=== ④ 最大输出长度 / 回复风格 的位置 ===");
const findIn = async (route, needles) => {
  await page.goto(BASE + route, { waitUntil: "commit", timeout: 30000 });
  await page.waitForTimeout(2000);
  return page.evaluate((ns) => {
    const txt = document.body.innerText;
    return Object.fromEntries(ns.map((n) => [n, txt.includes(n)]));
  }, needles);
};
const sys = await findIn("/system", ["思考链", "最大输出长度", "回复风格"]);
P(`  /system 里: ${JSON.stringify(sys)}`);
const space = await findIn("/space", ["最大输出长度", "回复风格"]);
P(`  /space 里（应该都没有了）: ${JSON.stringify(space)}`);
const movedOk = sys["最大输出长度"] && sys["回复风格"] && !space["最大输出长度"] && !space["回复风格"];
P(`  挪动正确: ${movedOk ? "✅" : "❌"}`);
await page.goto(BASE + "/system", { waitUntil: "commit" });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((e) => e.textContent?.trim() === "思考链");
  el?.scrollIntoView({ block: "start" });
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/fix4-system-thinking.png`, timeout: 60000 });

/* ── ③ 思考链弹层盖住导航 ─────────────────────── */
P("\n=== ③ 思考链弹层与导航的层级关系 ===");
// 造一条真实消息：拦掉上游请求，返回带思考链的假流式回复
const THINKING =
  "先看看他是不是有事。这条思考链故意写长一点，用来验证弹层底部的文字会不会被底部导航栏遮住。" +
  "再多写几句，让它一定要能滚动起来。第三句在这里。第四句也在这里。第五句。" +
  "第六句用来确认滚到底之后最后一行仍然完整可见。第七句。第八句收尾。";
await page.route("**/mock.local/**", async (route) => {
  const chunks = [
    { choices: [{ delta: { reasoning_content: THINKING } }] },
    { choices: [{ delta: { content: "我在的。这条是假回复，只为把界面跑通。" } }] },
    { choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
  ];
  await route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
    body: chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n",
  });
});
// 配好假上游
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
});
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.click("textarea");
await page.fill("textarea", "在吗");
await page.keyboard.press("Enter");
await page.waitForTimeout(3500);

const trigger = await page.$('button:has-text("点开看")');
if (!trigger) {
  P("  ❌ 没造出思考链消息");
} else {
  await trigger.click();
  await page.waitForTimeout(900);
  const layer = await page.evaluate(() => {
    const sheet = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!sheet) return { 弹层: false };
    const wrap = document.querySelector(".z-\\[60\\]");
    const nav = document.querySelector(".glass-nav-bar");
    const panel = [...sheet.children].find((el) => getComputedStyle(el).position !== "absolute");
    const pr = panel?.getBoundingClientRect();
    const nr = nav?.getBoundingClientRect();
    const scroller = panel?.querySelector(".overflow-y-auto");
    return {
      弹层z: Number(getComputedStyle(sheet).zIndex),
      导航外层z: wrap ? Number(getComputedStyle(wrap).zIndex) : null,
      面板盖过导航: pr && nr ? pr.bottom >= nr.top : null,
      滚区底部留白: scroller ? getComputedStyle(scroller).paddingBottom : null,
      navH: getComputedStyle(document.documentElement).getPropertyValue("--aster-nav-h").trim(),
    };
  });
  P(`  层级: ${JSON.stringify(layer)}`);
  P(
    `  弹层压住导航: ${
      layer.弹层z > layer.导航外层z && layer.面板盖过导航 ? "✅" : "❌"
    }`,
  );
  P(`  底部留白 = 导航高度: ${layer.滚区底部留白 === "80px" ? "✅ 80px" : "❌ " + layer.滚区底部留白}`);
  await page.screenshot({ path: `${OUT}/fix3-think-sheet.png`, timeout: 90000 });
  await page.evaluate(() => {
    const box = document.querySelector('[role="dialog"][aria-modal="true"] .overflow-y-auto');
    if (box) box.scrollTop = box.scrollHeight;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/fix3-think-sheet-bottom.png`, timeout: 90000 });
}

P("\n控制台错误: " + (errors.length ? [...new Set(errors)].join(" | ") : "(none)"));
await browser.close();
