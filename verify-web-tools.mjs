#!/usr/bin/env node
/**
 * 验收脚本：**手机端"搜网页 / 读网页"这一层的护栏**（`src/lib/web-extract.ts` +
 * `src/lib/web-http.ts`）。
 *
 * ── 为什么必须有一个这样的脚本 ────────────────────────────────
 *
 * 这一层做的事是"**按用户/AI 给的网址出网**" —— 出错的方式不是报错，而是：
 *   · **SSRF**：`http://127.0.0.1/`、`http://192.168.1.1/` 被放过去 = 手机/服务端
 *     变成内网扫描器（这类洞"测试全绿"的时候最危险，所以清单要逐条断言）；
 *   · **安静地失败**：超时/非 2xx/超大响应如果被吞掉，模型就会**编一个网页内容**出来；
 *   · **抽正文规则写了两份**（服务端一份、端上一份）→ 一边改了另一边不知道。
 *
 * 纯 node、不连外网（除了最后那条可选冒烟）、不起浏览器：
 *   · 真起一个**本地假 HTTP 服务**（127.0.0.1 高号端口），并用一个**假的传输层**
 *     把 `http://web-tools.test/...`（RFC 2606 保留域，真的解析不了）指向它 ——
 *     所以"取回来 + 超时 + 超大 + 非 2xx + 抽正文"验的是**真 HTTP 往返**；
 *   · ⚠️ **测试不碰 SSRF 闸门**：`web-tools.test` 是"公网域名"，正常过闸；
 *     而 `127.0.0.1` / `192.168.*` 那些在 §2 里**必须**被闸门拒掉 ——
 *     要是为了让本地服务能直连去放宽闸门，那这个脚本就是在教人开洞。
 *
 * 跑法：
 *   node --experimental-strip-types verify-web-tools.mjs
 * 退出码 0 = 全过；非 0 = 有断言失败（逐条打印红在哪）。
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import {
  WEB_FETCH_HEADERS,
  htmlToText,
  isPublicHttpUrl,
} from "./src/lib/web-extract.ts";
import {
  WEB_FETCH_DEFAULTS,
  decodeEntities,
  fetchWebText,
  parseBingRss,
  readWebPage,
  webSearch,
} from "./src/lib/web-http.ts";

const fails = [];
const warns = [];
const notes = [];
const fail = (m) => fails.push(m);
const warn = (m) => warns.push(m);
const note = (m) => notes.push(m);
const ok = (cond, msg) => {
  if (cond) return true;
  fail(msg);
  return false;
};
const head = (t) => console.log(`\n=== ${t} ===`);

/* ── 假 HTML / 假 RSS（正文抽取与 RSS 解析的固定输入）──────────── */

const FAKE_HTML = `<!doctype html>
<html lang="zh-CN"><head>
  <title>测试页 · 假网页</title>
  <style>body{color:red}</style>
  <script>window.__evil = 1;</script>
</head><body>
  <header>这是页头导航，应该被丢掉</header>
  <nav>首页 | 关于 | 登录 我的收藏 皮肤中心</nav>
  <main>
    <h1>栖岛测试标题</h1>
    <p>第一段正文：手机版应该能读到这段文字。</p>
    <p>第二段正文：带一个实体 &amp; 和一个 &lt;标签&gt; 的样子。</p>
    <ul><li>条目甲</li><li>条目乙</li></ul>
  </main>
  <aside>侧栏广告，应该被丢掉</aside>
  <form><input name="q" /><button>搜索</button></form>
  <footer>页脚版权，应该被丢掉</footer>
</body></html>`;

const FAKE_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>必应搜索: 测试</title>
  <item>
    <title>结果一 &amp; 它的标题</title>
    <link>https://example.com/one?a=1&amp;b=2</link>
    <description><![CDATA[第一条摘要 <b>带标签</b>]]></description>
  </item>
  <item>
    <title><![CDATA[结果二]]></title>
    <link>https://example.com/two</link>
    <description>第二条摘要</description>
  </item>
  <item>
    <title>坏条目（没有链接）</title>
    <link>not-a-url</link>
  </item>
  <item>
    <title>结果三</title>
    <link>https://example.com/three</link>
    <description>第三条摘要</description>
  </item>
</channel></rss>`;

/* ── 本地假服务（127.0.0.1 高号端口）+ 假传输层 ─────────────── */

const PORT = 41999;
/**
 * `web-tools.test` 是 RFC 2606 的保留域（真解析不了）；下面这个**假传输层**
 * 把它指到本地假服务。于是：**过闸门的是"公网域名"，真往返的是本地 HTTP** ——
 * 既验了完整链路（含超时/截断/状态码），又不用给 SSRF 闸门开后门。
 */
const LOCAL = "http://web-tools.test";
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const rewritten = url.replace(/^http:\/\/web-tools\.test(?=[:/]|$)/, `http://127.0.0.1:${PORT}`);
  return realFetch(rewritten, init);
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(FAKE_HTML);
    return;
  }
  if (url.pathname === "/rss") {
    res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    res.end(FAKE_RSS);
    return;
  }
  if (url.pathname === "/big") {
    // 200KB：用来验"超过上限就截断，并且如实标记"
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(`<html><title>大页</title><body>${"甲".repeat(100_000)}</body></html>`);
    return;
  }
  if (url.pathname === "/slow") {
    // 一直不回：用来验超时（3 秒后才回，客户端 400ms 就该放弃）
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><title>慢</title><body>终于回来了</body></html>");
    }, 3_000);
    return;
  }
  if (url.pathname === "/404") {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><title>没有</title><body>这个页面不存在</body></html>");
    return;
  }
  res.writeHead(500, { "content-type": "text/plain" });
  res.end("boom");
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
console.log(`假服务已起：http://127.0.0.1:${PORT}（验收脚本自己起的，跑完就关）`);
console.log(`测试用地址：${LOCAL}/…（经假传输层指向本地服务；闸门当它是公网域名）`);

/* ── §1 正文抽取（跟服务端共用同一份）────────────────────────── */

head("1) htmlToText：正文抽取（假 HTML → 纯文本）");
{
  const { title, text } = htmlToText(FAKE_HTML);
  console.log(`title = ${JSON.stringify(title)}`);
  console.log(`text  = ${JSON.stringify(text)}`);
  ok(title === "测试页 · 假网页", `标题抽错了：${JSON.stringify(title)}`);
  ok(text.includes("第一段正文"), "正文第一段没抽出来");
  ok(text.includes("第二段正文"), "正文第二段没抽出来");
  ok(text.includes("&") && !text.includes("&amp;"), "实体 &amp; 没还原成 &");
  ok(text.includes("<标签>"), "实体 &lt;标签&gt; 没还原成 <标签>");
  ok(!text.includes("这是页头导航"), "页头（header）没被丢掉");
  ok(!text.includes("首页 |"), "导航（nav）没被丢掉");
  ok(!text.includes("侧栏广告"), "侧栏（aside）没被丢掉");
  ok(!text.includes("页脚版权"), "页脚（footer）没被丢掉");
  ok(!text.includes("window.__evil"), "script 里的内容漏进正文了");
  ok(!text.includes("color:red"), "style 里的内容漏进正文了");
  ok(!/</.test(text) || !text.includes("<p>"), "还留着标签没剥干净");
  ok(text.includes("条目甲") && text.includes("条目乙"), "列表项（li）没抽出来");

  const empty = htmlToText("<html><body><script>x</script></body></html>");
  ok(empty.text === "", "空正文应该是空字符串（由调用方如实说'正文是空的'）");
}

/* ── §2 SSRF：该拒的一个都不能放 ─────────────────────────────── */

head("2) isPublicHttpUrl：SSRF 拦截清单");
const BLOCKED = [
  ["http://127.0.0.1/", "回环 IPv4"],
  ["http://127.0.0.1:8080/", "回环 + 端口"],
  ["https://127.0.0.1/x", "回环（https）"],
  ["http://localhost/", "localhost"],
  ["http://localhost:3000/", "localhost + 端口"],
  ["http://LOCALHOST/", "localhost 大写"],
  ["http://foo.localhost/", "*.localhost"],
  ["http://my-nas.local/", "*.local（局域网 mDNS）"],
  ["http://router.internal/", "*.internal"],
  ["http://0.0.0.0/", "0.0.0.0"],
  ["http://10.0.0.1/", "10/8"],
  ["http://10.255.255.254/", "10/8 边界"],
  ["http://172.16.0.1/", "172.16/12 下界"],
  ["http://172.31.255.1/", "172.31/12 上界"],
  ["http://192.168.1.1/", "192.168/16"],
  ["http://169.254.169.254/latest/meta-data/", "链路本地（云元数据端点！）"],
  ["http://100.64.0.1/", "CGNAT"],
  ["http://[::1]/", "IPv6 回环"],
  ["http://[::]/", "IPv6 全零"],
  ["http://[fc00::1]/", "IPv6 唯一本地"],
  ["http://[fe80::1]/", "IPv6 链路本地"],
  ["http://[::ffff:127.0.0.1]/", "IPv4 映射回环（URL 会规范成 ::ffff:7f00:1）"],
  ["http://[::ffff:192.168.1.1]/", "IPv4 映射内网"],
  ["http://2130706433/", "十进制整数 IP（= 127.0.0.1）"],
  ["http://0x7f000001/", "十六进制整数 IP（= 127.0.0.1）"],
  ["http://0x7f.0.0.1/", "十六进制段"],
  ["http://0177.0.0.1/", "八进制段"],
  ["http://3232235777/", "十进制整数 IP（= 192.168.1.1）"],
  ["http://127.1/", "缺段（= 127.0.0.1）"],
  ["http://192.168.1/", "缺段（= 192.168.1.1）"],
  ["file:///etc/passwd", "file 协议"],
  ["ftp://example.com/x", "ftp 协议"],
  ["data:text/html,<h1>x</h1>", "data 协议"],
  ["javascript:alert(1)", "javascript 协议"],
  ["不是网址", "压根不是 URL"],
  ["", "空字符串"],
];
let blockedCount = 0;
for (const [url, why] of BLOCKED) {
  const r = isPublicHttpUrl(url);
  if (r.ok) fail(`❌ 该拒的放过去了：${url}（${why}）`);
  else {
    blockedCount += 1;
    console.log(`  ✅ 拒 ${url.padEnd(42)} → ${r.why}`);
  }
}
console.log(`拦截清单：${blockedCount}/${BLOCKED.length} 条被拒`);
ok(blockedCount === BLOCKED.length, `有 ${BLOCKED.length - blockedCount} 条内网/非法地址没被拒`);

head("2b) 该放的必须放（别把公网地址也误杀）");
const ALLOWED = [
  "https://example.com/",
  "http://example.com/",
  "https://cn.bing.com/search?q=x&format=rss",
  "https://api.bochaai.com/v1/web-search",
  // ⚠️ 非 80/443 端口的公网地址**必须放行**（2026-10 改的口径）：
  // 老口径"只允许 80/443"会把跑在 8443/8080 上的正常站点全拒掉，
  // 而端口从来不是 SSRF 的防线（防线是主机指向哪儿）。
  "https://example.com:8443/",
  "http://example.com:8080/page",
];
for (const url of ALLOWED) {
  const r = isPublicHttpUrl(url);
  ok(r.ok, `❌ 该放行的被拒了：${url}（${r.ok ? "" : r.why}）`);
  console.log(`  ✅ 放 ${url}`);
}

/* ── §3 取网页：正常 / 超时 / 超大 / 非 2xx ─────────────────── */

head("3) fetchWebText + readWebPage（打本地假服务）");

{
  const got = await fetchWebText(`${LOCAL}/html`);
  console.log(`  ${LOCAL}/html → ok=${got.ok} status=${got.status} via=${got.ok ? got.via : "-"} 长度=${got.ok ? got.text.length : 0}`);
  ok(got.ok && got.status === 200, "本地假服务应该 200 取回来");
  if (got.ok) {
    ok(got.text.includes("第一段正文"), "取回来的 HTML 内容不对");
    ok(got.truncated === false, "没超上限却被标记截断");
    ok(got.via === "fetch", `node 里应该走 fetch 回落（via=${got.via}）`);
  }

  const page = await readWebPage(`${LOCAL}/html`);
  if (ok(page.ok, `readWebPage 应该成功：${page.ok ? "" : page.why}`)) {
    console.log(`  readWebPage → title=${JSON.stringify(page.title)} chars=${page.chars} truncated=${page.truncated}`);
    ok(page.title === "测试页 · 假网页", "readWebPage 的标题不对");
    ok(page.text.includes("第一段正文"), "readWebPage 的正文不对");
    ok(page.text.includes("条目乙") && !page.text.includes("侧栏广告"), "readWebPage 正文里混进了噪声块");
    ok(page.truncated === false, "readWebPage 没超上限却说截断了");
  }
}

{
  const t0 = Date.now();
  const got = await fetchWebText(`${LOCAL}/slow`, { timeoutMs: 400 });
  const ms = Date.now() - t0;
  console.log(`  ${LOCAL}/slow（超时 400ms）→ ok=${got.ok} 用时 ${ms}ms ${got.ok ? "" : `why=${got.why}`}`);
  ok(!got.ok, "超时必须返回失败，不能假装成功");
  ok(ms < 3_000, `超时没生效（用了 ${ms}ms，服务端 3s 后才回）`);
  ok(/超过|abort|timeout|超时/i.test(got.ok ? "" : got.why), `超时的原因说明不像超时：${got.ok ? "" : got.why}`);
}

{
  const got = await fetchWebText(`${LOCAL}/big`, { maxBytes: 1_000 });
  if (ok(got.ok, "超大响应本身不算失败（要截断 + 标记，不是抛错）")) {
    console.log(`  ${LOCAL}/big（上限 1000 字节）→ truncated=${got.truncated} 取到 ${got.text.length} 字符`);
    ok(got.truncated === true, "超过上限却没标记 truncated（等于静默丢数据）");
  }
  const page = await readWebPage(`${LOCAL}/big`, { maxChars: 500 });
  if (ok(page.ok, "readWebPage 读大页应该成功（截断）")) {
    console.log(`  readWebPage /big → chars=${page.chars} text.length=${page.text.length} truncated=${page.truncated}`);
    ok(page.truncated === true, "readWebPage 截断了却没标记 truncated");
    ok(page.text.length === 500, `readWebPage 应该截到 500 字，实际 ${page.text.length}`);
  }
}

{
  const got = await fetchWebText(`${LOCAL}/404`);
  ok(got.ok, "非 2xx 也要把状态码带回来（由调用方措辞），不该直接当函数失败");
  ok(got.ok && got.status === 404, `状态码应该是 404，实际 ${got.ok ? got.status : "-"}`);
  const page = await readWebPage(`${LOCAL}/404`);
  console.log(`  readWebPage /404 → ok=${page.ok} ${page.ok ? "" : `why=${page.why}`}`);
  ok(!page.ok, "读 404 页面必须如实失败");
  ok(!page.ok && /404/.test(page.why), `失败说明里要带状态码：${page.ok ? "" : page.why}`);
}

{
  // 连不上（端口没人听）：必须是"如实失败"，不是抛到崩。
  // ⚠️ 这里用 127.0.0.1 —— 它会被 SSRF 闸门先挡掉，返回的也必须是一条**人话原因**，
  // 而不是异常/空字符串（"闸门拒了"本身也是一种如实失败）。
  const dead = await fetchWebText(`http://127.0.0.1:${PORT + 1}/nope`, { timeoutMs: 1_500 });
  console.log(`  内网地址 → ok=${dead.ok} ${dead.ok ? "" : `why=${dead.why}`}`);
  ok(!dead.ok, "内网地址必须返回 ok:false");

  // 公网域名但连不上（DNS 解析不了 / 端口关着）：同样要如实失败
  const unreachable = await fetchWebText("http://definitely-not-a-real-host-qidao.invalid/x", {
    timeoutMs: 3_000,
  });
  console.log(`  不存在的域名 → ok=${unreachable.ok} why=${unreachable.ok ? "" : unreachable.why.slice(0, 70)}`);
  ok(!unreachable.ok, "连不上的公网域名必须返回 ok:false");
  ok(!unreachable.ok && unreachable.why.length > 1, "失败原因不能是空字符串");
}

/* ── §4 Bing RSS 解析（喂假 RSS，不联网）────────────────────── */

head("4) parseBingRss：假 RSS → 标题/链接/摘要");
{
  const hits = parseBingRss(FAKE_RSS, 8);
  for (const h of hits) console.log(`  · ${h.title} | ${h.url} | ${h.snippet}`);
  ok(hits.length === 3, `应该解析出 3 条（第 3 条链接非法要丢掉），实际 ${hits.length}`);
  ok(hits[0]?.title === "结果一 & 它的标题", `标题实体没还原：${hits[0]?.title}`);
  ok(hits[0]?.url === "https://example.com/one?a=1&b=2", `链接实体没还原：${hits[0]?.url}`);
  ok(hits[0]?.snippet === "第一条摘要 带标签", `摘要里的 CDATA/标签没处理：${hits[0]?.snippet}`);
  ok(hits[1]?.title === "结果二", `CDATA 标题没处理：${hits[1]?.title}`);
  ok(!hits.some((h) => h.url === "not-a-url"), "非法链接（不是 http）应该被丢掉");  ok(hits.every((h) => h.title && h.url && h.snippet !== undefined), "每条都必须有标题/链接");
  const limited = parseBingRss(FAKE_RSS, 1);
  ok(limited.length === 1, `limit 没生效：${limited.length}`);
  ok(parseBingRss("").length === 0, "空输入应该返回空数组，不该抛");
  ok(parseBingRss("<rss><channel></channel></rss>").length === 0, "没有 item 应该返回空数组");
  /*
    ⚠️ 这里**不拿 `&lt;a&gt;` 这种输入**：`decodeEntities` 的"剥标签"那一步会把它
    当成真标签（先还原再剥，顺序如此）—— 那是从服务端原样搬过来的行为，不是这次的改动。
    所以只测**纯实体**这一路（RSS 里真正会遇到的那路）。
  */
  ok(decodeEntities("&amp;&quot;x&quot;") === '&"x"', `decodeEntities 不对：${decodeEntities("&amp;&quot;x&quot;")}`);
  ok(decodeEntities("a &nbsp; b") === "a   b" || decodeEntities("a &nbsp; b") === "a b", "nbsp 没还原");
  ok(decodeEntities("<![CDATA[裸]]>") === "裸", "CDATA 没剥掉");
}

/* ── §5 口径一致 + 结构（防"抄了第二份实现"/"路由被改坏"）───── */

head("5) 共用的那一份实现（不许抄第二份）");
{
  const tools = readFileSync(new URL("./src/lib/web-tools.ts", import.meta.url), "utf8");
  const http = readFileSync(new URL("./src/lib/web-http.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("./src/routes/api/read.ts", import.meta.url), "utf8");

  ok(!/export function htmlToText/.test(tools), "web-tools.ts 里又长出了一份 htmlToText（应该从 web-extract re-export）");
  ok(!/export function isPublicHttpUrl/.test(tools), "web-tools.ts 里又长出了一份 isPublicHttpUrl");
  ok(/export \{ htmlToText, isPublicHttpUrl \}/.test(tools), "web-tools.ts 没有 re-export 那两个纯函数（服务端路由会崩）");
  ok(/from "@\/lib\/web-extract"/.test(tools), "web-tools.ts 没有从 web-extract 取那一份实现");
  ok(/from "\.\/web-extract\.ts"/.test(http), "web-http.ts 没有从 web-extract 取那一份实现（相对路径 + .ts，纯 node 才 import 得动）");
  ok(!/from "@\/lib\/web-extract"/.test(http), "web-http.ts 用了 @/ 别名 —— 验收脚本在纯 node 里 import 不了它");
  ok(!/function htmlToText/.test(http), "web-http.ts 里自己抄了一份 htmlToText");
  ok(/from "@\/lib\/web-tools"/.test(route), "服务端路由 read.ts 的 import 被改了（它得继续从 web-tools 拿）");
  ok(/htmlToText/.test(route), "服务端路由 read.ts 不再用 htmlToText 了？");
  console.log("  ✅ 端上与服务端共用 web-extract.ts 那一份（web-tools.ts 只做 re-export）");
}

head("5b) 请求头口径（两边必须一样，否则'网页版能读手机版不能'）");
{
  ok(WEB_FETCH_HEADERS["user-agent"]?.includes("Android"), "共用请求头里应该有安卓 UA");
  ok(WEB_FETCH_HEADERS["accept-language"]?.includes("zh-CN"), "共用请求头里应该有中文 Accept-Language");
  console.log(`  UA = ${WEB_FETCH_HEADERS["user-agent"].slice(0, 56)}…`);
  console.log(`  默认上限：${WEB_FETCH_DEFAULTS.timeoutMs}ms / ${WEB_FETCH_DEFAULTS.maxBytes} 字节`);
  ok(WEB_FETCH_DEFAULTS.timeoutMs > 0 && WEB_FETCH_DEFAULTS.maxBytes > 0, "默认护栏不能是 0/无限");
}

head("5c) 两个动作的注册（三边 + 权限 + 计数字面量）");
{
  const types = readFileSync(new URL("./src/lib/types.ts", import.meta.url), "utf8");
  const meta = readFileSync(new URL("./src/lib/action-meta.ts", import.meta.url), "utf8");
  const schema = readFileSync(new URL("./src/lib/action-schema.ts", import.meta.url), "utf8");
  const actions = readFileSync(new URL("./src/lib/actions.ts", import.meta.url), "utf8");
  const perms = readFileSync(new URL("./src/lib/permissions.ts", import.meta.url), "utf8");
  const registry = readFileSync(new URL("./verify-action-registry.mjs", import.meta.url), "utf8");
  const recall = readFileSync(new URL("./verify-tool-recall.mjs", import.meta.url), "utf8");
  const corpus = readFileSync(new URL("./tool-recall-corpus.ts", import.meta.url), "utf8");

  ok(/kind: "web\.search"; query: string/.test(types), "types.ts 里缺 web.search 的联合成员");
  ok(/kind: "web\.fetch"; url: string/.test(types), "types.ts 里缺 web.fetch 的联合成员");
  ok(/"web\.search": "web_search"/.test(meta), "action-meta.ts 没把 web.search 挂到 web_search");
  ok(/"web\.fetch": "web_search"/.test(meta), "action-meta.ts 没把 web.fetch 挂到 web_search");
  ok(/kind: "web\.search"/.test(schema) && /kind: "web\.fetch"/.test(schema), "action-schema.ts 缺 kind");
  ok(/case "web\.search":/.test(actions) && /case "web\.fetch":/.test(actions), "actions.ts 缺执行分支");
  ok(/action\.query/.test(actions) && /action\.url/.test(actions), "actions.ts 那两行没显式读 action.query / action.url");
  ok(/id: "web_search"[^}]*status: "ready"/.test(perms), "permissions.ts 里 web_search 还不是 ready");
  ok(!/web_search"[^}]*status: "todo"/.test(perms), "permissions.ts 里 web_search 还挂着 todo");
  ok(/const EXPECTED_KIND_COUNT = 70;/.test(registry), "verify-action-registry.mjs 的计数没同步到 70");
  ok(/const EXPECTED_TOTAL = 70;/.test(recall), "verify-tool-recall.mjs 的计数没同步到 70");
  /*
    ⚠️ 这份抄件的写法是两元素数组 `["web.search", "工具"]`（**不是对象**）——
    第一版断言写成了对象字面量，于是"文件明明是对的、断言却是红的"。
  */
  ok(
    /\[\s*"web\.search"\s*,\s*"工具"\s*\]/.test(recall) && /\[\s*"web\.fetch"\s*,\s*"工具"\s*\]/.test(recall),
    "verify-tool-recall.mjs 的抄件缺那两个 kind（或写法跟断言不一致）",
  );
  ok(/web\.search/.test(corpus), "召回语料里没有一句'我要联网'的话");
  /*
    ⚠️ 这里**只能盯那一行声明**，不能用 `/68/` 扫全文 —— 那份脚本的注释里
    留着动作数量的演进史（61 → 63 → 62 → 68 → 70），扫全文必然误报。
  */
  ok(!/EXPECTED_KIND_COUNT = 68/.test(registry) && !/EXPECTED_TOTAL = 68/.test(recall), "还有写死的 68 没同步");
  console.log("  ✅ 三边 + 执行分支 + 权限 + 计数（70）都在");
}

/* ── §6 可选冒烟：真打一次 Bing RSS（跑不通不算失败）────────── */

head("6) 联网冒烟：真打一次 cn.bing.com 的 RSS（可选）");
if (process.env.QIDAO_SKIP_NET === "1") {
  note("按 QIDAO_SKIP_NET=1 跳过了联网冒烟");
  console.log("  跳过（QIDAO_SKIP_NET=1）");
} else {
  const r = await webSearch("测试", { timeoutMs: 12_000, limit: 5 });
  if (r.ok) {
    console.log(`  ✅ 通了：engine=${r.engine} 拿到 ${r.results.length} 条`);
    for (const h of r.results.slice(0, 3)) console.log(`     · ${h.title} | ${h.url}`);
    ok(r.results.length >= 1, "冒烟：解析出 0 条");
  } else {
    // 这台机器可能没外网 —— 如实报告，不算失败
    warn(`联网冒烟没打通（不算失败，如实报告）：${r.why}`);
    console.log(`  ⚠️ 没打通：${r.why}`);
  }
}

/* ── 收尾 ─────────────────────────────────────────────────── */

await new Promise((resolve) => server.close(resolve));

console.log(`\n──────── 结果 ────────`);
if (notes.length) console.log(notes.map((n) => `· ${n}`).join("\n"));
if (warns.length) console.log(`⚠️ 警告 ${warns.length}：\n` + warns.map((w) => `  · ${w}`).join("\n"));
if (fails.length) {
  console.log(`❌ 失败 ${fails.length}：\n` + fails.map((f) => `  · ${f}`).join("\n"));
  process.exit(1);
}
console.log("✅ 全过（SSRF 清单 / 抽取 / 超时 / 超大 / 非 2xx / RSS 解析 / 口径一致 / 注册与计数）");
process.exit(0);
