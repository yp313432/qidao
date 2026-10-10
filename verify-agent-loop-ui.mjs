#!/usr/bin/env node
/**
 * 验收脚本（浏览器那条路）：**agent loop 在真界面上跑起来**
 *
 * 纯 node 的 `verify-agent-loop.mjs` 已经把"执行完立刻回灌 → 自动再发一次 → 上限 6 步 / 60 秒"
 * 证明过了（用的是真 loop + 真直连通道 + 假上游）。这个脚本补的是**真机那一半**：
 *
 *   · 真的页面（连 8080 上的 dev server）：发一句话 → 界面上要看得见
 *     「第 N 步 · 正在执行 X」和「动手 N 次」那颗胶囊；
 *   · 胶囊点开要能看到 `✅ ui.highlight · …`（执行结果那一栏**有回话**）；
 *   · 假上游要收到**两轮**请求，第二轮里带着 tool 结果（说明浏览器里也在同轮回灌）；
 *   · 消息要**真的落进会话**（读 IndexedDB，不看 DOM 猜）；
 *   · 全程 **0 个 pageerror**。
 *
 * 假上游只监听 127.0.0.1 的**临时端口**（不碰 8080）；截图写 preview-shots/。
 *
 * 跑法（dev server 要在 8080）：
 *   node verify-agent-loop-ui.mjs
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/** 每一轮收到的请求体（断言"第二轮里有没有 tool 结果"就看它） */
const sawRequests = [];
let hits = 0;

const frame = (delta) => ({ choices: [{ index: 0, delta, finish_reason: null }] });
const callFrame = (part) => frame({ tool_calls: [part] });

function sse(res, frames) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
  });
  for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

const upstream = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  const body = await readBody(req);
  let parsed = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    /* ignore */
  }
  hits += 1;
  sawRequests.push(parsed);
  const toolCount = (Array.isArray(parsed.messages) ? parsed.messages : []).filter(
    (m) => m?.role === "tool",
  ).length;
  console.log(
    `    [假上游] #${hits} tools=${Array.isArray(parsed.tools) ? parsed.tools.length : 0} messages=${
      (parsed.messages ?? []).length
    } tool结果=${toolCount}`,
  );

  if (hits === 1) {
    // 第一轮：回一个**分片**的 tool_call（跟真实中转一个形状）
    sse(res, [
      frame({ role: "assistant", content: "好，我先把「验收」这两个字标一下。" }),
      callFrame({ index: 0, id: "call_ui_hl", type: "function", function: { name: "ui_h", arguments: "" } }),
      callFrame({ index: 0, function: { name: "ighlight", arguments: '{"te' } }),
      callFrame({ function: { arguments: 'xt":"验' } }),
      callFrame({ function: { arguments: '收"}' } }),
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);
    return;
  }
  // 第二轮：故意慢一点，好让"第 1 步 · 正在执行"那一行在截图上留得住
  await new Promise((r) => setTimeout(r, 1200));
  sse(res, [frame({ role: "assistant", content: "已经标好了，你往上看看那两个字。" })]);
});

await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const UP_BASE = `http://127.0.0.1:${upstream.address().port}`;
console.log(`假上游（dev server 与浏览器都能访问）  ${UP_BASE}\n`);

/* ───────────────── 浏览器 ───────────────── */

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad += 1;
};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on("pageerror", (e) => {
  pageErrors.push(e.message);
  console.log("  ⚠️ pageerror:", e.message);
});

async function waitInteractive() {
  await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined, {
    timeout: 60000,
  });
}

/** 把"自定义上游 + 强制原生 tools + 高亮放行"写进库，并清掉旧对话 */
async function seed() {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive();
  await page.evaluate(async (base) => {
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
      customBaseUrl: `${base}/v1`,
      customApiKey: "stub-key",
      upstreamModel: "stub-model",
      toolProtocol: "native",
      toolProbeOk: true,
      toolCatalog: "auto",
      permissions: { ...parsed.state.settings.permissions, highlight: "allow" },
    };
    parsed.state.conversations = [];
    parsed.state.activeId = null;
    parsed.state.pendingActions = [];
    parsed.state.actionLog = [];
    await new Promise((res) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
      tx.oncomplete = res;
    });
  }, UP_BASE);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive();
}

/** 读库里最后一条助手消息（"真的落进会话"要这么看，不看 DOM 猜） */
async function lastAssistant() {
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
    const st = JSON.parse(raw).state;
    const conv = st.conversations.find((c) => c.id === st.activeId);
    const last = conv?.messages?.[conv.messages.length - 1];
    return last ? JSON.parse(JSON.stringify(last)) : null;
  });
}

console.log("【一】浏览器里真跑一轮（假上游：第一轮回 tool_calls，第二轮回最终回答）");
await seed();
await page.fill("textarea", "把「验收」两个字高亮一下");
await page.keyboard.press("Enter");

/** 「第 N 步 · 正在执行 X」——这是用户"这一轮里看得见"的那一行 */
let sawStep = false;
for (let i = 0; i < 60 && !sawStep; i += 1) {
  sawStep = await page.evaluate(() => document.body.innerText.includes("第 1 步 · 正在执行"));
  if (!sawStep) await page.waitForTimeout(100);
}
check("① 界面上出现了「第 1 步 · 正在执行 ui_highlight」（同轮可见）", sawStep);
if (sawStep) await page.screenshot({ caret: "initial", path: `${SHOTS}\\agent-loop-step.png` });

/** 等最终回答落库 */
let msg = null;
for (let i = 0; i < 120; i += 1) {
  msg = await lastAssistant();
  if (msg && String(msg.content).includes("已经标好了")) break;
  await page.waitForTimeout(250);
}
check(
  "② 最终回答**真的落进会话**（读的是 IndexedDB，不是 DOM）",
  Boolean(msg && String(msg.content).includes("已经标好了")),
  JSON.stringify(String(msg?.content ?? "").slice(0, 80)),
);
check(
  "③ 那一轮的动作记录也存进了这条消息（事后回看得到他干了什么）",
  Array.isArray(msg?.rounds) && msg.rounds.length === 1 && msg.rounds[0].calls[0]?.name === "ui_highlight",
  JSON.stringify(msg?.rounds ?? null).slice(0, 160),
);
check(
  "④ 每一步都有可见回话（notice 是 ✅ + 动作名）",
  String(msg?.rounds?.[0]?.calls?.[0]?.notice ?? "").startsWith("✅") &&
    String(msg?.rounds?.[0]?.calls?.[0]?.notice ?? "").includes("ui.highlight"),
  JSON.stringify(msg?.rounds?.[0]?.calls?.[0]?.notice ?? null),
);

console.log("\n【二】回灌：假上游收到两轮，第二轮里带着 tool 结果");
check(
  "⑤ 假上游被请求了 ≥2 次（执行完立刻又发了一次，不是等下一轮）",
  hits >= 2,
  `共 ${hits} 轮`,
);
const r2msgs = sawRequests[1]?.messages ?? [];
const r2tool = r2msgs.filter((m) => m?.role === "tool");
check(
  "⑥ 第二轮请求里带了 role:\"tool\" 的结果消息，内容含真实执行结果",
  r2tool.length === 1 && String(r2tool[0].content).includes("已高亮"),
  JSON.stringify(r2tool.map((m) => m.content)).slice(0, 160),
);

console.log("\n【三】「执行结果」那一栏（动手 N 次那颗胶囊）");
let capsule = false;
try {
  await page.getByRole("button", { name: /动手 \d+ 次/ }).first().waitFor({ timeout: 15000 });
  capsule = true;
} catch {
  capsule = false;
}
check("⑦ 回复下面有「动手 N 次」那颗胶囊", capsule);
if (capsule) {
  await page.getByRole("button", { name: /动手 \d+ 次/ }).first().click();
  const text = await page.evaluate(() => document.body.innerText);
  check(
    "⑧ 点开能看到那一行回话（✅ ui.highlight · 已高亮…）",
    text.includes("✅ ui.highlight") && text.includes("已高亮"),
    text
      .split("\n")
      .filter((l) => l.includes("✅") || l.includes("ui.highlight"))
      .join(" | ")
      .slice(0, 160),
  );
  check("⑨ 明细里没有 undefined（权限名没对错）", !/undefined/.test(text));
  await page.screenshot({ caret: "initial", path: `${SHOTS}\\agent-loop.png` });
}

console.log("\n【四】干净度");
check("⑩ 全程 0 个 pageerror", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

console.log("-".repeat(64));
console.log(`agent loop 真机验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
await browser.close();
upstream.close();
process.exit(bad === 0 ? 0 : 1);
