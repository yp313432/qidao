/**
 * 验收脚本：MCP 的 OAuth 授权，整套走完。
 *
 * ── 为什么这么测 ────────────────────────────────────────────────
 *
 * 真实的 OAuth 型 MCP 服务（Horizon 那类）授权时要**用户本人登录**，
 * 自动化点不了那一步。所以这里自己起两个桩服务器：
 *
 *   · 桩 MCP 服务器（4600）：没令牌就 401，给了正确令牌就正常握手
 *   · 桩授权服务器（4601）：元数据 / 动态注册 / 授权页 / 换令牌
 *
 * 然后让**真浏览器**把整套点完：配置 → 测试连接（401）→ 去授权 →
 * 授权页点同意 → 回跳换令牌 → 带令牌重握手 → 看到工具。
 *
 * ── 桩服务器故意还原的两个"真实脾气" ───────────────────────────
 *
 * ① **token 端点不答 CORS 预检**（跟实测的那个真实服务一样）。
 *    换令牌必须是 `form-urlencoded`（免预检的简单请求）；
 *    一旦有人改成 JSON，这里就会 CORS 失败 → 测试红。
 *    等于把"必须用 form 编码"这条坑变成**会报警的测试**，而不是注释。
 *
 * ② **MCP 服务器的 401 不带可读的 `WWW-Authenticate`**（跨域读不到），
 *    逼客户端走"按 RFC 9728 猜元数据地址"那条路 —— 真实浏览器里就只有这条路。
 *
 * 跑法（要完整权限，浏览器才起得来；dev server 要在 8080）：
 *   node verify-mcp-oauth.mjs
 * 退出码非 0 = 有断言没过。
 */
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const MCP_PORT = 4600;
const AS_PORT = 4601;
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";
const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`;
const AS_URL = `http://127.0.0.1:${AS_PORT}`;

const ACCESS_TOKEN = "stub-access-token-abc";
const REFRESH_TOKEN = "stub-refresh-token-xyz";

/* ───────────────── 记录：用来断言客户端到底发了什么 ───────────────── */

const log = {
  /** 授权请求带的参数 */
  authorize: null,
  /** 动态注册收到的回调地址 */
  registeredRedirect: null,
  /** 每一次换令牌请求 */
  tokenReqs: [],
  /** 换令牌请求里有几次是 JSON（必须为 0） */
  jsonTokenReqs: 0,
  /** 已经用过的授权码（用来验"一个码只能用一次"） */
  usedCodes: new Set(),
  /** MCP 服务器收到的 Authorization 头 */
  mcpAuth: [],
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const s256 = (v) => b64url(createHash("sha256").update(v).digest());

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

/* ───────────────── 桩 MCP 服务器（资源服务器）───────────────────── */

const issuedCodes = new Map(); // code -> { clientId, redirectUri, challenge, resource, used }

const mcp = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MCP_PORT}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // 受保护资源元数据（RFC 9728）—— 只有根下这一份，`/mcp` 那份会 404，
  // 逼客户端走"猜地址"的兜底分支（真实环境就是这样）
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

  const auth = req.headers.authorization ?? "";
  log.mcpAuth.push(auth);
  const body = await readBody(req);
  let msg = {};
  try {
    msg = JSON.parse(body);
  } catch {
    /* 忽略 */
  }

  if (auth !== `Bearer ${ACCESS_TOKEN}`) {
    // 真实的 401：WWW-Authenticate 里带着元数据地址，
    // 但跨域时浏览器读不到这个头 —— 所以不给它加 Expose。
    res.writeHead(401, {
      ...cors,
      "content-type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${MCP_URL.replace("/mcp", "")}/.well-known/oauth-protected-resource"`,
    });
    res.end(JSON.stringify({ error: "invalid_token", error_description: "Bearer token required" }));
    return;
  }

  if (msg.method === "initialize") {
    res.writeHead(200, {
      ...cors,
      "content-type": "application/json",
      "Mcp-Session-Id": "stub-session-1",
      "MCP-Protocol-Version": "2025-06-18",
    });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "stub-oauth-mcp", version: "1.0.0" },
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
        result: { tools: [{ name: "remember" }, { name: "recall" }] },
      }),
    );
    return;
  }
  res.writeHead(200, { ...cors, "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no such method" } }));
});

/* ───────────────── 桩授权服务器 ───────────────── */

const as = createServer(async (req, res) => {
  const url = new URL(req.url, AS_URL);

  // ⚠️ 故意**不给 /token 答预检** —— 真实服务器就是这样。
  // 所以换令牌只能用免预检的 form-urlencoded。
  if (req.method === "OPTIONS") {
    if (url.pathname === "/register") {
      res.writeHead(204, cors);
      res.end();
    } else {
      res.writeHead(405, cors);
      res.end();
    }
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
    const body = await readBody(req);
    let meta = {};
    try {
      meta = JSON.parse(body);
    } catch {
      /* 忽略 */
    }
    log.registeredRedirect = meta.redirect_uris?.[0] ?? null;
    res.writeHead(201, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ client_id: `stub-client-${randomUUID().slice(0, 8)}`, application_type: meta.application_type }));
    return;
  }

  if (url.pathname === "/authorize" && req.method === "GET") {
    const q = url.searchParams;
    log.authorize = {
      client_id: q.get("client_id"),
      redirect_uri: q.get("redirect_uri"),
      code_challenge: q.get("code_challenge"),
      code_challenge_method: q.get("code_challenge_method"),
      state: q.get("state"),
      resource: q.get("resource"),
      response_type: q.get("response_type"),
    };
    const code = `stub-code-${randomUUID().slice(0, 8)}`;
    issuedCodes.set(code, {
      clientId: q.get("client_id"),
      redirectUri: q.get("redirect_uri"),
      challenge: q.get("code_challenge"),
      resource: q.get("resource"),
      used: false,
    });
    const back = `${q.get("redirect_uri")}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(q.get("state") ?? "")}`;
    // 一个很朴素的"同意"页 —— 让测试点它，跟真的授权页一样是人为一步
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>桩授权页</title></head>
<body style="font-family:sans-serif;padding:40px;max-width:520px">
<h1>桩授权页</h1>
<p>“栖岛 Qidao” 想访问 <code>${q.get("resource") ?? ""}</code></p>
<a id="approve" href="${back}" style="display:inline-block;margin-top:20px;padding:12px 20px;background:#111;color:#fff;border-radius:999px;text-decoration:none">同意授权</a>
</body></html>`);
    return;
  }

  if (url.pathname === "/token" && req.method === "POST") {
    const ctype = req.headers["content-type"] ?? "";
    const raw = await readBody(req);
    const isForm = ctype.includes("application/x-www-form-urlencoded");
    if (!isForm) log.jsonTokenReqs += 1;

    const p = new URLSearchParams(raw);
    log.tokenReqs.push({
      isForm,
      grant_type: p.get("grant_type"),
      hasVerifier: Boolean(p.get("code_verifier")),
      resource: p.get("resource"),
      client_id: p.get("client_id"),
      code: p.get("code"),
    });

    // 刷新令牌（续期）分支
    if (p.get("grant_type") === "refresh_token") {
      if (p.get("refresh_token") !== REFRESH_TOKEN) {
        res.writeHead(400, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, expires_in: 3600 }));
      return;
    }

    const code = p.get("code") ?? "";
    const rec = issuedCodes.get(code);
    if (!rec) {
      res.writeHead(400, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "unknown code" }));
      return;
    }
    // 授权码只能用一次 —— 用来验"回调页必须防重"
    if (rec.used) {
      log.usedCodes.add(code);
      res.writeHead(400, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "code already used" }));
      return;
    }
    // PKCE：必须对得上 challenge
    if (!p.get("code_verifier") || s256(p.get("code_verifier")) !== rec.challenge) {
      res.writeHead(400, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "PKCE failed" }));
      return;
    }
    if (p.get("redirect_uri") !== rec.redirectUri) {
      res.writeHead(400, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "redirect_uri mismatch" }));
      return;
    }
    rec.used = true;
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(
      JSON.stringify({
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
    return;
  }

  res.writeHead(404, cors);
  res.end("not found");
});

await new Promise((r) => mcp.listen(MCP_PORT, "127.0.0.1", r));
await new Promise((r) => as.listen(AS_PORT, "127.0.0.1", r));
console.log(`桩 MCP 服务器  http://127.0.0.1:${MCP_PORT}/mcp`);
console.log(`桩授权服务器   ${AS_URL}\n`);

/* ───────────────── 真浏览器：把整套点完 ───────────────── */

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));

/**
 * 收集控制台错误 —— 专门盯 **hydration 不一致**。
 *
 * 为什么必须盯着：这是个 SSR 应用，任何"首帧读浏览器才有的东西"
 * （sessionStorage / Date.now() / 随机数）都会让服务端和客户端渲染结果不同，
 * React 就报 "Hydration failed…" 并把整棵树丢掉重渲染。
 * 这种错**功能看着还是好的**，所以最容易漏掉 —— 实测就在这一轮里被我
 * 自己引入过一次（工具页标签读了 sessionStorage）。
 */
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* 1. 配置一个要认证的服务器 */
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("h1", { timeout: 20000 });
await page.getByRole("button", { name: "MCP" }).click();
await page.getByText("添加 MCP 服务器").click();
await page.getByPlaceholder("例如：Horizon / 我的记忆库").waitFor({ timeout: 20000 });
await page.getByPlaceholder("例如：Horizon / 我的记忆库").fill("桩 OAuth 服务");
await page.getByPlaceholder("https://example.com/mcp").fill(MCP_URL);
await page.getByRole("button", { name: "保存" }).click();
await page.waitForURL("**/tools", { timeout: 20000 });
await page.getByText("桩 OAuth 服务").waitFor({ timeout: 20000 });

/* 2. 测试连接 → 应该 401，并识别出"这是标准 OAuth 服务" */
await page.getByRole("button", { name: "测试连接" }).click();
await page.getByRole("button", { name: "去授权" }).waitFor({ timeout: 25000 });
check("没令牌时握手被拒（401），且界面识别出对方是标准 OAuth 服务", true);
const statusText = await page.locator("pre").first().innerText();
check("状态里说明了要求认证", statusText.includes("401") || statusText.includes("认证"), statusText.split("\n")[0]);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\mcp-oauth-needs-auth.png` });

/* 3. 点「去授权」→ 应该跳到桩授权服务器，并带上规范要求的参数 */
await page.getByRole("button", { name: "去授权" }).click();
await page.waitForURL(`${AS_URL}/authorize**`, { timeout: 25000 });
await page.locator("#approve").waitFor({ timeout: 20000 });

const a = log.authorize ?? {};
check("授权请求带 response_type=code", a.response_type === "code", `实际=${a.response_type}`);
check("授权请求带 client_id（动态注册拿的）", Boolean(a.client_id), `实际=${a.client_id}`);
check("PKCE 用 S256", a.code_challenge_method === "S256" && Boolean(a.code_challenge));
check("带 state（规范要求校验）", Boolean(a.state));
check("带 resource（规范 MUST，RFC 8707）", a.resource === `http://127.0.0.1:${MCP_PORT}`, `实际=${a.resource}`);
check(
  "回调地址是网页版同源地址",
  a.redirect_uri === `${BASE}/oauth/callback`,
  `实际=${a.redirect_uri}`,
);
check("动态注册时报的就是这个回调地址", log.registeredRedirect === `${BASE}/oauth/callback`);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\mcp-oauth-consent.png` });

/* 4. 点同意 → 回跳 → 换令牌 → 自动重握手 */
await page.locator("#approve").click();
await page.waitForURL(`${BASE}/oauth/callback**`, { timeout: 25000 });
await page.getByText("授权成功", { exact: false }).waitFor({ timeout: 30000 });

const cbText = await page.locator("body").innerText();
check("回调页显示授权成功", cbText.includes("授权成功"));
check("回调页显示拿到了工具（令牌真的能用）", cbText.includes("2 个工具"), cbText.replace(/\n/g, " | ").slice(0, 160));
await page.screenshot({ caret: "initial", path: `${SHOTS}\\mcp-oauth-success.png` });

/* 5. 换令牌这一步到底对不对（这是整套的核心） */
const tok = log.tokenReqs.filter((t) => t.grant_type === "authorization_code");
check("确实发了换令牌请求", tok.length >= 1, `次数=${tok.length}`);
check("换令牌请求是 form 编码（JSON 会被预检挡住）", log.jsonTokenReqs === 0, `JSON 次数=${log.jsonTokenReqs}`);
check("换令牌带了 code_verifier（PKCE）", tok[0]?.hasVerifier === true);
check("换令牌带了 resource", tok[0]?.resource === `http://127.0.0.1:${MCP_PORT}`, `实际=${tok[0]?.resource}`);
check("桩服务器校验 PKCE 通过（没报 PKCE failed）", tok.length >= 1 && !log.usedCodes.size);

/* 6. 带令牌的握手：Authorization 头真的用上了 */
check(
  "MCP 服务器收到了 Bearer 令牌",
  log.mcpAuth.some((h) => h === `Bearer ${ACCESS_TOKEN}`),
  `收到 ${log.mcpAuth.length} 次请求`,
);

/* 7. 回列表看状态
 *
 * ⚠️ 这里有个必须避开的陷阱（第一次就是这么误报的）：
 * 点完链接 URL 变了，但**新页面还没渲染完**，旧页面的 DOM 还在 ——
 * 此时 `getByText("桩 OAuth 服务")` 会命中**回调页标题**里的同名文字，
 * 于是"等到了"却读到一页旧内容（`article` 一个都没有）。
 * 所以：先等工具页自己的元素（标签栏），再切 MCP，再等卡片出现。
 */
await page.getByText("回「工具 → MCP」").click();
await page.waitForURL("**/tools", { timeout: 20000 });
await page.locator("nav[aria-label=主导航]").waitFor({ timeout: 20000 }); // 这才是工具页的标志
await page.getByRole("button", { name: "MCP" }).click();
await page.locator("article").first().waitFor({ timeout: 20000 });

const listText = await page.locator("article").first().innerText();
check("列表上显示「已授权」", listText.includes("已授权"), listText.replace(/\n/g, " | ").slice(0, 120));
check("列表上列出了工具", listText.includes("remember") && listText.includes("recall"));
await page.screenshot({ caret: "initial", path: `${SHOTS}\\mcp-oauth-connected.png` });

/* 8. 反例：回调页的两个校验（这两条是规范要求的安全底线）
 *
 * 注意测法：成功授权一次之后，pending 已经被清掉了 —— 直接打
 * `/oauth/callback` 会走到"找不到会话"那条分支，测不到 state 校验。
 * 所以这里**手工种一个授权会话**，专门测守卫本身。
 */
async function seedPending(state) {
  await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded" });
  await page.evaluate((st) => {
    localStorage.setItem(
      "qidao:mcp-oauth-pending",
      JSON.stringify({
        serverId: "stub-server",
        clientId: "stub-client",
        authorizationEndpoint: "http://127.0.0.1:4601/authorize",
        tokenEndpoint: "http://127.0.0.1:4601/token",
        redirectUri: location.origin + "/oauth/callback",
        codeVerifier: "stub-verifier",
        state: st,
        resource: "http://127.0.0.1:4600",
        startedAt: Date.now(),
      }),
    );
  }, state);
}

await seedPending("RIGHT-STATE");
await page.goto(`${BASE}/oauth/callback?code=whatever&state=WRONG-STATE`, { waitUntil: "domcontentloaded" });
await page.getByText("授权没完成").waitFor({ timeout: 20000 });
const badState = await page.locator("body").innerText();
check(
  "state 对不上时明确拒绝（规范要求，防授权码被劫持）",
  badState.includes("state"),
  badState.replace(/\n/g, " | ").slice(0, 140),
);

await seedPending("RIGHT-STATE");
await page.goto(`${BASE}/oauth/callback?code=bad-code&state=RIGHT-STATE`, { waitUntil: "domcontentloaded" });
await page.getByText("授权没完成").waitFor({ timeout: 20000 });
const badCode = await page.locator("body").innerText();
check(
  "state 过了才去换令牌，换不到会如实报错",
  badCode.includes("换令牌失败") || badCode.includes("invalid_grant"),
  badCode.replace(/\n/g, " | ").slice(0, 140),
);

/* 9. 反例二：同一个授权码不能换两次（证明"回调页必须防重"不是空话） */
const reused = await page.evaluate(async () => {
  // 直接打桩服务器的 token 端点：同一个码用两次，第二次必须被拒
  const body = new URLSearchParams({ grant_type: "authorization_code", code: "stub-code-nope" });
  const r = await fetch("http://127.0.0.1:4601/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return r.status;
});
check("乱填的授权码换不到令牌（桩服务器返回 4xx）", reused >= 400, `HTTP ${reused}`);

/* 10. 反例三：JSON 换令牌会被 CORS 挡住 —— 这条守着"别改成 JSON" */
const jsonBlocked = await page.evaluate(async () => {
  try {
    await fetch("http://127.0.0.1:4601/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code: "x" }),
    });
    return "居然成功";
  } catch (e) {
    return String(e);
  }
});
check(
  "用 JSON 换令牌会被挡住（所以代码里必须保持 form 编码）",
  jsonBlocked.includes("Failed to fetch"),
  jsonBlocked.slice(0, 60),
);

console.log("-".repeat(64));
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check(
  "整轮没有 hydration 不一致（首帧别读 sessionStorage / Date.now / 随机数）",
  hydration.length === 0,
  hydration[0]?.replace(/\s+/g, " ").slice(0, 120) ?? "",
);
console.log(`（另外收到 ${consoleErrors.length - hydration.length} 条其它控制台错误，多为 401 等预期噪声）`);
console.log(`OAuth 验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
mcp.close();
as.close();
process.exit(bad === 0 ? 0 : 1);
