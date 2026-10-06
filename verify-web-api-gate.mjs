/**
 * 验收脚本：**口令门 + 联网中转**一起验（dev server 要带 QIDAO_PASSPHRASE 启动）。
 *
 * 为什么要专门验这一条：这道门保护的是用户**已经部署在公网**的那个 Worker。
 * 改门 = 改线上入口，写错了要么自己被锁在外面、要么门形同虚设。
 * 所以两种"带票"方式、以及"没票必须被拦"，都要有断言盯着。
 *
 * 跑法：
 *   $env:QIDAO_PASSPHRASE="TESTPASS"; npm run dev     # 另开一个终端
 *   node verify-web-api-gate.mjs
 */
const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const PASS = process.env.QIDAO_TEST_PASS ?? "TESTPASS";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

async function get(path, headers = {}) {
  const res = await fetch(BASE + path, { headers, redirect: "manual" });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* 不是 JSON */
  }
  return { status: res.status, headers: res.headers, body, text };
}

const readPath = "/api/read?url=" + encodeURIComponent("https://cn.bing.com/search?q=react");

/* 1. 没票：必须被拦 */
const anon = await get(readPath);
check("没票调接口 → 401（门是关着的）", anon.status === 401, `HTTP ${anon.status} ${anon.body?.message ?? ""}`);

const anonPage = await get("/");
check("没票开页面 → 401 且是那张口令门", anonPage.status === 401 && anonPage.text.includes("口令"), `HTTP ${anonPage.status}`);

/* 2. 票不对：也必须被拦 */
const wrong = await get(readPath + `&pass=${encodeURIComponent("WRONG")}`);
check("票不对 → 401", wrong.status === 401, `HTTP ${wrong.status}`);

/* 3. 查询参数带票：放行（App 走这条 —— 不触发跨域预检） */
const viaQuery = await get(readPath + `&pass=${encodeURIComponent(PASS)}`);
check("查询参数带票 → 放行，真读到网页", viaQuery.status === 200 && viaQuery.body?.ok === true, `HTTP ${viaQuery.status} chars=${viaQuery.body?.chars}`);

/* 4. 请求头带票：也放行（curl / 以后别的客户端用） */
const viaHeader = await get(readPath, { "x-qidao-pass": PASS });
check("请求头带票 → 放行", viaHeader.status === 200 && viaHeader.body?.ok === true, `HTTP ${viaHeader.status}`);

/* 5. 预检不拦（否则带自定义头的客户端连请求都发不出） */
const opt = await fetch(BASE + "/api/read", { method: "OPTIONS" });
check("预检 OPTIONS → 不拦（204/200，不是 401）", opt.status !== 401, `HTTP ${opt.status}`);

/* 6. 放行之后跨域头仍然在 */
check(
  "放行后的响应仍带跨域头",
  viaQuery.headers.get("access-control-allow-origin") === "*",
  viaQuery.headers.get("access-control-allow-origin") ?? "(空)",
);

console.log("-".repeat(64));
console.log(`口令门验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
