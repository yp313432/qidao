/**
 * 验收脚本：**App（安卓）里的 OAuth 分支**。
 *
 * ── 能验到什么、验不到什么（先说清楚）────────────────────────────
 *
 * 在浏览器里可以**伪造"我是安卓 App"**（Capacitor 靠 `CapacitorCustomPlatform`
 * 判断平台），于是一整条 App 分支的 JS 逻辑都能真跑：
 *
 *   ✅ 回调地址变成自定义 scheme（`qidao://oauth/callback`）
 *      —— 从动态注册收到的 redirect_uris 断言，不是我"以为"
 *   ✅ 走的是"开系统浏览器"这条路（`Browser.open`）而不是当前页跳转
 *   ✅ 深链格式的参数解析（`qidao://...?code=&state=`）用的是真函数
 *   ✅ 回跳接收器挂载时不炸（插件 import、`App.getLaunchUrl` / `addListener` 调用签名对）
 *
 * ❌ **验不了**：Android 是否真的把 `qidao://oauth/callback` 派给栖岛、
 *    Capacitor 是否真的触发 `appUrlOpen`。Capacitor 的 `nativePromise` 是
 *    **原生桥运行时注入**的，浏览器里没有对应入口 —— 这一步只能装 APK 在真机上试。
 *    （回跳之后的"换令牌 → 落库 → 验证"那半截，跟网页版共用同一份
 *     `completeAuthorize`，已在 `verify-mcp-oauth.mjs` 里端到端验过。）
 *
 * 跑法（要完整权限；dev server 要在 8080）：
 *   node verify-mcp-oauth-app.mjs
 * 退出码非 0 = 有断言没过。
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const MCP_PORT = 4607;
const AS_PORT = 4606;
const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`;
const AS_URL = `http://127.0.0.1:${AS_PORT}`;
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";
/** App 里必须用的是这个（自定义 scheme），不是同源地址 */
const EXPECT_REDIRECT = "qidao://oauth/callback";

const log = { registeredRedirect: null, authorize: null };

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

/* ── 桩 MCP 服务器：没令牌就 401（这样界面才会给「去授权」）── */

const mcp = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MCP_PORT}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (url.pathname === "/.well-known/oauth-protected-resource") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(
      JSON.stringify({
        resource: `http://127.0.0.1:${MCP_PORT}`,
        authorization_servers: [AS_URL],
        bearer_methods_supported: ["header"],
      }),
    );
    return;
  }
  if (url.pathname !== "/mcp") {
    res.writeHead(404, cors);
    res.end("not found");
    return;
  }
  await readBody(req);
  res.writeHead(401, { ...cors, "content-type": "application/json" });
  res.end(JSON.stringify({ error: "invalid_token", error_description: "Bearer token required" }));
});

/* ── 桩授权服务器 ── */

const as = createServer(async (req, res) => {
  const url = new URL(req.url, AS_URL);

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (url.pathname === "/.well-known/oauth-authorization-server") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(
      JSON.stringify({
        issuer: AS_URL,
        authorization_endpoint: `${AS_URL}/authorize`,
        token_endpoint: `${AS_URL}/token`,
        registration_endpoint: `${AS_URL}/register`,
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
      }),
    );
    return;
  }

  if (url.pathname === "/register" && req.method === "POST") {
    const meta = JSON.parse(await readBody(req));
    log.registeredRedirect = meta.redirect_uris?.[0] ?? null;
    res.writeHead(201, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ client_id: `stub-app-client-${randomUUID().slice(0, 6)}` }));
    return;
  }

  if (url.pathname === "/authorize") {
    log.authorize = Object.fromEntries(url.searchParams.entries());
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><meta charset='utf-8'><title>桩授权页</title><p>桩授权页（真机上这里是对方登录页）");
    return;
  }

  res.writeHead(404, cors);
  res.end("not found");
});

await new Promise((r) => mcp.listen(MCP_PORT, "127.0.0.1", r));
await new Promise((r) => as.listen(AS_PORT, "127.0.0.1", r));
console.log(`桩 MCP（要认证） http://127.0.0.1:${MCP_PORT}/mcp`);
console.log(`桩授权服务器      ${AS_URL}\n`);

/* ── 浏览器：先把"我是安卓 App"这件事伪造好，再让 App 加载 ── */

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.addInitScript(() => {
  // Capacitor 就是靠这个判断平台的（见 @capacitor/core 的 getPlatform）
  window.CapacitorCustomPlatform = { name: "android", plugins: {} };
  // 记下所有 window.open —— Browser 插件的 web 实现就是用它（真机上是系统浏览器）
  const orig = window.open;
  window.__opened = [];
  window.open = (...args) => {
    window.__opened.push(String(args[0]));
    return orig.apply(window, args);
  };
});

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

/* 0. 先确认伪造生效：App 认为自己跑在安卓里，回调地址是自定义 scheme */
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("h1", { timeout: 20000 });

const env = await page.evaluate(async () => {
  // 用 Vite 的模块服务直接 import 我们的真函数，测的就是线上那一份
  const mod = await import("/src/lib/mcp-oauth.ts");
  const plat = await import("/src/lib/platform.ts");
  return {
    native: plat.isNativeApp(),
    redirect: mod.redirectUri(),
    parsed: mod.parseCallbackUrl("qidao://oauth/callback?code=abc123&state=st-xyz"),
  };
});
check("伪造生效：App 认为自己在安卓里", env.native === true);
check("回调地址用的是自定义 scheme", env.redirect === EXPECT_REDIRECT, `实际=${env.redirect}`);
check(
  "深链格式能被正确解析（qidao://…?code=&state=）",
  env.parsed.code === "abc123" && env.parsed.state === "st-xyz",
  JSON.stringify(env.parsed),
);

/* 1. 配服务器 → 测试连接（401）→ 去授权 */
await page.getByRole("button", { name: "MCP" }).click();
await page.getByText("添加 MCP 服务器").click();
await page.getByPlaceholder("例如：Horizon / 我的记忆库").waitFor({ timeout: 20000 });
await page.getByPlaceholder("例如：Horizon / 我的记忆库").fill("桩 App 服务");
await page.getByPlaceholder("https://example.com/mcp").fill(MCP_URL);
await page.getByRole("button", { name: "保存" }).click();
await page.waitForURL("**/tools", { timeout: 20000 });

await page.locator("nav[aria-label=主导航]").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "MCP" }).click();
await page.locator("article").first().waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "测试连接" }).click();
await page.getByRole("button", { name: "去授权" }).waitFor({ timeout: 25000 });
check("没令牌时握手被拒，界面给出「去授权」", true);

await page.getByRole("button", { name: "去授权" }).click();
// 等它把授权地址交给"浏览器"
for (let i = 0; i < 40; i += 1) {
  const opened = await page.evaluate(() => window.__opened?.length ?? 0);
  if (opened > 0) break;
  await page.waitForTimeout(250);
}
const opened = await page.evaluate(() => window.__opened ?? []);

/* 2. 关键断言：动态注册报的就是自定义 scheme */
check(
  "动态注册报的回调地址是 qidao://oauth/callback",
  log.registeredRedirect === EXPECT_REDIRECT,
  `实际=${log.registeredRedirect}`,
);

/* 3. 关键断言：走的是"开系统浏览器"，不是当前页跳转 */
check("没有把当前页跳走（App 里要保持 App 在后台）", page.url().includes("/tools"), page.url());
check("调用了开浏览器（真机=系统浏览器）", opened.length > 0, `window.open 次数=${opened.length}`);

const authUrl = opened[0] ?? "";
const q = authUrl ? new URL(authUrl).searchParams : new URLSearchParams();
check("授权地址是对方的 authorization_endpoint", authUrl.startsWith(`${AS_URL}/authorize`), authUrl.slice(0, 60));
check("带 response_type=code", q.get("response_type") === "code");
check("带 PKCE S256", q.get("code_challenge_method") === "S256" && Boolean(q.get("code_challenge")));
check("带 state", Boolean(q.get("state")));
check("带 resource（规范 MUST）", q.get("resource") === `http://127.0.0.1:${MCP_PORT}`, `实际=${q.get("resource")}`);
check("redirect_uri 就是自定义 scheme", q.get("redirect_uri") === EXPECT_REDIRECT, `实际=${q.get("redirect_uri")}`);

/* 4. 卡片上留了"等你授权"的状态（真机上失败时不至于是哑的） */
const cardText = await page.locator("article").first().innerText();
check(
  "卡片上写了「已经跳到浏览器等你授权」",
  cardText.includes("已经跳到浏览器"),
  cardText.replace(/\s+/g, " ").slice(-90),
);
/*
  ⚠️ 这一条是脚本抓出来的真 bug：App 里不会跳走，所以「去授权」按钮的
  loading 状态必须自己复位 —— 否则用户从浏览器回来看到的是一个
  永久卡在"准备授权…"、点不动的按钮。
*/
check(
  "按钮没有卡在「准备授权…」（App 里不跳走，loading 得自己复位）",
  !cardText.includes("准备授权"),
  cardText.replace(/\s+/g, " ").slice(0, 70),
);
check(
  "还能再点一次「去授权」（空手回来可以重试）",
  (await page.getByRole("button", { name: "去授权" }).count()) === 1,
);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\mcp-oauth-app-waiting.png` });

/* 5. 没有报错（回跳接收器挂载时调用了 App 插件，签名不对会炸） */
check("没有页面报错（App 插件调用签名对得上）", true);
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check("整轮没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 100) ?? "");

console.log("-".repeat(66));
console.log(
  "⚠️ 这个脚本**验不到**：Android 是否真的把深链派给栖岛、Capacitor 是否触发 appUrlOpen。\n" +
    "   （nativePromise 是原生桥运行时注入的，浏览器里没有入口）\n" +
    `   App 分支验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`,
);

await browser.close();
mcp.close();
as.close();
process.exit(bad === 0 ? 0 : 1);
