/**
 * 验收脚本：用户自己那个 Cloudflare Worker 上的三条"联网中转"接口。
 *
 * 为什么本地能验：这些路由就是普通的服务端 fetch + Response，
 * dev server 和线上 Worker 跑的是**同一份代码**（只是运行环境不同）。
 * 所以先在本地把它们验干净，再推上去自动部署。
 *
 * 验的是：
 *   ① `/api/read` 真能读到网页正文（这是浏览器里绝对做不到的那件事）
 *   ② 跨域头对（App 的 WebView 源要能读）
 *   ③ 预检 OPTIONS 答得对（App 带自定义头会先发预检）
 *   ④ **SSRF 挡住了**（不让别人拿这个接口去戳内网）
 *   ⑤ `/api/search` 没 key 时有兜底，并且如实说明用的哪条路
 *   ⑥ `/api/hot?src=news` 免 key 那条能用
 *   ⑦ `/api/hot?src=weibo` 没配 key 时**明确要 key**，不编数据
 *
 * 跑法：node verify-web-api.mjs
 */
const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
/**
 * 如果被测服务器开了口令门（`QIDAO_PASSPHRASE`），这里带上票。
 * ⚠️ 用**查询参数**带票而不是请求头：不触发跨域预检，在哪都成立
 *    （预检在 dev server 上会被 Vite 自带的 CORS 先答掉，属于 dev 专属现象）。
 */
const PASS = process.env.QIDAO_TEST_PASS ?? "";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

async function get(path, headers = {}) {
  const withPass = PASS
    ? path + (path.includes("?") ? "&" : "?") + "pass=" + encodeURIComponent(PASS)
    : path;
  const res = await fetch(BASE + withPass, { headers, redirect: "manual" });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* 不是 JSON 就留 null */
  }
  return { status: res.status, headers: res.headers, body, text };
}

/* ── ① 读网页正文 ──
   ⚠️ 测试目标要挑**这台机器能访问到的**：example.com 和 60s.viki.moe 在 Node 里
   是连接超时（浏览器能通、Node 不通，本机网络差异），拿它们当靶子会假失败。
   线上 Worker 在境外网络，不受这个限制。 */
const readTarget = "https://cn.bing.com/search?q=react";
const read = await get("/api/read?url=" + encodeURIComponent(readTarget));
check("读网页：接口通了", read.status === 200 && read.body?.ok === true, `HTTP ${read.status}`);
check(
  "读网页：真把 HTML 转成了正文（不是空壳）",
  (read.body?.text ?? "").length > 200 && /react/i.test(read.body?.text ?? ""),
  `title=${read.body?.title} chars=${read.body?.chars}`,
);

/* ── ② 跨域头 ── */
check(
  "读网页：带了跨域头（App 的 WebView 才读得到）",
  read.headers.get("access-control-allow-origin") === "*",
  `ACAO=${read.headers.get("access-control-allow-origin")}`,
);

/* ── ③ 预检 ── */
const opt = await fetch(BASE + "/api/read", { method: "OPTIONS", headers: { Origin: "https://localhost" } });
check("预检 OPTIONS：答 204", opt.status === 204, `HTTP ${opt.status}`);
check(
  "预检 OPTIONS：放行了 x-qidao-pass 这个头",
  (opt.headers.get("access-control-allow-headers") ?? "").includes("x-qidao-pass"),
  opt.headers.get("access-control-allow-headers") ?? "(空)",
);

/* ── ④ SSRF 防护 ── */
const ssrf1 = await get("/api/read?url=" + encodeURIComponent("http://127.0.0.1:8080/"));
check("SSRF：内网/本机地址被拒", ssrf1.status === 400 && ssrf1.body?.ok === false, ssrf1.body?.why ?? "");
const ssrf2 = await get("/api/read?url=" + encodeURIComponent("http://10.0.0.1/admin"));
check("SSRF：私有网段被拒", ssrf2.status === 400, ssrf2.body?.why ?? "");
const ssrf3 = await get("/api/read?url=" + encodeURIComponent("file:///etc/passwd"));
check("SSRF：非 http(s) 协议被拒", ssrf3.status === 400, ssrf3.body?.why ?? "");
const noParam = await get("/api/read");
check("读网页：没给 url 时明确报错（不是 500）", noParam.status === 400, noParam.body?.why ?? "");

/* ── ⑤ 搜索（没配 BOCHA_KEY，走兜底抓取） ── */
const search = await get("/api/search?q=" + encodeURIComponent("react"));
const results = search.body?.results ?? [];
check("搜索：返回了结果", search.status === 200 && search.body?.ok === true, `engine=${search.body?.engine}`);
check(
  "搜索：结果里有标题和链接",
  results.length > 0 && results[0].title.length > 0 && results[0].url.startsWith("http"),
  results[0] ? `${results[0].title.slice(0, 40)} → ${results[0].url.slice(0, 50)}` : "0 条",
);
check("搜索：如实说明走的哪条上游", typeof search.body?.engine === "string", search.body?.engine ?? "");

/* ── ⑥ 热榜：免 key 的今日新闻 ── */
const news = await get("/api/hot?src=news");
check(
  "热榜：今日新闻（免 key）能用",
  news.status === 200 && (news.body?.items ?? []).length >= 5,
  `${(news.body?.items ?? []).length} 条，日期 ${news.body?.date}`,
);

/* ── ⑦ 热榜：没 key 时如实说 ── */
const weibo = await get("/api/hot?src=weibo");
check(
  "热榜：没配 key 时明确要 key（不编数据）",
  weibo.status === 501 && weibo.body?.needKey === "TIANAPI_KEY" && (weibo.body?.items ?? []).length === 0,
  weibo.body?.why?.slice(0, 60) ?? "",
);
const badSrc = await get("/api/hot?src=nonsense");
check("热榜：src 写错时明确报错", badSrc.status === 400, badSrc.body?.why ?? "");

console.log("-".repeat(64));
console.log(`联网中转接口验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
