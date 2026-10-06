/**
 * 验收脚本：**模型调用"自己配的 HTTP 接口"**（`http.call`）。
 *
 * 以前 HTTP 工具只能人点「调用」—— 用户的原话是"不然就是一个摆设"。
 * 现在模型也能调，但跟 MCP 那条**故意分成两种动作**（权限不同、参数的来源也不同）：
 *
 *   · MCP：权限落 `mcp_tools`，参数结构是**服务端给的**
 *   · HTTP：权限落 `http_tools`，参数是**从用户配好的请求里推出来的**
 *     （GET 看网址的查询参数、POST/PUT 看请求体顶层键 —— 见 lib/http-tools.ts）
 *
 * 这个脚本要证明的是：
 *   ① 提示词里列出了这些工具、以及**哪几个值可以改**
 *   ② 闸门弹的是「调用 HTTP 工具」那项权限（不是 MCP 那项）
 *   ③ 参数**真的合进了请求**：GET 拼到网址上、且原有参数没被弄丢
 *   ④ POST 是**浅合并**进请求体，不是整个替换
 *   ⑤ 请求体不是 JSON 对象时**明确拒绝**，而不是偷偷丢掉参数
 *   ⑥ 结果下一轮回灌给模型（回执）
 *   ⑦ 手动点「调用」那条路**行为没变**（不带参数 = 按配置原样发）
 *
 * 跑法（要完整权限；dev server 要在 8080）：
 *   node verify-http-tool-call.mjs
 */
import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const TARGET_PORT = 4611;
const UP_PORT = 4612;
const TARGET = `http://127.0.0.1:${TARGET_PORT}`;
const UP_BASE = `http://127.0.0.1:${UP_PORT}/v1`;
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

const GET_TOOL = "查天气桩";
const POST_TOOL = "下单桩";
const NONJSON_TOOL = "文本桩";

/** 桩接口收到的每一次请求 */
const seen = [];
/** 假上游收到的请求体 */
const upstream = [];

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

/* ── 桩 HTTP 接口：把收到的请求原样记下来 ── */

const target = createServer(async (req, res) => {
  const url = new URL(req.url, TARGET);
  const body = await readBody(req);
  seen.push({
    path: url.pathname,
    method: req.method,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
    contentType: req.headers["content-type"] ?? "",
    auth: req.headers.authorization ?? "",
  });
  res.writeHead(200, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
  });
  res.end(JSON.stringify({ ok: true, got: { path: url.pathname, query: Object.fromEntries(url.searchParams.entries()), body } }));
});

/* ── 假上游（dev server 能访问到 → 提示词是服务端真拼的那份）── */

const REPLY_WITH_ACTIONS = [
  "行，我去查 / 去下单看看。",
  "",
  "```qidao",
  `{"kind":"http.call","tool":"${GET_TOOL}","args":{"city":"杭州"}}`,
  "```",
  "",
  "```qidao",
  `{"kind":"http.call","tool":"${POST_TOOL}","args":{"qty":9}}`,
  "```",
  "",
  "```qidao",
  `{"kind":"http.call","tool":"${NONJSON_TOOL}","args":{"x":1}}`,
  "```",
].join("\n");

const upstreamServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${UP_PORT}`);
  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
    return;
  }
  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    const body = await readBody(req);
    upstream.push(body);
    const sawFeedback = body.includes(`调用「${GET_TOOL}」的结果`);
    const reply = sawFeedback ? "回执看到了。" : REPLY_WITH_ACTIONS;
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
  res.writeHead(404, { "content-type": "application/json" });
  res.end("{}");
});

await new Promise((r) => target.listen(TARGET_PORT, "127.0.0.1", r));
await new Promise((r) => upstreamServer.listen(UP_PORT, "127.0.0.1", r));
console.log(`桩 HTTP 接口   ${TARGET}`);
console.log(`假上游          ${UP_BASE}\n`);

/* ── 浏览器 ── */

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

/** 配一条 HTTP 工具（走真实的 UI：独立编辑页） */
async function addHttpTool({ name, method, url, body, description }) {
  await page.goto(`${BASE}/tools/http`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByPlaceholder("例如：查天气").waitFor({ timeout: 20000 });
  await page.getByPlaceholder("例如：查天气").fill(name);
  if (description) await page.getByPlaceholder("这个工具是干什么的").fill(description);
  await page.getByRole("button", { name: method, exact: true }).click();
  await page.getByPlaceholder("https://...").fill(url);
  if (body) await page.getByPlaceholder('{\n  "key": "value"\n}').fill(body);
  await page.getByRole("button", { name: "保存" }).click();
  await page.waitForURL("**/tools", { timeout: 20000 });
  await page.locator("nav[aria-label=主导航]").waitFor({ timeout: 20000 });
}

/* 1. 先把自定义上游写进 IndexedDB，并准备三条工具 */
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
    permissions: { ...parsed.state.settings.permissions, http_tools: "ask" },
    // 清掉示例工具，避免干净的断言
    customBaseUrlSet: true,
  };
  parsed.state.httpTools = [];
  await new Promise((res) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
    tx.oncomplete = res;
  });
}, UP_BASE);

await addHttpTool({
  name: GET_TOOL,
  method: "GET",
  url: `${TARGET}/weather?city=hangzhou&units=metric`,
  description: "桩天气接口（演示用）",
});
await addHttpTool({
  name: POST_TOOL,
  method: "POST",
  url: `${TARGET}/order`,
  body: '{"item":"咖啡","qty":1}',
  description: "桩下单接口（演示用）",
});
await addHttpTool({
  name: NONJSON_TOOL,
  method: "POST",
  url: `${TARGET}/plain`,
  body: "这不是 JSON，只是纯文本",
  description: "故意配成非 JSON 请求体",
});

/* 2. 列表上应该能看出"哪几个值可以被改" */
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.locator("nav[aria-label=主导航]").waitFor({ timeout: 20000 });
const listText = await page.locator("body").innerText();
check(
  "工具卡片上标出了「可改参数」（GET 从网址里推导）",
  listText.includes("可改参数：city、units"),
  "city、units",
);
check(
  "……POST 从请求体顶层键推导",
  listText.includes("可改参数：item、qty"),
  "item、qty",
);

/* 3. 去对话页，说一句 —— 假上游会回三个 http.call 动作 */
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3000);
await page.click("textarea");
await page.fill("textarea", "帮我查一下天气，顺便下个单");
await page.keyboard.press("Enter");

/* 4. 第一个闸门：标题 + **权限得是 HTTP 那项**（不是 MCP） */
await page.getByText("想做一个操作").waitFor({ timeout: 30000 });
const gate1 = await page.locator("body").innerText();
check(
  "闸门标题写的是「调用你配的 HTTP 工具」",
  gate1.includes(`调用你配的 HTTP 工具「${GET_TOOL}」`),
  gate1.replace(/\s+/g, " ").slice(0, 120),
);
check("闸门要求的是「调用 HTTP 工具」这项权限（不是 MCP 那项）", gate1.includes("调用 HTTP 工具"));
check("闸门里没把它当成 MCP 工具", !gate1.includes("调用 MCP 工具"));
await page.screenshot({ caret: "initial", path: `${SHOTS}\\http-call-gate.png` });

/* 5. 三次「允许一次」→ 三个动作依次执行 */
for (let i = 0; i < 3; i += 1) {
  await page.getByRole("button", { name: "允许一次" }).click();
  await page.waitForTimeout(400);
}
for (let i = 0; i < 40 && seen.length < 2; i += 1) await page.waitForTimeout(250);

/* 6. 参数到底有没有合进请求 */
const getReq = seen.find((r) => r.path === "/weather");
/*
  ⚠️ 必须连 method 一起匹配：POST + `content-type: application/json` 会先发一个
  **CORS 预检（OPTIONS）**，那个请求的 body 是空的 —— 只按 path 找会抓到它，
  于是断言"body 里有 item/qty"就假失败（第一次就是这么错的）。
*/
const postReq = seen.find((r) => r.path === "/order" && r.method === "POST");
check("GET 工具被真的调到了", Boolean(getReq));
check(
  "POST 之前真的走了 CORS 预检（说明请求头/内容类型是对的）",
  seen.some((r) => r.path === "/order" && r.method === "OPTIONS"),
);
check(
  "GET 参数拼到了网址上（city=杭州）",
  getReq?.query?.city === "杭州",
  JSON.stringify(getReq?.query),
);
check(
  "……而**原有的参数没被弄丢**（units=metric 还在）",
  getReq?.query?.units === "metric",
  JSON.stringify(getReq?.query),
);
check("POST 工具被真的调到了", Boolean(postReq));
check(
  "POST 是**浅合并**进请求体（item 留着、qty 被改成 9）",
  (() => {
    try {
      const b = JSON.parse(postReq?.body ?? "{}");
      return b.item === "咖啡" && b.qty === 9;
    } catch {
      return false;
    }
  })(),
  postReq?.body,
);
check(
  "请求体不是 JSON 的那条**没发出去**（明确拒绝，而不是丢参数硬发）",
  !seen.some((r) => r.path === "/plain"),
  `桩接口收到 ${seen.length} 次`,
);

/* 7. 提示词里写了什么（假上游收到的是服务端真拼的那份） */
const prompt = upstream[0] ?? "";
check("提示词里列出了 HTTP 工具名", prompt.includes(GET_TOOL) && prompt.includes(POST_TOOL));
check("提示词里写了「可改的参数」", prompt.includes("可改的参数：city、units"), "city、units");
check("提示词里写了 http.call 这个动作", prompt.includes("http.call"));
check(
  "提示词里说明了「args 可以不写 = 按配好的原样发」",
  prompt.includes("按他配好的原样发一次"),
);

/* 8. 回执：下一轮请求里带着结果，且拒绝对了的那条也如实说 */
await page.waitForTimeout(1200);
await page.click("textarea");
await page.fill("textarea", "查到了吗");
await page.keyboard.press("Enter");
for (let i = 0; i < 40 && upstream.length < 2; i += 1) await page.waitForTimeout(250);
const second = upstream[1] ?? "";
check(
  "第二轮请求里带着 HTTP 工具的执行结果（回执）",
  second.includes(`调用「${GET_TOOL}」的结果`) && second.includes("杭州"),
);
check(
  "……并且如实说了那条非 JSON 的失败原因",
  second.includes("请求体不是 JSON 对象"),
  second.includes("请求体不是 JSON") ? "" : second.slice(-200),
);

/* 9. 手动点「调用」那条路行为没变（不带参数 = 按配置原样发） */
seen.length = 0;
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.locator("nav[aria-label=主导航]").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "调用" }).first().click();
await page.waitForTimeout(1200);
check(
  "手动「调用」还是按原样发（city 仍是配的 hangzhou）",
  seen[0]?.query?.city === "hangzhou",
  JSON.stringify(seen[0]?.query),
);

console.log("-".repeat(64));
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check("整轮没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 110) ?? "");
console.log(`HTTP 工具调用验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
target.close();
upstreamServer.close();
process.exit(bad === 0 ? 0 : 1);
