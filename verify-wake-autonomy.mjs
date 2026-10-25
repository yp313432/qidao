/**
 * 验收脚本：**自主行动那条路不会再"醒了却什么都没发生"**。
 *
 * 背景（2026-10-25 真机）：
 *   用户装上新包后，后台记录里每小时只有一行「这次看他（50% 命中）」，
 *   再往下什么都没有 —— 没有「开始问他」、没有「说了…」、日记和自由活动也不执行。
 *
 * 根因：`public/runners/wake.js` 里把 `Date.now()` 的数字当 Date 用
 *   （`now.getHours()`）→ 抛 TypeError → 被最外层 `catch (err) { reject(err); }`
 *   吞掉，**界面上一点痕迹都没有**。
 *
 * 这个脚本证明：
 *   ① 自主活动开着（自由活动）→ 进「一段生活」的 loop，真的发请求、真的记日志
 *   ② 日记保底窗口 → 走普通那条，日志里有「开始问他」
 *   ③ 异常一定留痕（源码里 catch 之后不许只 reject）
 *   ④ 源码里不许再把 `now` 当 Date 用
 *
 * 跑法：`node verify-wake-autonomy.mjs`
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const FAKE_PORT = 4641;
const RUNNER_SRC = readFileSync("public/runners/wake.js", "utf8");

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ───────── 假上游（就是"你的 AI"）───────── */
let reply = '{"kind":"garden.walk","place":"池塘"}';
let hits = 0;
let lastBody = null;

const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    hits += 1;
    try {
      lastBody = JSON.parse(raw);
    } catch {
      lastBody = null;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply } }] }));
  });
});
await new Promise((r) => fake.listen(FAKE_PORT, "127.0.0.1", r));

/* ───────── 把后台那段 JS 跑起来（只替掉它依赖的全局）───────── */

let kv = new Map();
let notes = [];
let handler = null;
let asked = [];
const realFetch = globalThis.fetch;

function drawer(over = {}) {
  return {
    cfg_base_url: `http://127.0.0.1:${FAKE_PORT}/v1`,
    cfg_api_key: "sk-FAKE-AUTONOMY-KEY",
    cfg_model: "fake-model",
    cfg_ai_name: "星芒",
    cfg_fingerprint: "deadbeef",
    cfg_enabled: "1",
    cfg_quiet_start: "0",
    cfg_quiet_end: "0",
    cfg_prompt_normal: "你是星芒。现在是 {{TIME}}。想说就说，没话说回 SKIP。",
    cfg_prompt_force: "你是星芒。现在是 {{TIME}}。你必须说一句，不许回 SKIP。",
    /** 自主行动（用户真机就是开着的） */
    cfg_autonomy_on: "1",
    cfg_action_prompt: "你是星芒。现在是 {{TIME}}。这是你自己的时间，想做什么就做什么，做完就回 {}。",
    cfg_action_day: "",
    ...over,
  };
}

async function wake(config, kvSeed = new Map(), randoms = null) {
  kv = kvSeed;
  notes = [];
  asked = [];
  handler = null;

  globalThis.CapacitorKV = {
    get: (k) => ({ value: kv.get(k) ?? "" }),
    set: (k, v) => kv.set(k, String(v)),
  };
  globalThis.CapacitorNotifications = { schedule: (arr) => notes.push(...arr) };
  globalThis.addEventListener = (n, f) => {
    if (n === "qidaoWake") handler = f;
  };
  globalThis.fetch = (...args) => {
    asked.push(String(args[0]));
    return realFetch(...args);
  };

  const realRandom = Math.random;
  if (randoms) {
    let i = 0;
    Math.random = () => randoms[Math.min(i++, randoms.length - 1)];
  }

  new Function(RUNNER_SRC)();
  if (!handler) throw new Error('后台 JS 没有注册 addEventListener("qidaoWake")');

  for (const [k, v] of Object.entries(config)) kv.set(k, v);

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("处理函数没有回调（后台那边会永远挂着）")), 20_000);
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
  return { notes, kv, asked };
}

const logOf = (r) => String(r.kv.get("wake_log") ?? "");

/* ═════════ ① 自由活动 → 进「一段生活」的 loop ═════════ */

console.log("【一】自主活动开着、掷到「自由活动」→ 真去问，且分步做");
{
  reply = '{"kind":"garden.walk","place":"池塘"}';
  let r = null;
  let err = "";
  try {
    r = await wake(
      drawer({
        cfg_action_echo: "0",
        cfg_action_diary: "0",
        cfg_action_free: "1",
        cfg_action_free_max: "3",
        cfg_action_free_pct: "100",
      }),
      new Map(),
      // 第 1 个随机数给"要不要看他"（0.1 → 看），第 2 个给自由活动的骰子（0.1 → 10% < 100%）
      [0.1, 0.1, 0.1, 0.1, 0.1],
    );
  } catch (e) {
    err = String(e && e.message ? e.message : e);
  }
  check("没有再抛异常（原来这里必然 TypeError）", err === "", err);
  check("真的发出了请求", (r?.asked.length ?? 0) > 0, `请求 ${r?.asked.length ?? 0} 次`);
  const log = r ? logOf(r) : "";
  /**
   * 自由活动只在 9:00–22:00 那扇窗里掷骰子（用户定的），所以"这一帧"这条
   * 只有在这个时段跑脚本才成立；窗口外必须**安静地退回普通那条**，而不是崩。
   */
  const hour = new Date().getHours();
  const inFreeWindow = hour >= 9 && hour <= 22;
  if (inFreeWindow) {
    check("在自由活动窗口内 → 进了「一段生活」的 loop", /这一帧做了 \d+ 步/.test(log), log.split("\n")[0] ?? "");
  } else {
    check(
      "窗口外 → 安静退回普通那条（有「开始问他」，不崩）",
      /开始问他/.test(log),
      log.split("\n")[0] ?? "",
    );
  }
  check("日志里没有 TypeError", !/TypeError/.test(log));
  check("「正在问上游」的标记被清掉（不会误报卡住）", String(r?.kv.get("wake_stage") ?? "") === "");
}

/* ═════════ ② 日记保底窗口 → 走普通那条 ═════════ */

console.log("\n【二】日记保底窗口内 → 走「问一次」那条，日志有「开始问他」");
{
  reply = '{"kind":"diary.add","mood":"平静","body":"今天挺好的"}';
  const now = new Date();
  const r = await wake(
    drawer({
      cfg_action_echo: "0",
      cfg_action_diary: "1",
      cfg_action_free: "0",
      cfg_action_hour: String(now.getHours()),
      cfg_action_minute: "0",
    }),
    new Map([["look_acc", "1"]]),
    [0.1],
  );
  const log = logOf(r);
  check("有请求", r.asked.length > 0, `请求 ${r.asked.length} 次`);
  check("日志里有「开始问他」", /开始问他/.test(log), log.split("\n")[0] ?? "");
  check("没有 TypeError", !/TypeError/.test(log));
}

/* ═════════ ③ 源码回归断言 ═════════ */

console.log("\n【三】源码：这两类错不许再回来");
{
  check("没有把 `now`（number）当 Date 用", !/\bnow\.get[A-Z]/.test(RUNNER_SRC));
  const catchTail = RUNNER_SRC.slice(RUNNER_SRC.lastIndexOf("} catch (err)"));
  check("最外层 catch 里必须写日志（不许只 reject）", /logLine\(/.test(catchTail.slice(0, 400)));
  check("自主活动分支用的仍是 clock 变量", /new Date\(now\)/.test(RUNNER_SRC));
}

await new Promise((r) => fake.close(r));
await new Promise((r) => setTimeout(r, 80));

console.log(bad === 0 ? "\n全部通过" : `\n${bad} 项没过`);
process.exit(bad === 0 ? 0 : 1);
