/**
 * 验收脚本：**P4 —— 整轮预算口径 + 对话滚动摘要**。
 *
 * ── 这一轮要证明什么 ────────────────────────────────────────────
 *
 * 用户拍板的两条：
 *   "欧克按你的来，修正加摘要"（先修预算口径、再做摘要）
 *   "ai 写…摘要我也要能看见和编辑，就是屏幕总结完出现一条线，展开就是摘要"
 *
 * 所以要端到端证明 **五件事**：
 *   ① 长对话真的**触发**了摘要（AI 写），而且**摘要请求里没有工具、没有历史**（只是一次小请求）
 *   ② 摘要**落库**并出现在对话里 —— 顶部那条线（可展开）
 *   ③ 摘要**替代了原文**：之后的请求里，被吸收的那些消息**不再出现在 messages 里**
 *   ④ 那条线**能改、能删**（用户明确要求能编辑）
 *   ⑤ 短对话**不会**触发（不能每轮都白花一次调用）
 *
 * 跑法（要完整权限；dev server 要在 8080）：
 *   node verify-summary.mjs
 * 退出码非 0 = 有断言没过。
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const UP_PORT = 4644;
const UP_BASE = `http://127.0.0.1:${UP_PORT}`;
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

/** 假上游收到的每一次请求（摘要那次的提示词、以及后续轮次的 messages 都在里面） */
const log = { rounds: [] };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

const frame = (delta) => ({ choices: [{ index: 0, delta, finish_reason: null }] });

/** 假的"摘要"返回 —— 故意写成**只记事实**的样子（真实模型应该类似） */
const FAKE_SUMMARY =
  "· 聊了工作上的烦心事，他想先解决能控制的那一半 · 他喜欢喝美式 · 约好明天十点提醒他开会 · 情绪偏低，别催";

/**
 * 这轮请求是不是"摘要请求"？
 *
 * ⚠️ 判据看**用户消息**，不看系统提示词 —— 摘要提示词是当成 user 消息发出去的
 * （`summarizeBatch` 里就是 `[{ role: "user", content: opts.prompt }]`），
 * 而 `assembleMessages` 拼出来的系统提示词里**没有**这句话。
 * 第一版看错了字段，于是「摘要明明成功了」却被判成没发（假红）。
 */
const isSummaryRequest = (body) =>
  (body?.messages ?? []).some((m) => String(m.content ?? "").includes("把下面这段对话压成一份"));
const upstream = createServer(async (req, res) => {
  const url = new URL(req.url, `${UP_BASE}${req.url ?? ""}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
    return;
  }
  if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
    res.writeHead(404, cors);
    res.end("not found");
    return;
  }

  const raw = await readBody(req);
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  log.rounds.push({ body });

  const sys = typeof body.messages?.[0]?.content === "string" ? body.messages[0].content : "";
  const isSummary = isSummaryRequest(body) || sys.includes("把下面这段对话压成一份");
  console.log(
    `    [假上游] #${log.rounds.length} ${isSummary ? "摘要请求" : "正常一轮"} ` +
      `tools=${Array.isArray(body.tools) ? body.tools.length : 0} messages=${body.messages?.length ?? 0}`,
  );

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
  });
  const text = isSummary ? FAKE_SUMMARY : "嗯，我听着呢。";
  res.write(`data: ${JSON.stringify(frame({ role: "assistant", content: text }))}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
});

await new Promise((r) => upstream.listen(UP_PORT, "127.0.0.1", r));
console.log(`假上游（dev server 能访问）  ${UP_BASE}\n`);

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleErrors = [];
page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

async function waitInteractive(p) {
  await p.waitForFunction(() => document.documentElement.dataset.theme !== undefined, {
    timeout: 60000,
  });
}

/**
 * 造一条**长对话**：40 轮、每轮各 ~200 字。
 * 实测这样的历史约 8000 token，会超过"留给历史的 80%"触发线 → 该摘了。
 */
function longConversation() {
  const msgs = [];
  for (let i = 1; i <= 40; i += 1) {
    msgs.push({
      id: `mu${i}`,
      role: "user",
      content: `第 ${i} 轮：今天工作上的事还是有点烦，${"我想先说说能自己控制的那一部分，别的先放着".repeat(3)}`,
      thinking: "",
      thinkingDurationMs: 0,
      createdAt: i * 10,
    });
    msgs.push({
      id: `ma${i}`,
      role: "assistant",
      content:
        `第 ${i} 轮我回你：${"先把事情拆成两半，能决定的先走一小步，不能决定的别拿它耗自己。".repeat(4)}`,
      thinking: "",
      thinkingDurationMs: 0,
      createdAt: i * 10 + 1,
    });
  }
  return msgs;
}

async function seed({ messages, summary, budget = 12000, keepRecent = 16 }) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive(page);
  await page.evaluate(
    async ({ base, msgs, sum, bud, keep }) => {
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
        customBaseUrl: base,
        customApiKey: "stub-key",
        upstreamModel: "stub-model",
        toolProtocol: "native",
        toolProbeOk: true,
        toolCatalog: "auto",
        contextBudget: bud,
        keepRecent: keep,
        autoCompact: true,
        compactAt: 80,
      };
      parsed.state.conversations = [
        {
          id: "conv_sum",
          title: "验收",
          messages: msgs,
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          incognito: false,
          ...(sum ? { summary: sum } : {}),
        },
      ];
      parsed.state.activeId = "conv_sum";
      parsed.state.pendingActions = [];
      parsed.state.actionLog = [];
      await new Promise((res) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
        tx.oncomplete = res;
      });
    },
    { base: `${UP_BASE}/v1`, msgs: messages, sum: summary, bud: budget, keep: keepRecent },
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitInteractive(page);
}


async function readConv() {
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
    return st.conversations.find((c) => c.id === "conv_sum") ?? null;
  });
}

/* ═══════════ 一、短对话：不该触发 ═══════════ */

console.log("【一】短对话不该触发摘要（不能每轮白花一次调用）");
log.rounds.length = 0;
await seed({ messages: longConversation().slice(0, 6) });
await page.click("textarea");
await page.fill("textarea", "在吗");
await page.keyboard.press("Enter");
await page.waitForTimeout(6000);
const shortConv = await readConv();
check("短对话没有产生摘要", !shortConv?.summary?.text, shortConv?.summary?.text ?? "");
check("短对话也没发出「摘要请求」", !log.rounds.some((r) => isSummaryRequest(r.body)), `共 ${log.rounds.length} 次请求`);

/* ═══════════ 二、长对话：真的触发、AI 写、落库 ═══════════ */

console.log("\n【二】长对话触发摘要");
log.rounds.length = 0;
await seed({ messages: longConversation() });
await page.click("textarea");
await page.fill("textarea", "继续说");
await page.keyboard.press("Enter");

/** 等它摘完（摘要是一次额外的请求 + 落库） */
let summaryReq = null;
for (let i = 0; i < 120; i += 1) {
  summaryReq = log.rounds.find((r) => isSummaryRequest(r.body));
  if (summaryReq) break;
  await page.waitForTimeout(250);
}
check("① 真的发出了一次「摘要请求」（AI 写）", Boolean(summaryReq), `共 ${log.rounds.length} 次请求`);

if (summaryReq) {
  const b = summaryReq.body;
  check("摘要请求**没有带工具**（它不是「动手」，是压缩）", !b.tools || b.tools.length === 0);
  check(
    "摘要请求**没有带对话历史**（只有那一段提示词）",
    (b.messages?.length ?? 0) <= 2,
    `messages=${b.messages?.length}`,
  );
  const prompt = String(b.messages?.map((m) => m.content).join("\n") ?? "");
  check("提示词里明确「只写事实、不许编」", /不许写的|宁可漏，别编/.test(prompt));
  check("提示词里带上了要压缩的原文", /第 1 轮/.test(prompt), "");
}

/** 等摘要落库 */
let conv = null;
for (let i = 0; i < 40; i += 1) {
  conv = await readConv();
  if (conv?.summary?.text) break;
  await page.waitForTimeout(250);
}
check("② 摘要**落库**了", Boolean(conv?.summary?.text), JSON.stringify(conv?.summary ?? null).slice(0, 120));
check(
  "摘要内容来自模型（不是我编的默认值）",
  (conv?.summary?.text ?? "").includes("美式") || (conv?.summary?.text ?? "").includes("烦心事"),
  (conv?.summary?.text ?? "").slice(0, 90),
);
check("摘要记了「吸收了 N 条」", (conv?.summary?.covered ?? 0) > 0, `covered=${conv?.summary?.covered}`);
check(
  "算了「省了多少 token」（原文 > 摘要）",
  (conv?.summary?.sourceTokens ?? 0) > (conv?.summary?.tokens ?? 0),
  `原文 ${conv?.summary?.sourceTokens} → 摘要 ${conv?.summary?.tokens}`,
);

/* ═══════════ 三、界面那条线（可展开、可改、可删） ═══════════ */

console.log("\n【三】对话里那条「更早的对话（摘要）」线");
let lineVisible = false;
try {
  await page.getByRole("button", { name: /更早的对话（摘要/ }).first().waitFor({ timeout: 15000 });
  lineVisible = true;
} catch {
  lineVisible = false;
}
check("③ 对话顶部出现了那条线", lineVisible);
/**
 * 截图必须**滚到最顶** —— 那条线挂在消息列表的**第一项**，
 * 长对话默认停在底部，直接截会拍到一片对话、看不到它（第一版就截了个空的 —— 看图才发现）。
 */
await page.evaluate(() => {
  const scroller = document.querySelector("ol")?.parentElement;
  if (scroller) scroller.scrollTop = 0;
});
await page.waitForTimeout(400);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\summary-line.png` });

if (lineVisible) {
  await page.getByRole("button", { name: /更早的对话（摘要/ }).first().click();
  await page.waitForTimeout(300);
  /** 展开的样子也要拍下来看（用户要的就是「点开能看到摘要」） */
  await page.screenshot({ caret: "initial", path: `${SHOTS}\\summary-expanded.png` });
  const expanded = await page.evaluate(() => document.body.innerText);
  check("④ 点开能看到摘要正文", expanded.includes("美式") || expanded.includes("烦心事"));
  check("④b 点开能看见「省了多少 token」的说明", /省了?约?\s*\d+\s*token/.test(expanded));

  /** 能改：点「改一下」→ 填新文本 → 保存 → 库里变了 */
  await page.getByRole("button", { name: "改一下" }).click();
  const box = page.getByLabel("编辑摘要");
  await box.waitFor({ timeout: 10000 });
  await box.fill("（我自己改的摘要）他喜欢美式，明天十点开会。");
  // ⚠️ 页面上还有"保存为文档"那些按钮，所以必须 exact（第一版没写 exact，匹配到 42 个）
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await page.waitForTimeout(800);
  const edited = await readConv();
  check(
    "⑤ 摘要**能编辑**（用户明确要求）",
    (edited?.summary?.text ?? "").includes("我自己改的"),
    (edited?.summary?.text ?? "").slice(0, 60),
  );
  await page.screenshot({ caret: "initial", path: `${SHOTS}\\summary-edited.png` });

  /** 能删 */
  await page.getByRole("button", { name: "删掉" }).click();
  await page.waitForTimeout(800);
  const cleared = await readConv();
  check("⑥ 摘要**能删**（删掉就退回「整条丢」）", !cleared?.summary?.text);
}

/* ═══════════ 四、摘要真的替代了原文 ═══════════ */

console.log("\n【四】摘要替代原文（被吸收的那些不再发出去）");
log.rounds.length = 0;
await seed({
  messages: longConversation(),
  summary: {
    text: "（既定摘要）他喜欢美式，第 1~24 轮聊的是工作上的烦心事。",
    upToIndex: 48,
    covered: 48,
    tokens: 40,
    sourceTokens: 4800,
    updatedAt: Date.now(),
  },
});
await page.click("textarea");
await page.fill("textarea", "刚说到哪了");
await page.keyboard.press("Enter");
for (let i = 0; i < 80 && log.rounds.length < 1; i += 1) await page.waitForTimeout(250);
const sent = log.rounds[0]?.body ?? {};
const msgs = Array.isArray(sent.messages) ? sent.messages : [];
const joined = msgs.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
console.log(
  `    [调试] ${msgs.length} 条；前 3 条 role = ${msgs.slice(0, 3).map((m) => m.role).join(",")}；` +
    `含「摘要」字样的条数 = ${msgs.filter((m) => String(m.content).includes("摘要")).length}`,
);
check(
  "⑦ 摘要进了请求（在最前面，标明原文已不再带上）",
  msgs.some((m) => String(m.content).includes("更早的对话（摘要")),
  msgs[0] ? String(msgs[0].content).slice(0, 60) : "没有第一条",
);
check(
  "⑧ 被摘要吸收的原文**没有**再发出去（第 1 轮不该出现）",
  !joined.includes("第 1 轮："),
  joined.includes("第 1 轮：") ? "第 1 轮还在发 —— 水位线没生效" : `共 ${msgs.length} 条 messages`,
);
check(
  "⑨ 最近的那些**还在**（不能把近的也摘没了）",
  joined.includes("第 40 轮"),
  "",
);

/* ═══════════ 五、干净度 ═══════════ */

console.log("\n【五】干净度");
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check("⑩ 整轮没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 120) ?? "");
const NOISE = /Failed to load resource|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|Failed to fetch|Extensions|favicon/i;
const badErrors = consoleErrors.filter((t) => !NOISE.test(t));
check("⑪ 控制台没有 app 自己的报错", badErrors.length === 0, badErrors.slice(0, 2).join(" | ").slice(0, 160));

console.log("-".repeat(64));
console.log(`摘要验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
upstream.close();
process.exit(bad === 0 ? 0 : 1);
