#!/usr/bin/env node
/**
 * 验收（用户 m01498 第 4 条）：**他在回复的时候，界面不许自己翻动**。
 *
 * 用户原话：「ai回复消息时，界面不能翻动，会上下抽搐，改一下，即使他在回复我也可以上翻界面」。
 * 老毛病是"消息一变就 `scrollTop = scrollHeight`"：流式每 100ms 改一次内容，
 * 你手指刚上翻就被拽回底部 → 看起来就是**抽搐**。
 *
 * 现在 `src/components/chat/chat-view.tsx` 的规则是：
 *   · 只在"你本来就在底部"（离底 < 80px）时才跟滚；
 *   · 你一上翻（`stickBottom.current = false`）它就老实待着，由「↓ 回到最新」按钮决定何时回来；
 *   · 翻上去超过 420px 才浮出那个按钮。
 *
 * 这个脚本用一个**慢慢吐字的假上游**（30 片、每片 130ms，≈4 秒）把上面三条在真页面上跑一遍：
 *   贴底时不掉队 → 中途上翻 → **token 还在进、但界面不再跟着动** → 点「回到最新」落回底部。
 * 最后读 IndexedDB 确认那轮回复真的落库了（不看 DOM 猜）。
 *
 * 跑法（dev server 要在 8080）：node verify-stream-scroll.mjs
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

/* ───────────────── 慢速假上游（只监听随机端口，不碰 8080） ───────────────── */

let hits = 0;
let sent = 0;
/** 吐慢一点（40 片 × 220ms ≈ 8.8 秒）：第 2 步和第 3 步都要在**流还没结束**时取样，
    太短的话后面几步只剩"它没动"，分不清"是听话"还是"流早停了" */
const PIECES = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 句：我在慢慢把这件事讲清楚。`);

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

const upstream = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    res.end();
    return;
  }
  await readBody(req);
  hits += 1;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
  });
  /* 开头先停 250ms：让"发出去 → 第一条 token 到"之间也有个空档，更接近真上游 */
  await new Promise((r) => setTimeout(r, 250));
  for (const piece of PIECES) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`);
    sent += 1;
    await new Promise((r) => setTimeout(r, 220));
  }
  res.write("data: [DONE]\n\n");
  res.end();
});

await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const UP = `http://127.0.0.1:${upstream.address().port}`;
console.log(`慢速假上游：${UP}（${PIECES.length} 片 × 220ms ≈ ${((PIECES.length * 220) / 1000).toFixed(1)} 秒）\n`);

/* ───────────────── 塞一个"已经聊了十几轮"的会话 ───────────────── */

const now = Date.now();
const old = [];
for (let i = 0; i < 9; i += 1) {
  old.push({
    id: `u${i}`,
    role: "user",
    content: `第 ${i + 1} 件小事，随便聊两句先垫长一点。`,
    thinking: "",
    thinkingDurationMs: 0,
    createdAt: now - (20 - i) * 60000,
  });
  old.push({
    id: `a${i}`,
    role: "assistant",
    content: `嗯，第 ${i + 1} 件我记下了 —— 这句话也长一点，好让列表真的能滚。`,
    thinking: "",
    thinkingDurationMs: 0,
    createdAt: now - (19 - i) * 60000,
  });
}

const snapshot = {
  state: {
    conversations: [
      {
        id: "conv-scroll",
        title: "跟滚验收",
        messages: old,
        createdAt: now - 3600000,
        updatedAt: now,
        pinned: false,
        incognito: false,
      },
    ],
    activeId: "conv-scroll",
    settings: {
      displayName: "yan",
      aiName: "星芒",
      showThinking: false,
      chatFontSize: "normal",
      customBaseUrl: `${UP}/v1`,
      customApiKey: "stub-key",
      upstreamModel: "stub-model",
    },
  },
  version: 1,
};

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad += 1;
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.addInitScript((snap) => {
  const req = indexedDB.open("qidao-store", 1);
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
  };
  req.onsuccess = () => {
    const tx = req.result.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(snap), "aster-app");
  };
}, snapshot);

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.split("\n")[0].slice(0, 140)));
page.on("console", (m) => {
  if (m.type() === "error" && !/ERR_BLOCKED_BY_RESPONSE|NotSameOrigin|favicon|net::ERR_|Failed to load resource/.test(m.text())) {
    errors.push("CONSOLE " + m.text().slice(0, 140));
  }
});

/** 找消息列表那个滚动容器：**最靠里、能滚**的那个 div；返回贴底距离 gap */
const metrics = () =>
  page.evaluate(() => {
    const cands = [...document.querySelectorAll("div")].filter((el) => {
      const cs = getComputedStyle(el);
      return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 40;
    });
    const el = cands.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (!el) return null;
    return {
      gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
      h: el.clientHeight,
      sh: el.scrollHeight,
    };
  });

const jumpVisible = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => (b.innerText ?? "").includes("回到最新")),
  );

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined, { timeout: 60000 });
await page.waitForTimeout(1500);

console.log("=== 1. 打开时贴在底部（垫了 18 条，列表真的能滚）===");
const start = await metrics();
check("找到了滚动容器，而且它真的能滚", Boolean(start) && start.sh > start.h + 40, JSON.stringify(start));
check(`刚进来就贴在底部（gap=${start?.gap} < 80）`, Boolean(start) && start.gap < 80);

console.log("\n=== 2. 一边流式一边看：贴底时不许掉队 ===");
await page.fill("textarea", "慢慢讲，我听着");
await page.keyboard.press("Enter");
/* 等假上游吐出前几片（说明流已经开始了） */
for (let i = 0; i < 100 && sent < 3; i += 1) await page.waitForTimeout(50);
check("流式真的开始了（假上游已吐 ≥3 片）", sent >= 3, `sent=${sent}`);

let worstGap = 0;
for (let i = 0; i < 6; i += 1) {
  const m = await metrics();
  if (m) worstGap = Math.max(worstGap, m.gap);
  await page.waitForTimeout(250);
}
check(`贴底时每一刻都在底部（最差 gap=${worstGap} < 120）`, worstGap < 120);

console.log("\n=== 3. ⭐ 中途上翻：token 还在进，界面**不许**再跟着动 ===");
/* 用真的滚轮事件（`el.scrollTop = 0` 是脚本改的，会被当成"程序滚动"，
   而且容器带 smooth 滚动时会和自动跟滚互相拉扯 —— 那不是用户的手） */
await page.mouse.move(195, 400);
await page.mouse.wheel(0, -900);
await page.waitForTimeout(250);
const up = await metrics();
check(`上翻成功（gap=${up?.gap} > 420）`, Boolean(up) && up.gap > 420);
check("右下角浮出了「回到最新」", await jumpVisible());
await page.screenshot({ path: `${SHOTS}\\stream-scrolled-up.png` });

const sentAtUp = sent;
const gapAfter = [];
for (let i = 0; i < 6; i += 1) {
  await page.waitForTimeout(300);
  const m = await metrics();
  if (m) gapAfter.push(m.gap);
}
const minGap = Math.min(...gapAfter, 1e9);
console.log(`    上翻后又来了 ${sent - sentAtUp} 片；这几秒里的 gap = ${gapAfter.join(" / ")}`);
check(`上翻之后它没把你拽回去（最小 gap=${minGap} > 300）`, minGap > 300);
check("这几秒里确实还在收 token（不是流早停了才显得没动）", sent - sentAtUp >= 3, `新增 ${sent - sentAtUp} 片`);

console.log("\n=== 4. 点「回到最新」→ 落回底部 ===");
for (let i = 0; i < 200 && sent < PIECES.length; i += 1) await page.waitForTimeout(100);
await page.getByRole("button", { name: "回到最新" }).first().click();
/* 这里是**平滑**滚动（scrollTo behavior:"smooth"），落到最底要一会儿 —— 轮询等它，别硬睡 */
let back = null;
for (let i = 0; i < 20; i += 1) {
  await page.waitForTimeout(200);
  back = await metrics();
  if (back && back.gap < 80) break;
}
check(`点完回到最底（gap=${back?.gap} < 80）`, Boolean(back) && back.gap < 80);
await page.screenshot({ path: `${SHOTS}\\stream-back-to-latest.png` });

console.log("\n=== 5. 那轮回复真的落库了（读 IndexedDB，不看 DOM）===");
const saved = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open("qidao-store", 1);
    r.onsuccess = () => res(r.result);
  });
  const raw = await new Promise((res) => {
    const g = db.transaction("kv", "readonly").objectStore("kv").get("aster-app");
    g.onsuccess = () => res(g.result);
  });
  const st = JSON.parse(raw).state;
  const conv = st.conversations.find((c) => c.id === st.activeId);
  const last = conv?.messages?.[conv.messages.length - 1];
  return { role: last?.role, len: String(last?.content ?? "").length, head: String(last?.content ?? "").slice(0, 24) };
});
check(
  "最后一条是助手、而且正文是流式攒起来的（长度 > 100）",
  saved.role === "assistant" && saved.len > 100,
  JSON.stringify(saved),
);

console.log("\n=== 6. 全程干净 ===");
check(`收到了 ${hits} 轮请求（≥1）`, hits >= 1, `hits=${hits}`);
check("没有页面报错", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
upstream.close();
console.log("--------------------------------------------------------------------------");
console.log(bad === 0 ? "全部通过（0 个失败）" : `有 ${bad} 个失败`);
process.exit(bad === 0 ? 0 : 1);
