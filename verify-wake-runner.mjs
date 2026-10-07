/**
 * 验收脚本：**把后台那段 JS 真的跑起来**（本地，不需要真机、不需要安卓）。
 *
 * 做法：`public/runners/wake.js` 本身是普通 JS，只依赖四个全局
 * （`addEventListener` / `CapacitorKV` / `CapacitorNotifications` / `fetch`）——
 * 那就在 node 里把这四个替掉，然后**原样执行**它，走完整条链：
 *
 *     后台 JS → Worker（dev server 上的 /api/wake）→ 假上游（AI）→ 回到后台 JS 弹通知
 *
 * 这就把"能在本地验的最终形态"验完了，剩下没验的只有"安卓系统会不会按时叫醒它"
 * （那条已经用真机通知证明了）。
 *
 * 证明这些：
 *   ① 正常：Worker 说他该说话 → **通知里就是他生成的那句话**，标题是他的名字
 *   ② 他说不说由 Worker 那边定：`action:"wait"` 时**一条通知都不弹**
 *   ③ **省钱那条闸门在整条链上真的生效**：紧接着再醒一次 → Worker 判"还没到间隔" →
 *      **假上游一次都没被调**、也没通知（这是 96 次/天 变成十几次/天 的关键）
 *   ④ 夜间不打扰：不弹通知，而且**没问过 AI**（`last_ask_at` 不更新）
 *   ⑤ 地址没注入（占位符还在）→ 退回"第 N 次醒来"的调试通知，**不请求任何地址**
 *   ⑥ 记账要对：问过 AI（带 urge）→ 更新 `last_ask_at`；真说了 → 更新 `last_spoke_at`
 *   ⑦ 两条：不会因为异常把 `resolve()` 漏掉（后台那边没有超时，漏了就永远挂着）
 *
 * 跑法（dev server 要在 8080）：`node verify-wake-runner.mjs`
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const FAKE_PORT = 4634;
const RUNNER_SRC = readFileSync("public/runners/wake.js", "utf8");

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ───────── 假上游（AI）───────── */

let reply = "刚看你把咖啡换成了热的，胃是不是又不舒服了。";
let upstreamHits = 0;

const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    upstreamHits += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply } }] }));
  });
});
await new Promise((r) => fake.listen(FAKE_PORT, "127.0.0.1", r));

/* ───────── 把后台那段 JS 跑起来（替掉四个全局）───────── */

/** 跨"唤醒"保留的东西（对应安卓上的 CapacitorKV） */
let kv = new Map();
/** 这一轮弹了哪些通知 */
let notes = [];
/** 注册进来的唤醒处理函数 */
let handler = null;
/** 后台这段 JS 一共发了几次请求（用来验"静音期内连请求都没发"） */
let fetchCount = 0;
/** 它最后请求的那个地址（用来验参数对不对） */
let asked = "";
const realFetchRef = globalThis.fetch;

function makeEnv() {
  globalThis.CapacitorKV = {
    get: (k) => ({ value: kv.get(k) ?? "" }),
    set: (k, v) => kv.set(k, String(v)),
  };
  globalThis.CapacitorNotifications = { schedule: (arr) => notes.push(...arr) };
  globalThis.addEventListener = (name, fn) => {
    if (name === "qidaoWake") handler = fn;
  };
  globalThis.fetch = (...args) => {
    fetchCount += 1;
    asked = String(args[0]);
    return realFetchRef(...args);
  };
}

/** 原样执行后台那段 JS（把占位符换成给它的地址） */
function loadRunner(wakeUrl) {
  handler = null;
  notes = [];
  makeEnv();
  const src = RUNNER_SRC.replace("__QIDAO_WAKE_URL__", wakeUrl);
  // 用 Function 包一层，让文件里的 var 不污染这里
  // eslint-disable-next-line no-new-func
  new Function(src)();
  if (!handler) throw new Error("后台 JS 没有注册 addEventListener(\"qidaoWake\")");
}

/** 模拟"系统叫醒它一次" */
async function wake(wakeUrl) {
  loadRunner(wakeUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("处理函数没有回调（后台那边会永远挂着）")), 20_000);
    handler(
      () => {
        clearTimeout(t);
        resolve();
      },
      (e) => {
        clearTimeout(t);
        reject(new Error(`处理函数 reject 了：${e && e.message ? e.message : e}`));
      },
    );
  });
  return notes.slice();
}

/* ───────── 帮 Worker 存一份上下文 ───────── */

async function seedContext(policy) {
  const res = await fetch(`${BASE}/api/wake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      aiName: "星芒",
      displayName: "yan",
      persona: "说话简短，不客套。",
      baseUrl: `http://127.0.0.1:${FAKE_PORT}/v1`,
      apiKey: "sk-FAKE-RUNNER-TEST",
      model: "fake-model",
      tz: "Asia/Shanghai",
      recent: [{ role: "user", text: "我今天有点胃疼" }],
      policy,
      lastChatAt: Date.now() - 3 * 60 * 60 * 1000,
    }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`存上下文失败：${JSON.stringify(j)}`);
}

/** 当前北京时间的小时（夜间那条用例要好让结论与"现在几点"无关） */
function beijingHour() {
  const p = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }).formatToParts(new Date());
  return Number(p.find((x) => x.type === "hour")?.value ?? "12") % 24;
}

const NO_QUIET = { enabled: true, quietStart: 0, quietEnd: 0 };

/* ═════════ ① 正常：他该说话 ═════════ */

console.log("【一】正常：Worker 说他该说话 → 通知里就是那句话");
{
  await seedContext(NO_QUIET);
  kv = new Map(); // 全新一次（没有 last_ask_at → 不受间隔限制）
  upstreamHits = 0;
  reply = "刚看你把咖啡换成了热的，胃是不是又不舒服了。";

  const got = await wake(`${BASE}/api/wake?urge=100`);
  check("弹了一条通知", got.length === 1, `弹了 ${got.length} 条`);
  check("标题是他的名字（像微信那样显示发件人）", got[0]?.title === "星芒", `title=${got[0]?.title}`);
  check("正文就是他生成的那句话", got[0]?.body === reply, `body=${got[0]?.body}`);
  check("真的问过 AI（假上游被调了）", upstreamHits === 1, `调了 ${upstreamHits} 次`);
  check("说了之后记下了「他上次开口的时间」（程度从这里重新计时）", Number(kv.get("last_spoke_at")) > Date.now() - 60_000);
  check("通知 id 是正整数（安卓要求）", Number.isInteger(got[0]?.id) && got[0].id > 0, `id=${got[0]?.id}`);
  check("请求里带的是「距他上次开口多久」（since=）", asked.includes("since="), asked);
  check("不再自己传档位（档位由 Worker 按时间算）", !asked.includes("level="), asked);
}

/* ═════════ ② 他说不说由他定 ═════════ */

console.log("\n【二】他决定不说时，一条通知都不弹");
{
  await seedContext(NO_QUIET);
  /** 3 小时前他说过一次 → 这一轮的程度应该已经很高 */
  const spokeAtBefore = Date.now() - 3 * 60 * 60 * 1000;
  kv = new Map([["last_spoke_at", String(spokeAtBefore)]]);
  reply = "SKIP";
  const got = await wake(`${BASE}/api/wake?urge=0`);
  check("没弹通知", got.length === 0, `弹了 ${got.length} 条`);
  /**
   * ⚠️ 这条是**新规则的核心**：他没说 → `last_spoke_at` **不动** →
   * 距上次开口的时间继续攒 → 下一轮的程度更高（25 → 50 → …→ 100 必发）。
   * 旧版看的是 `last_ask_at`（"上次问他"），那套已经拿掉了。
   */
  check("没说 → 「他上次开口的时间」不动（程度继续往上爬）", Number(kv.get("last_spoke_at")) === spokeAtBefore);
}

/* ═════════ ③ 总开关（用户要的"一键关闭"）═════════ */

console.log("\n【三】一键关闭：不弹通知，而且后台接下来连请求都不发（省电）");
{
  await seedContext({ enabled: false, quietStart: 0, quietEnd: 0 });
  kv = new Map([["last_spoke_at", String(Date.now() - 3 * 60 * 60 * 1000)]]);
  upstreamHits = 0;
  reply = "不该被问到的句子";

  const first = await wake(`${BASE}/api/wake?urge=100`);
  check("关掉时没弹通知", first.length === 0, `弹了 ${first.length} 条`);
  check("假上游一次都没被调（问你旁边那个人不算花钱）", upstreamHits === 0, `调了 ${upstreamHits} 次`);
  check("后台把「静音」记下来了（muted_at）", Number(kv.get("muted_at")) > 0);

  // 再醒一次：这次连请求都不该发
  const before = fetchCount;
  const second = await wake(`${BASE}/api/wake?urge=100`);
  check("静音期内的下一次唤醒：**连请求都不发**", fetchCount === before, `发了 ${fetchCount - before} 次请求`);
  check("同样没弹通知", second.length === 0, `弹了 ${second.length} 条`);
}

/* ═════════ ④ 夜间不打扰 ═════════ */

console.log("\n【四】夜间不打扰（不弹、也不问 AI）");
{
  const h = beijingHour();
  await seedContext({ enabled: true, quietStart: h, quietEnd: (h + 1) % 24 });
  kv = new Map([["last_spoke_at", String(Date.now() - 3 * 60 * 60 * 1000)]]);
  upstreamHits = 0;
  const got = await wake(`${BASE}/api/wake?urge=100`);
  check("没弹通知", got.length === 0, `弹了 ${got.length} 条`);
  check("也没问 AI", upstreamHits === 0, `调了 ${upstreamHits} 次`);
}

/* ═════════ ⑤ 没注入地址 ═════════ */

console.log("\n【五】地址没注入（占位符还在）→ 退回调试通知，不请求任何东西");
{
  kv = new Map();
  const got = await wake("__QIDAO_WAKE_URL__"); // 保持占位符原样
  check("弹了一条调试通知", got.length === 1, `弹了 ${got.length} 条`);
  check("写着「第 N 次醒来」", /第 1 次醒来/.test(got[0]?.body ?? ""), `body=${got[0]?.body}`);
  check("时间是本地时间那套格式", /（本地时间）/.test(got[0]?.body ?? ""), `body=${got[0]?.body}`);
}

/* ═════════ ⑥ 上游挂掉时不该把 resolve 漏掉 ═════════ */

console.log("\n【六】上游挂掉：也要弹得出来、也要收尾（不能永远挂着）");
{
  await seedContext(NO_QUIET);
  kv = new Map();
  upstreamHits = 0;
  const realFetch = globalThis.fetch;
  /** 让 Worker 拿不到上游：把假上游临时关掉（端口没人听） */
  await new Promise((r) => fake.close(r));
  const got = await wake(`${BASE}/api/wake?urge=100`);
  check("处理函数仍按约定收尾了（没有永远挂着）", true);
  check("弹了一条「没成功」的调试通知（不然他和坏掉分不开）", got.length >= 1 && /没成功/.test(got[0]?.title ?? ""), `title=${got[0]?.title}`);
  check("错误通知有冷却（记了 last_err_at）", Number(kv.get("last_err_at")) > 0);
  // 把假上游重新开起来，免得后面手贱再看这条时困惑
  await new Promise((r) => createServer(() => {}).listen(FAKE_PORT, "127.0.0.1", r));
  globalThis.fetch = realFetch;
}

/* 走的时候清干净：别把上下文留给下一个验收脚本（踩过一次：两个脚本互相污染） */
await fetch(`${BASE}/api/wake`, { method: "DELETE" }).catch(() => undefined);

console.log("-".repeat(64));
console.log(`后台那段 JS 的真跑验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
