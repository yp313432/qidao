/**
 * 验收脚本：**后台问不到上游时，它自己会说清"为什么找不到上游"**
 * （用户真机上连续约 90 次 `Unable to resolve host "api.deepseek.com"` 那件事）。
 *
 * 用户的处境：
 *   · 前台点「通道自检」→ 🟢 380ms 就通（地址 / key / 网络都对）
 *   · 后台每小时醒来 → 连续报 `No address associated with hostname`
 *   · 而更早走 Worker 备路时后台**能**解析（拿到过一个被污染的 IP）
 *   ⇒ 光看那一句，分不清是"后台整条网络不通"还是"只有这个域名解析不了"。
 *
 * 做法跟 `verify-wake-direct.mjs` 一样：把后台那段 JS（`public/runners/wake.js`）
 * **原样执行**，只替掉它依赖的四个全局；假上游用真的本地 HTTP 服务，
 * 对照组（`https://www.baidu.com/`）和"解析失败"用可编程的 fetch 桩来扮。
 *
 * 证明这些：
 *   ① 上游解析失败 + **对照组也不通** → 通知里是「后台没网（连百度都不通）」
 *   ② 上游解析失败 + **对照组通** → 结论是「只有你的上游解析不出来」（带上域名）
 *   ③ 上游超时 + 对照组通 → 结论是「上游连不上（连接超时）」
 *   ④ **网络类失败会重试**：假上游一共被请求 3 次（2s / 5s 两档）
 *   ⑤ **4xx 一次都不重试**（key 错重试多少次都一样），也不做诊断
 *   ⑥ **每次诊断结论都进了 `wake_log`**（带本地时间），日志里**没有 key**
 *   ⑦ 结论**变了**时，就算还在 60 分钟冷却里也要通知（不然用户要多等一小时才知道答案变了）
 *   ⑧ 「第 N 次醒来」已经改成语义更准的「已经连续 N 次没成功」，且 ≥20 封顶成 `20+`
 *   ⑨ 带超时的 fetch：对方不回就自己放弃（这个引擎里没有 AbortController）
 *   ⑩ 重试 + 诊断都在那 30 秒预算里（时间不够就放弃本轮诊断）
 *
 * 跑法：`node verify-wake-diagnose.mjs`（不需要 dev server，不碰 8080）
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const FAKE_PORT = 4646;
const RUNNER_SRC = readFileSync("public/runners/wake.js", "utf8");
const PROBE_HOST = "www.baidu.com";
const REPLY = "刚看你把咖啡换成了热的，胃是不是又不舒服了。";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ───────── 假上游（就是"你的 AI"；只有"通"和"404"两种模式会真打到它）───────── */

let upstreamMode = "ok";
let probeMode = "ok";
let upstreamHits = 0;
let probeHits = 0;
let asked = [];
const realFetch = globalThis.fetch;

const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (upstreamMode === "http-404") {
      /** 故意把"key"回显在错误正文里 —— 顺带验"日志/通知里不许出现 key" */
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Incorrect API key provided: sk-LEAKED123456" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: REPLY } }] }));
  });
});
await new Promise((r) => fake.listen(FAKE_PORT, "127.0.0.1", r));

/* ───────── 把后台那段 JS 跑起来（替掉四个全局）───────── */

let kv = new Map();
let notes = [];
let handler = null;

/** App 交过来的那份配置（就是抽屉里的东西） */
function drawer(over = {}) {
  return {
    cfg_base_url: `http://127.0.0.1:${FAKE_PORT}/v1`,
    cfg_api_key: "sk-FAKE-DIAGNOSE-KEY",
    cfg_model: "fake-model",
    cfg_ai_name: "星芒",
    cfg_enabled: "1",
    cfg_quiet_start: "0",
    cfg_quiet_end: "0",
    cfg_prompt_normal: "你是星芒。现在是 {{TIME}}。距上次说话 {{ELAPSED}}。【平时档】想说就说，没话说回 SKIP。",
    cfg_prompt_force: "你是星芒。现在是 {{TIME}}。距上次说话 {{ELAPSED}}。【必说档】你必须说一句，不许回 SKIP。",
    ...over,
  };
}

function installGlobals() {
  globalThis.CapacitorKV = {
    get: (k) => ({ value: kv.get(k) ?? "" }),
    set: (k, v) => kv.set(k, String(v)),
  };
  globalThis.CapacitorNotifications = { schedule: (arr) => notes.push(...arr) };
  globalThis.addEventListener = (n, f) => {
    if (n === "qidaoWake") handler = f;
  };
  globalThis.fetch = (url, init) => {
    const u = String(url);
    asked.push(u);
    /** 对照组：按脚本扮"通"或"不通"（真联网会让断言随网络抖） */
    if (u.indexOf(PROBE_HOST) >= 0) {
      probeHits += 1;
      if (probeMode === "ok") return Promise.resolve({ status: 200, text: async () => "" });
      return Promise.reject(
        new TypeError(
          probeMode === "timeout"
            ? "timed out"
            : 'Unable to resolve host "www.baidu.com": No address associated with hostname',
        ),
      );
    }
    upstreamHits += 1;
    /**
     * 真机上那句话是安卓引擎给的，这里照原样扮出来（连引号都一样）：
     * `Unable to resolve host "api.deepseek.com": No address associated with hostname`
     */
    if (upstreamMode === "dns") {
      return Promise.reject(
        new TypeError('Unable to resolve host "api.deepseek.com": No address associated with hostname'),
      );
    }
    if (upstreamMode === "timeout") return Promise.reject(new Error("等了 5000 毫秒没回应（超时）"));
    return realFetch(u, init);
  };
}

/** 模拟"系统叫醒它一次" */
async function wake(config, kvSeed = new Map(), randoms = [0.1]) {
  kv = kvSeed;
  notes = [];
  asked = [];
  upstreamHits = 0;
  probeHits = 0;
  handler = null;

  installGlobals();
  const realRandom = Math.random;
  let i = 0;
  Math.random = () => randoms[Math.min(i++, randoms.length - 1)];

  // eslint-disable-next-line no-new-func
  new Function(RUNNER_SRC)();
  if (!handler) throw new Error('后台 JS 没有注册 addEventListener("qidaoWake")');
  for (const [k, v] of Object.entries(config)) kv.set(k, v);

  await new Promise((resolve, reject) => {
    /** 重试本身要花 2s + 5s，所以这里给足（但必须收尾，后台那边没有超时） */
    const t = setTimeout(() => reject(new Error("处理函数没有回调（后台那边会永远挂着）")), 25_000);
    handler(
      () => {
        clearTimeout(t);
        resolve();
      },
      (e) => {
        clearTimeout(t);
        reject(new Error(`reject 了：${e && e.message ? e.message : e}`));
      },
    );
  });
  Math.random = realRandom;
  return { notes, kv, upstreamHits, probeHits, asked };
}

/** 拿后台文件里的内部函数做几个"单元"级检查（不导出也能拿到） */
installGlobals();
// eslint-disable-next-line no-new-func
const internals = new Function(
  RUNNER_SRC + "\nreturn { fetchWithTimeout: fetchWithTimeout, classifyNetError: classifyNetError, verdictOf: verdictOf };",
)();

const body = (r) => r.notes.map((n) => n.body ?? "").join(" || ");
const titleOf = (r) => r.notes.map((n) => n.title ?? "").join(" || ");
const logOf = (r) => String(r.kv.get("wake_log") ?? "");

/* ═════════ 一】上游解析失败 + 对照组也不通 → 「后台没网」 ═════════ */

console.log("【一】上游解析失败 + 对照组也不通 → 通知里就是「后台没网」");
{
  upstreamMode = "dns";
  probeMode = "timeout";
  /** 用户真机上是连续 90 次 —— 顺便验「≥20 封顶成 20+」 */
  const r = await wake(drawer(), new Map([["fail_streak", "25"]]));
  const b = body(r);

  check("网络类失败重试了：假上游一共被请求 3 次", r.upstreamHits === 3, `请求 ${r.upstreamHits} 次`);
  check("探过对照组（确定答案就是它给的）", r.probeHits === 1, `对照 ${r.probeHits} 次`);
  check("弹了一条「没成功」的通知（用户还在真机上等这条）", r.notes.length === 1 && /没成功/.test(titleOf(r)), `title=${titleOf(r)}`);
  check("通知正文是「后台没网」那类结论（连百度都不通）", /后台没网/.test(b) && /baidu/.test(b), b.slice(0, 90));
  check("数字封顶：连续 26 次写成 20+（不再挂个 90 上去）", /已经连续 20\+ 次没成功/.test(b), b.slice(0, 40));
  check("通知里没有 key", !/sk-FAKE-DIAGNOSE-KEY/.test(b));

  const log = logOf(r);
  check("诊断结论进了 wake_log（bg-offline）", /诊断：bg-offline/.test(log), log.split("\n")[0] ?? "");
  check("日志里带本地时间戳", /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(log));
  check("日志里没有 key", !/sk-FAKE-DIAGNOSE-KEY/.test(log));
}

/* ═════════ 二】上游失败 + 对照组通 → 「只有你的上游解析不出来」 ═════════ */

console.log("\n【二】上游失败 + 对照组通 → 「只有你的上游解析不出来」");
let kvAfterB = null;
{
  upstreamMode = "dns";
  probeMode = "ok";
  const r = await wake(drawer(), new Map());
  kvAfterB = r.kv;
  const b = body(r);

  check("重试还是 3 次", r.upstreamHits === 3, `请求 ${r.upstreamHits} 次`);
  check("只探了一次对照组", r.probeHits === 1, `对照 ${r.probeHits} 次`);
  check("结论：只有你的上游解析不出来（带域名）", /只有你的上游解析不出来/.test(b) && /api\.deepseek\.com/.test(b), b.slice(0, 100));
  check("并且说清「百度能通」（对照组是通的）", /百度能通/.test(b), b.slice(0, 100));
  check("「已经连续 1 次没成功」（第一次失败，不封顶）", /已经连续 1 次没成功/.test(b), b.slice(0, 40));
  check("诊断结论进了 wake_log（dns-only）", /诊断：dns-only/.test(logOf(r)), logOf(r).split("\n")[0] ?? "");
}

/* ═════════ 三】上游超时 + 对照组通 → 「上游连不上（连接超时）」 ═════════ */

console.log("\n【三】上游超时 + 对照组通 → 「上游连不上（连接超时）」");
{
  upstreamMode = "timeout";
  probeMode = "ok";
  /** ⚠️ 故意**沿用上一轮那份 KV**（last_err_at 就在刚才、还在 60 分钟冷却里） */
  const r = await wake(drawer(), kvAfterB ?? new Map());
  const b = body(r);

  check("结论：上游连不上（连接超时）", /上游连不上/.test(b) && /超时/.test(b), b.slice(0, 100));
  check("诊断结论进了 wake_log（connect-timeout）", /诊断：connect-timeout/.test(logOf(r)), logOf(r).split("\n")[0] ?? "");
  check(
    "结论变了 → 冷却期内照样通知（不然用户要多等一小时才知道答案变了）",
    r.notes.length === 1,
    `通知 ${r.notes.length} 条`,
  );
  check("「连续没成功」在累加（1 → 2）", /已经连续 2 次没成功/.test(b), b.slice(0, 40));
}

/* ═════════ 四】4xx：一次都不重试，也不诊断 ═════════ */

console.log("\n【四】4xx（key 错这类）：**不重试**、不诊断，只把状态码说出来");
{
  upstreamMode = "http-404";
  probeMode = "ok";
  const r = await wake(drawer(), new Map());
  const b = body(r);

  check("4xx 只问了一次（重试多少次结果都一样）", r.upstreamHits === 1, `请求 ${r.upstreamHits} 次`);
  check("没做对照探测（不是网络问题，用不着诊断）", r.probeHits === 0, `对照 ${r.probeHits} 次`);
  check("通知里写的是「上游返回 404」", /上游返回 404/.test(b), b.slice(0, 80));
  check("日志里没有诊断行", !/诊断：/.test(logOf(r)), logOf(r).split("\n")[0] ?? "");
  check(
    "上游回显的 key 被打码（sk-****）——日志和通知里都不许有 key",
    !/sk-LEAKED123456/.test(b) && !/sk-LEAKED123456/.test(logOf(r)) && /sk-\*\*\*\*/.test(b),
    b.slice(0, 100),
  );
}

/* ═════════ 五】几个"单元"级判据（拿文件里的内部函数直接问） ═════════ */

console.log("\n【五】判据本身对不对（拿内部函数直接问）");
{
  check(
    "安卓那句 No address associated with hostname → 解析失败",
    internals.classifyNetError('Unable to resolve host "api.deepseek.com": No address associated with hostname') === "dns",
  );
  check("超时 → timeout", internals.classifyNetError("等了 5000 毫秒没回应（超时）") === "timeout");
  check(
    "备路那条 Failed to connect to …:443 → 连接问题（不是解析）",
    internals.classifyNetError("Failed to connect to qidao.xxx.workers.dev/108.160.167.147:443") === "connect",
  );
  check("对照组不通 → bg-offline", internals.verdictOf("timeout", "dns", "api.deepseek.com").code === "bg-offline");
  check("对照组通 + 解析失败 → dns-only", internals.verdictOf("ok", "dns", "api.deepseek.com").code === "dns-only");
  check("对照组通 + 超时 → connect-timeout", internals.verdictOf("ok", "timeout", "api.deepseek.com").code === "connect-timeout");

  /** 对方永不回包 → 到点必须自己放弃（这个引擎里没有 AbortController 可用） */
  installGlobals();
  globalThis.fetch = () => new Promise(() => {});
  const t0 = Date.now();
  let why = "";
  try {
    await internals.fetchWithTimeout("https://example.test/", {}, 300);
  } catch (e) {
    why = e && e.message ? e.message : String(e);
  }
  const spent = Date.now() - t0;
  check("带超时的 fetch：对方不回就自己超时（不会把这次唤醒挂死）", /超时/.test(why), why);
  check("是到点才放弃的（没有提前也没拖很久）", spent >= 250 && spent < 2000, `${spent}ms`);
}

/* ═════════ 六】静态对账：预算 / 间隔 / 没有 AbortController ═════════ */

console.log("\n【六】静态对账（预算、间隔、地址）");
{
  /**
   * ⚠️ 判断"代码有没有干某事"必须先剥注释 —— 说明这段坑的注释里就写着 `AbortController`
   * （"这个引擎里没有它"），拿原文扫会把自己那份说明判成违规（`verify-background-wake.mjs` 踩过）。
   */
  const codeOnly = RUNNER_SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

  check("30 秒预算写死在代码里", /WAKE_BUDGET_MS\s*=\s*30000/.test(RUNNER_SRC));
  check("重试间隔就是 2s / 5s", /RETRY_DELAYS_MS\s*=\s*\[\s*2000\s*,\s*5000\s*\]/.test(RUNNER_SRC));
  check("对照组是国内那个 https://www.baidu.com/", /PROBE_URL\s*=\s*"https:\/\/www\.baidu\.com\/"/.test(RUNNER_SRC));
  check(
    "诊断也受预算约束（剩得太少就跳过对照探测）",
    /PROBE_MIN_MS/.test(RUNNER_SRC) && /时间不够/.test(RUNNER_SRC),
  );
  check(
    "没用 AbortController / signal（这个引擎不支持，写上去等于没有超时）",
    !/AbortController|signal\s*:/.test(codeOnly),
  );
}

await new Promise((r) => fake.close(r));

console.log("-".repeat(64));
console.log(`后台失败自诊断的验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
