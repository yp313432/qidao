/**
 * 验收脚本（Playwright，连 8080）：**"搜网页"在真界面上的闭环**（`web.search`）。
 *
 * 纯 node 那一半（`verify-web-tools.mjs`）测的是护栏与解析；这个脚本测**端到端**：
 *
 *   说一句"帮我搜一下…"
 *     → 断言这一轮的 tools 里**按需**带上了 `web_search`（不是全量、也不是常驻）
 *       → 假上游回一个 `web_search` 的 tool_call
 *         → 客户端过闸门真执行（`actions.ts` → `web-actions.ts` → `web-http.ts`）
 *           → 结果以 role:"tool" 回灌（下一轮请求里能看到那几条标题/链接）
 *             → 界面上「动手 N 次」点开是**那一次搜索**的人话标题，且无 pageerror
 *
 * ⚠️ 这个脚本**真的会出网**（走免 key 的 Bing RSS，就是产品里那条路）。
 * 这台机器没有外网时它会红 —— 那种情况下按"环境不行"报告，别去改断言。
 * 想跳过出网：`QIDAO_SKIP_NET=1 node verify-web-ui.mjs`（那时只验"动作被选中 + 闸门放行"）。
 *
 * 跑法（dev server 要在 8080）：
 *   node verify-web-ui.mjs
 * 截图写到 preview-shots/web-search.png（要真的看一眼）。
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const UP_PORT = 4647;
const UP_BASE = `http://127.0.0.1:${UP_PORT}`;
const SHOT = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots\\web-search.png";
const SKIP_NET = process.env.QIDAO_SKIP_NET === "1";

const log = { rounds: [] };
const ORDERS = [/帮我搜一下/, /我去搜一下/];
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
const sse = (res, frames) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
  });
  for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
};
const frame = (delta) => ({ choices: [{ index: 0, delta, finish_reason: null }] });

/** 分片的 tool_call（名字切两段 + 参数切两段）：`web_search` 这种下划线名也要拼得对 */
const QUERY = "栖岛 手机版 网页搜索";

/** 第二趟用的假 feed：**按 query 现造**，这样能证明"参数真的传到了上游" */
const fakeRss = (q) => `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>必应搜索: ${q}</title>
  <item>
    <title>栖岛·假搜索结果一（${q}）</title>
    <link>https://example.com/qidao-one</link>
    <description>这是假 feed 的摘要，用来验界面那一行。</description>
  </item>
  <item>
    <title>栖岛·假搜索结果二</title>
    <link>https://example.com/qidao-two</link>
    <description>第二条摘要。</description>
  </item>
</channel></rss>`;
const QUERY2 = "下周末天气";

function fragmentedCall(toolName, args, id) {
  const cut = Math.max(1, Math.floor(toolName.length / 2));
  const acut = Math.max(1, Math.floor(args.length / 2));
  return [
    frame({ role: "assistant", content: "我去搜一下。" }),
    frame({
      tool_calls: [
        { index: 0, id, type: "function", function: { name: toolName.slice(0, cut), arguments: "" } },
      ],
    }),
    frame({ tool_calls: [{ index: 0, function: { name: toolName.slice(cut), arguments: args.slice(0, acut) } }] }),
    frame({ tool_calls: [{ index: 0, function: { arguments: args.slice(acut) } }] }),
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ];
}

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
  log.rounds.push({ path: url.pathname, body });
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const tools = (Array.isArray(body.tools) ? body.tools : []).map((t) => t?.function?.name);
  console.log(
    `    [假上游] #${log.rounds.length} tools=${tools.length} 回灌=${msgs.filter((m) => m?.role === "tool").length}`,
  );

  /*
    ⚠️ 不能只看"有没有 role:tool" —— 这个脚本跑**两趟**，第二趟的对话历史里
    还留着第一趟那条 tool 回执，那样第二趟会被当场判定成"已经回灌过了"、
    直接收尾，于是"这一趟的搜索词"根本没往下传（第一版就是这么错的）。
    所以按**订单数 vs 工具回执数**算：这一趟发了 N 条"帮我搜一下…"，
    就该有 N 条工具回执才算这一趟真的跑完。
  */
  const orders = msgs.filter((m) => m?.role === "user" && ORDERS.some((re) => re.test(String(m?.content ?? "")))).length;
  const toolResults = msgs.filter((m) => m?.role === "tool").length;
  console.log(
    `    [假上游] #${log.rounds.length} tools=${tools.length} 订单=${orders} 工具回执=${toolResults}`,
  );

  if (toolResults < orders) {
    /*
      **回声**：搜索词从这一轮最后那条用户消息里现取（去掉"帮我搜一下"这个前缀）——
      于是"回调里的词 = 用户真说的词"这件事成了硬断言（见 M0）。
    */
    const lastUser = [...msgs].reverse().find((m) => m?.role === "user");
    /*
      ⚠️ 只取**第一行**：客户端会把「此刻的情况」那一段附在同一条 user 消息后面
      （见 `prompt.ts` 的 perceptionBlock），整条取来会把那一大段也当成搜索词。
    */
    const echoed =
      String(lastUser?.content ?? "")
        .split("\n")[0]
        .replace(/^帮我搜一下/, "")
        .trim() || QUERY;
    sse(res, fragmentedCall("web_search", JSON.stringify({ query: echoed }), `call_web_search_${toolResults + 1}`));
    return;
  }
  sse(res, [frame({ role: "assistant", content: "搜到了，我给你说说。" })]);
});

await new Promise((r) => upstream.listen(UP_PORT, "127.0.0.1", r));
console.log(`假上游（dev server 能访问）  ${UP_BASE}`);
console.log(SKIP_NET ? "⚠️ QIDAO_SKIP_NET=1：跳过「出网」那一半断言\n" : "真出网：走免 key 的 Bing RSS\n");

/* ───────────────── 浏览器 ───────────────── */

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on("pageerror", (e) => {
  pageErrors.push(e.message);
  console.log("  ⚠️ 页面报错:", e.message);
});
page.on("console", (m) => {
  if (m.type() === "error") console.log("  ⚠️ console.error:", m.text().slice(0, 160));
});

let bad = 0;
let netNote = "";
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

async function seedApp() {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined, { timeout: 60000 });
  await page.evaluate(
    async ({ base }) => {
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
        recentActions: [],
        // 「网页搜索 / 抓取」直接放行 —— 不然闸门弹卡片，脚本里没人点
        permissions: { ...parsed.state.settings.permissions, web_search: "allow" },
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
    },
    { base: `${UP_BASE}/web/v1` },
  );
}

async function say(text) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined, { timeout: 60000 });
  await page.click("textarea");
  await page.fill("textarea", text);
  await page.keyboard.press("Enter");
}

/**
 * 等到"这一趟最后一条 tool 回执"真的出现。
 *
 * ⚠️ 别用"轮数够了就往下走"：第二趟的对话历史里带着第一趟的回执，
 * 轮数到 2 的时候这一趟的工具**可能还没执行完** —— 那样读到的就是上一趟的内容
 * （第一版就是这么误判的）。所以盯的是**字数增长**这个事实，不是轮数。
 */
async function waitToolCharGrowth(from, tries = 240) {
  const base = goneCharCount();
  for (let i = 0; i < tries; i += 1) {
    if (goneCharCount() > base) return log.rounds.slice(from);
    await page.waitForTimeout(250);
  }
  return log.rounds.slice(from);
}
function goneCharCount() {
  return log.rounds
    .flatMap((r) => (Array.isArray(r.body?.messages) ? r.body.messages : []))
    .filter((m) => m?.role === "tool")
    .reduce((n, m) => n + String(m?.content ?? "").length, 0);
}

/* ═══════════ 主流程 ═══════════ */

/*
  ── 一个**如实的**观察点：网页版直连必应到底行不行 ──────────────
  在**没装拦截**的独立上下文里真发一次 fetch 到 Bing RSS，把结果如实打出来。
  这是"手机版为什么必须走原生 HTTP"的现场证据（工作簿里那张调研结论就靠它）。
  拿不到（CORS / 断网）都是**如实报告**，不算失败 —— 真值取决于这台机器的网络与浏览器策略。
*/
console.log("【0】如实看一眼：网页版从浏览器直连 Bing RSS 行不行");
{
  const ctx = await browser.newContext();
  const p0 = await ctx.newPage();
  await p0.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  const probe = await p0
    .evaluate(async () => {
      try {
        const r = await fetch("https://cn.bing.com/search?q=%E6%B5%8B%E8%AF%95&format=rss");
        const t = await r.text();
        return { ok: r.ok, status: r.status, len: t.length };
      } catch (e) {
        return { ok: false, why: String(e && e.message ? e.message : e) };
      }
    })
    .catch((e) => ({ ok: false, why: String(e.message).slice(0, 60) }));
  if (probe.ok) {
    console.log(`  ✅ 网页版直连可行：HTTP ${probe.status}，${probe.len} 字节（那手机端本来也能用）`);
  } else {
    console.log(`  ⚠️ 网页版直连拿不到：${probe.why}`);
    console.log("     → 这正是手机版走原生 HTTP（CapacitorHttp，绕开 CORS）的理由");
  }
  await ctx.close();
}
console.log("\n（1/2 两趟的 Bing 请求都在**浏览器层换成假 feed**，好让「结果回灌 + 界面显示」这半段可判；真网络能力由上面那条如实观察代表）");

/** 把 Bing 那条请求换成按 query 现造的假 feed（带 CORS 头） */
await page.route(/bing\.com\/search/, async (route) => {
  const q = new URL(route.request().url()).searchParams.get("q") ?? "";
  await route.fulfill({
    status: 200,
    headers: { "content-type": "application/rss+xml; charset=utf-8", "access-control-allow-origin": "*" },
    body: fakeRss(q),
  });
});

console.log("\n【1】「帮我搜一下栖岛手机版能不能搜网页」→ 按需带上 web_search，真执行，结果回灌");

await seedApp();
log.rounds.length = 0;
await say("帮我搜一下栖岛手机版能不能搜网页");
const rounds = await waitToolCharGrowth(0);
check("1 真的发出了请求（工具轮 + 收尾轮）", rounds.length >= 2, `实际 ${rounds.length} 轮`);

const tools0 = (rounds[0]?.body?.tools ?? []).map((t) => t?.function?.name);
check(
  "2 「搜一下」这句话**按需**带上了 web_search（不是全量、也不是常驻）",
  tools0.includes("web_search"),
  `tools=${tools0.length}：${tools0.join(",")}`,
);
check(
  "3 但**没到全量**：按需注册真的在省（这一轮不是 70 个都发）",
  tools0.length < 70,
  `实际 ${tools0.length} 个`,
);
/* 同一组一起发是**设计如此**（按组注册，宁可多给）：web.fetch 跟 web.search 同属「工具」组 */

const r2 = rounds[1]?.body?.messages ?? [];
const toolMsg = r2.find((m) => m?.role === "tool");
check("4 结果以 role:\"tool\" 回灌了（带 tool_call_id）", Boolean(toolMsg?.tool_call_id));
const content = String(toolMsg?.content ?? "");
console.log(`  ── 回灌正文（前 400 字）──\n${content.slice(0, 400)}\n`);
check("5 回灌里是**搜索结果**（标题 + http 链接），不是一句「我做不到」", /https?:\/\//.test(content), content.slice(0, 140));
check("6 结果里有标题", content.includes("栖岛·假搜索结果一"));
check("7 结果里没有密钥/授权头", !/(api[_-]?key|bearer\s|authorization)/i.test(content), "干净");

/* ── 界面：这一栏是"那一次搜索" ── */
const bodyText = await page.evaluate(() => document.body.innerText);
check("8 界面上没有「我做不到」这种否认能力的说法", !bodyText.includes("做不到"), "");

const processBtn = page.locator('button:has-text("动手")').last();
if ((await processBtn.count()) > 0) {
  await processBtn.click();
  await page.waitForTimeout(400);
}
const opened = await page.evaluate(() => document.body.innerText);
check(
  "9 「动手」那一栏点开能看到这次搜索的动作标题（`去网上搜「…」`，来自 action-meta）",
  opened.includes("去网上搜"),
  opened
    .split("\n")
    .filter((l) => l.includes("网上搜"))
    .slice(0, 2)
    .join(" | "),
);

/* ═══════════ 第二趟：换一个搜索词 —— 验"参数真的往下传 + 界面显示结果" ═══════════
 *
 * 为什么要有这一趟：光是第一趟还看不出"这个搜索词是**这一轮**传下去的"
 * （万一是上一轮的结果被复用？）。这一趟换一个词，断言回灌里就是那个新词，
 * 并且断言界面上真的能看到那几条结果。
 */
console.log("\n【2】换一个搜索词 → 验参数真的往下传 / 界面真的显示结果");
log.rounds.length = 0;
await say(`帮我搜一下${QUERY2}`);
const roundsM = await waitToolCharGrowth(0);
const toolMsgM = (roundsM[1]?.body?.messages ?? []).find((m) => m?.role === "tool");
const contentM = String(toolMsgM?.content ?? "");
console.log(`  ── 回灌正文 ──\n${contentM.slice(0, 420)}\n`);
check("M0 这一趟的搜索词跟上一趟不同（证明参数是这一轮真的传下去的）", contentM.includes(QUERY2), contentM.slice(0, 90));
check("M1 回灌里有**标题**（假 feed 的第一条）", contentM.includes("栖岛·假搜索结果一"), contentM.slice(0, 100));
check("M2 回灌里有**链接**", contentM.includes("https://example.com/qidao-one"));
check("M3 回灌里有**摘要**", contentM.includes("这是假 feed 的摘要"));
check("M4 结果里没有密钥/授权头", !/(api[_-]?key|bearer\s|authorization)/i.test(contentM));

/* 界面：点开「动手 N 次」，人话标题 + 结果那一行都在 */
const procBtn = page.locator('button:has-text("动手")').last();
if ((await procBtn.count()) > 0) {
  if (!(await page.locator("body").innerText()).includes("去网上搜")) {
    await procBtn.click();
    await page.waitForTimeout(400);
  }
}
const bodyM = await page.evaluate(() => document.body.innerText);
check(
  "M5 界面上能看到结果那一行（标题/链接出现在「动手」栏或回执里）",
  bodyM.includes("栖岛·假搜索结果一") || bodyM.includes("example.com/qidao-one"),
  bodyM
    .split("\n")
    .filter((l) => l.includes("假搜索结果") || l.includes("qidao-one"))
    .slice(0, 2)
    .join(" | "),
);
check("M6 界面这轮没有否认能力（不出现「做不到」）", !bodyM.includes("做不到"));
await page.screenshot({ path: SHOT, fullPage: false });
console.log(`  截图 → ${SHOT}`);

check("10 全程没有 pageerror", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await browser.close();
await new Promise((r) => upstream.close(r));

console.log(`\n──────── 结果 ────────`);
if (netNote) console.log(`· ${netNote}`);
if (bad) {
  console.log(`❌ 失败 ${bad} 项`);
  process.exit(1);
}
console.log("✅ 全过（按需注册 → 闸门放行 → 真执行 → 结果回灌 → 界面可读 → 无 pageerror）");
process.exit(0);
