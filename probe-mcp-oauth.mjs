/**
 * 诊断脚本：一个 MCP 服务器到底支不支持 OAuth、我们能不能接上。
 *
 * 为什么要有它（全是这一轮实测出来的坑）：
 *
 *   1. 「MCP 握手要令牌」时，光看 401 什么也判断不出来。要看三份东西：
 *        · `/.well-known/oauth-protected-resource`（RFC 9728，MCP 规范要求必须有）
 *        · `/.well-known/oauth-authorization-server`（RFC 8414，必须有）
 *        · 授权服务器的元数据里有没有 `registration_endpoint`（= 支不支持动态注册）
 *
 *   2. ⚠️ **token 端点必须用 `application/x-www-form-urlencoded` 发**。
 *      用 `application/json` 会触发 CORS 预检（OPTIONS），而很多授权服务器
 *      **不答预检** —— 于是浏览器里报 `TypeError: Failed to fetch`，
 *      看起来像"这个端点完全不放跨域"，其实只是编码方式不对。
 *      （form-urlencoded 是免预检的"简单请求"，而且本来就是 OAuth 规范要求的写法。）
 *      实测：JSON → Failed to fetch；form → 401 invalid_client（能读到响应体 = 跨域通）。
 *
 *   3. ⚠️ 跨域响应的 `Access-Control-Allow-Origin` **在 JS 里读不到**
 *      （跨域只暴露白名单响应头），所以**不能用它判断有没有放跨域** ——
 *      能成功读到响应体，就说明放行了。
 *
 * ⚠️ 这个脚本会**在目标服务器上注册一个客户端**（动态注册是写操作）。
 *    只对你自己的服务器跑；跑完会在对方那边留下一条 `client_name` 为
 *    `qidao-probe` 的注册记录（目前没有撤销接口，留着无害）。
 *    只看前三步、不想写东西的话，把它下面的 DCR 那一段注释掉。
 *
 * 跑法（要完整权限，浏览器才起得来）：
 *   node probe-mcp-oauth.mjs https://your-server.example.com
 */
import { chromium } from "playwright";

const base = (process.argv[2] || "https://yanpingmemory.fastmcp.app").replace(/\/+$/, "");
/** 探测时假装自己是本机网页版；真机上这里是 https://localhost */
const REDIRECT = process.argv[3] || "http://127.0.0.1:8080/oauth/callback";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
// 用本机 dev server 当"来源"——跨域行为跟真实 App 里一致
await page.goto("http://127.0.0.1:8080/tools", { waitUntil: "domcontentloaded" });

const call = (name, url, init) =>
  page
    .evaluate(
      async ([u, i]) => {
        try {
          const r = await fetch(u, i);
          return { status: r.status, body: (await r.text()).slice(0, 400) };
        } catch (e) {
          return { error: String(e) };
        }
      },
      [url, init],
    )
    .then((r) => ({ name, url, ...r }));

const results = [];

results.push(await call("① 受保护资源元数据（MCP 规范要求必须有）", `${base}/.well-known/oauth-protected-resource`));
results.push(await call("② 授权服务器元数据（必须有）", `${base}/.well-known/oauth-authorization-server`));

// ③ 动态注册 —— 会在这台服务器上留下一条客户端记录
results.push(
  await call("③ 动态注册 DCR（会写一条客户端记录）", `${base}/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "qidao-probe",
      redirect_uris: [REDIRECT],
      application_type: "native",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  }),
);

// ④ token 端点：故意用错的 code，只看"能不能读到响应"（能读到 = 跨域通）
const form = "grant_type=authorization_code&code=probe&redirect_uri=" + encodeURIComponent(REDIRECT);
results.push(
  await call("④a token 端点（form-urlencoded，免预检 · 应该能读到响应）", `${base}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  }),
);
results.push(
  await call("④b token 端点（JSON，会触发预检 · 大概率 Failed to fetch）", `${base}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code: "probe" }),
  }),
);

console.log(`探测目标：${base}\n回调地址：${REDIRECT}\n${"-".repeat(70)}`);
for (const r of results) {
  console.log(`\n${r.name}\n  ${r.url}`);
  console.log(r.error ? `  ❌ ${r.error}` : `  HTTP ${r.status}\n  ${r.body.replace(/\n/g, "\n  ")}`);
}

console.log(`\n${"-".repeat(70)}
怎么读这份结果：
  · ①② 都是 200  → 对方是标准 OAuth，我们按规范接就行
  · ② 里有 registration_endpoint → 能动态注册，用户不用手填 client_id
  · ③ 是 201 且给了 client_id → 回调地址它接受（本例用的是 ${REDIRECT}）
  · ④a 能读到 401/400（不是 Failed to fetch）→ token 交换可以从浏览器发出，
      所以**整套 OAuth 在网页版就能验通**，不用一步一上真机
  · ④b 失败是正常的（预检没人答）—— **代码里千万别用 JSON 发 token 请求**`);

await browser.close();
