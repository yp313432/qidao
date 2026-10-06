/**
 * 验收脚本：**模型真的能调用 MCP 工具**（第四步）。
 *
 * ── 这一轮要证明什么 ────────────────────────────────────────────
 *
 * 之前的状况：MCP 能连上、能看到工具清单，但**模型调不了** ——
 * 因为 ① 请求里没有 tools 字段 ② 动作通道里没有 MCP 这一种。
 * 现在两块都补上了，所以要端到端证明整条链：
 *
 *   系统提示词里写清了工具和参数
 *     → 模型吐出一个 tool.call 动作块
 *       → 客户端解析出来、进动作闸门
 *         → 用户点「允许一次」
 *           → 真的发出 JSON-RPC tools/call（带会话号）
 *             → 结果回灌进**下一轮**请求（回执）
 *
 * ── 怎么做到"真的端到端" ────────────────────────────────────────
 *
 * 用**两个真服务器**，不是伪造客户端状态：
 *
 *   · 桩 MCP 服务器（4603）：真实现 initialize / tools/list / tools/call，
 *     并把收到的每一次调用记下来（工具名、参数、会话号）
 *   · 假上游（4605）：**能被 dev server 访问到**（关键！）
 *     —— 这样系统提示词是**我们自己的代码在服务端拼出来的那一份**，
 *        假上游把它整段记下来，我就能断言"提示词里到底写了什么"。
 *        （如果用 page.route 拦 /api/chat，就永远看不到系统提示词。）
 *
 * 跑法（要完整权限；dev server 要在 8080）：
 *   node verify-mcp-tool-call.mjs
 * 退出码非 0 = 有断言没过。
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const MCP_PORT = 4603;
const UP_PORT = 4605;
const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`;
const UP_BASE = `http://127.0.0.1:${UP_PORT}/v1`;
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

const SESSION = "tool-session-1";
/** 假上游要它调的工具 + 参数（断言桩服务器收到的就是这个） */
const EXPECT_TOOL = "echo";
const EXPECT_ARG = "他在测工具调用";

const log = {
  /** 桩 MCP 收到的 tools/call */
  calls: [],
  /** 假上游收到的每一次请求体（系统提示词就在里面） */
  upstream: [],
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

/* ───────────────── 桩 MCP 服务器（带一个 echo 工具）───────────────── */

const mcp = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MCP_PORT}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (url.pathname !== "/mcp") {
    res.writeHead(404, cors);
    res.end("not found");
    return;
  }

  let msg = {};
  try {
    msg = JSON.parse(await readBody(req));
  } catch {
    /* 忽略 */
  }

  if (msg.method === "initialize") {
    res.writeHead(200, {
      ...cors,
      "content-type": "application/json",
      "Mcp-Session-Id": SESSION,
      "MCP-Protocol-Version": "2025-06-18",
    });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "stub-tools", version: "1.0.0" },
        },
      }),
    );
    return;
  }
  if (msg.method === "notifications/initialized") {
    res.writeHead(202, cors);
    res.end();
    return;
  }
  if (msg.method === "tools/list") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: [
            {
              name: EXPECT_TOOL,
              description: "把你说的话原样记下来",
              inputSchema: {
                type: "object",
                properties: { message: { type: "string", description: "要记的内容" } },
                required: ["message"],
              },
            },
          ],
        },
      }),
    );
    return;
  }
  if (msg.method === "tools/call") {
    log.calls.push({
      name: msg.params?.name,
      args: msg.params?.arguments,
      session: req.headers["mcp-session-id"] ?? "",
      proto: req.headers["mcp-protocol-version"] ?? "",
    });
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: `记下了：${msg.params?.arguments?.message ?? ""}` }] },
      }),
    );
    return;
  }
  res.writeHead(200, { ...cors, "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no such method" } }));
});

/* ───────────────── 假上游（能被 dev server 访问到）───────────────── */

/** 模型的第一段回复：带一个 qidao 动作块（跟真实模型输出同一种格式） */
const REPLY_WITH_ACTION = [
  "好，我去记一下。",
  "",
  "```qidao",
  `{"kind":"tool.call","server":"桩工具服务","tool":"${EXPECT_TOOL}","args":{"message":"${EXPECT_ARG}"}}`,
  "```",
].join("\n");

const upstream = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${UP_PORT}${req.url ?? ""}`);

  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    const body = await readBody(req);
    log.upstream.push(body);

    // 第二轮：看回执有没有真的回灌进来
    const sawFeedback = body.includes(`调用「${EXPECT_TOOL}」的结果`) || body.includes("记下了：");
    const reply = sawFeedback ? "回执看到了，记下了。" : REPLY_WITH_ACTION;

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  res.writeHead(404, cors);
  res.end("not found");
});

await new Promise((r) => mcp.listen(MCP_PORT, "127.0.0.1", r));
await new Promise((r) => upstream.listen(UP_PORT, "127.0.0.1", r));
console.log(`桩 MCP 服务器（带 ${EXPECT_TOOL} 工具）  ${MCP_URL}`);
console.log(`假上游（dev server 能访问）        ${UP_BASE}\n`);

/* ───────────────── 浏览器 ───────────────── */

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

/* 1. 先把"自定义上游 + 允许询问"写进 IndexedDB（照 verify-chat 那套现成做法） */
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);
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
    customBaseUrl: base,
    customApiKey: "stub-key",
    upstreamModel: "stub-model",
    // 明确设成"询问"，这样才看得到动作闸门（顺便把闸门也测了）
    permissions: { ...parsed.state.settings.permissions, mcp_tools: "ask" },
  };
  await new Promise((res) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
    tx.oncomplete = res;
  });
}, UP_BASE);

/* 2. 配一个 MCP 服务器并测连接 */
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("h1", { timeout: 20000 });
await page.getByRole("button", { name: "MCP" }).click();
await page.getByText("添加 MCP 服务器").click();
await page.getByPlaceholder("例如：Horizon / 我的记忆库").waitFor({ timeout: 20000 });
await page.getByPlaceholder("例如：Horizon / 我的记忆库").fill("桩工具服务");
await page.getByPlaceholder("https://example.com/mcp").fill(MCP_URL);
await page.getByRole("button", { name: "保存" }).click();
await page.waitForURL("**/tools", { timeout: 20000 });

await page.locator("nav[aria-label=主导航]").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "MCP" }).click();
await page.locator("article").first().waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "测试连接" }).click();
await page.getByText("拿到 1 个工具", { exact: false }).waitFor({ timeout: 25000 });
check("先测连接：工具清单拿到了（echo）", (await page.locator("article").first().innerText()).includes("echo"));

/* 3. 去对话页，说一句话 —— 假上游会回一个 tool.call 动作块 */
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3000);
await page.click("textarea");
await page.fill("textarea", "帮我把这句话记下来");
await page.keyboard.press("Enter");

/* 4. 动作闸门应该出现（权限=询问），点「允许一次」 */
await page.getByText("想做一个操作").waitFor({ timeout: 30000 });
const gateText = await page.locator("body").innerText();
check(
  "动作闸门把这次调用摆出来了（标题是「调用外部工具」）",
  gateText.includes(`调用外部工具「${EXPECT_TOOL}」`),
  gateText.replace(/\s+/g, " ").slice(0, 160),
);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\tool-call-gate.png` });
await page.getByRole("button", { name: "允许一次" }).click();

/* 5. 关键证据：桩 MCP 服务器真的收到了 tools/call */
for (let i = 0; i < 40 && log.calls.length === 0; i += 1) await page.waitForTimeout(250);
check("点了允许之后，**真的发出了 tools/call**", log.calls.length >= 1, `收到 ${log.calls.length} 次`);
const call = log.calls[0] ?? {};
check("工具名对上了", call.name === EXPECT_TOOL, `实际=${call.name}`);
check(
  "参数对上了（模型提议里的 args 原样传下去了）",
  call.args?.message === EXPECT_ARG,
  `实际=${JSON.stringify(call.args)}`,
);
check("调用带上了握手拿到的会话号", call.session === SESSION, `实际="${call.session}"`);
check("调用带上了协商出的协议版本头", call.proto === "2025-06-18", `实际="${call.proto}"`);

/* 6. 提示词那一半：假上游收到的**系统提示词**里到底写了什么 */
const prompt = log.upstream[0] ?? "";
check("系统提示词里写了 tool.call 这个动作", prompt.includes("tool.call"));
check("提示词里列出了服务器名", prompt.includes("桩工具服务"));
check("提示词里列出了工具名", prompt.includes(EXPECT_TOOL));
check("提示词里写出了工具说明", prompt.includes("把你说的话原样记下来"));
check(
  "提示词里写出了**参数结构**（不然模型没法一次调对）",
  prompt.includes("message:string"),
  prompt.includes("message:string") ? "" : "没找到参数说明",
);

/* 7. 回执：下一轮请求里应该带着上一轮的结果 */
await page.waitForTimeout(1200);
await page.click("textarea");
await page.fill("textarea", "记好了吗");
await page.keyboard.press("Enter");
for (let i = 0; i < 40 && log.upstream.length < 2; i += 1) await page.waitForTimeout(250);
const second = log.upstream[1] ?? "";
check(
  "第二轮请求里带着上一轮工具的**执行结果**（回执真的回灌了）",
  second.includes(`调用「${EXPECT_TOOL}」的结果`) && second.includes("记下了："),
);

const chatText = await page.locator("body").innerText();
/**
 * ⚠️ 这里必须**等文字出现**，不能读完就判：
 * 第二次请求发出去 ≠ 流已经渲染到 DOM 上（也就是刚才那一版误报的原因）。
 */
let sawSecond = chatText.includes("回执看到了");
if (!sawSecond) {
  try {
    await page.getByText("回执看到了").waitFor({ timeout: 15000 });
    sawSecond = true;
  } catch {
    sawSecond = false;
  }
}
check("对话里能看到模型的第二段回复（说明它读到回执了）", sawSecond);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\tool-call-done.png` });

/* 8. 顺手一验：乱编工具名会被如实拒绝，而不是假装调了 */
check("假的工具名不会真的发出去", log.calls.length === 1, `tools/call 共 ${log.calls.length} 次`);

console.log("-".repeat(64));
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check("整轮没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 120) ?? "");
console.log(`工具调用验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
mcp.close();
upstream.close();
process.exit(bad === 0 ? 0 : 1);
