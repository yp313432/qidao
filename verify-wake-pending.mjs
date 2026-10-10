/**
 * 验收脚本：**后台说过的那句话，有没有**完整**交到抽屉里**（纯 node，不碰 8080）。
 *
 * 用户真机原话：
 *   "那个定时唤醒成功了。我能收到弹窗通知，但是那个通知**不在上下文里**……
 *    这样如果我想回他那句消息的话，进对话里的 AI 是不知道这回事的。"
 *
 * 结构性原因：后台那段 JS 原来只 `CapacitorNotifications.schedule()` 弹通知，
 * 再往 `wake_log` 写一行 —— 而 `wake_log` 是**给人看的日志，还被截成 40 字**。
 * 会话存在 IndexedDB 里、只有 webview 会写，所以那句话根本没有进会话的通道。
 *
 * 现在后台在"他说了"那一刻额外写 `wake_pending_*`（完整那句话 + 时间 + 时间戳）。
 * 这个脚本就盯这条：**跑真的 runner**（`public/runners/wake.js` 原样执行，
 * 只替掉它依赖的四个全局），证明：
 *   ① 他说了 → 抽屉里出现 `wake_pending_text`，而且是**完整**那句话（>40 字也不截断）
 *   ② 时间字段是**本地时间**（不是 UTC，`toISOString` 那个坑）+ 一个机器可读的时间戳
 *   ③ 通知里那句话跟抽屉里那句**一模一样**（两处不能各写各的）
 *   ④ 他回 SKIP → **一个字都不写**（不然后台会替他"说"出没说过的话）
 *   ⑤ SKIP **不会动**上一句还没被收走的交接（前台可能还没来得及落库）
 *   ⑥ `wake_log` 的**老行为一个字都没变**（还是 40 字截断、还是最新的在最前面、还是最多 40 行）
 *   ⑦ 备路（Worker）说了话，也同样写交接
 *   ⑧ 那句里万一混进了 key → 两边都不会漏出去（`maskSecrets`）
 *
 * 跑法：`node verify-wake-pending.mjs`
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const FAKE_PORT = 4655;
const WORKER_PORT = 4656;
const RAW_SRC = readFileSync("public/runners/wake.js", "utf8");
/** 备路要用：把 CI 注入的那个占位符换成我们本地这个假 Worker（两处都换，跟 CI 一样用 split/join） */
const RUNNER_SRC = RAW_SRC.split("__QIDAO_WAKE_URL__").join(`http://127.0.0.1:${WORKER_PORT}/api/wake`);

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ───────── 假上游（"你的 AI"）+ 假 Worker（备路）───────── */

let reply = "";
let workerReply = {};

const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply } }] }));
  });
});
await new Promise((r) => fake.listen(FAKE_PORT, "127.0.0.1", r));

const worker = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(workerReply));
});
await new Promise((r) => worker.listen(WORKER_PORT, "127.0.0.1", r));

/* ───────── 把后台那段 JS 跑起来 ───────── */

let kv = new Map();
let notes = [];
let handler = null;
const realFetch = globalThis.fetch;

/** App 交过来的那份配置（就是抽屉里的东西） */
function drawer(over = {}) {
  return {
    cfg_base_url: `http://127.0.0.1:${FAKE_PORT}/v1`,
    cfg_api_key: "sk-FAKE-DIRECT-KEY",
    cfg_model: "fake-model",
    cfg_ai_name: "星芒",
    cfg_enabled: "1",
    cfg_quiet_start: "0",
    cfg_quiet_end: "0",
    cfg_prompt_normal: "你是星芒。现在是 {{TIME}}。距上次说话 {{ELAPSED}}。【平时档】想说就说，没话说回 SKIP。",
    cfg_prompt_force: "你是星芒。现在是 {{TIME}}。【必说档】你必须说一句，不许回 SKIP。",
    ...over,
  };
}

/** 模拟"系统叫醒它一次" */
async function wake(config, kvSeed = new Map(), randoms = null) {
  kv = kvSeed;
  notes = [];
  handler = null;

  globalThis.CapacitorKV = {
    get: (k) => ({ value: kv.get(k) ?? "" }),
    set: (k, v) => kv.set(k, String(v)),
  };
  globalThis.CapacitorNotifications = { schedule: (arr) => notes.push(...arr) };
  globalThis.addEventListener = (n, f) => {
    if (n === "qidaoWake") handler = f;
  };
  globalThis.fetch = (...args) => realFetch(...args);

  const realRandom = Math.random;
  if (randoms) {
    let i = 0;
    Math.random = () => randoms[Math.min(i++, randoms.length - 1)];
  }

  new Function(RUNNER_SRC)();
  if (!handler) throw new Error('后台 JS 没有注册 addEventListener("qidaoWake")');

  for (const [k, v] of Object.entries(config)) kv.set(k, v);

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("处理函数没有回调（后台那边会永远挂着）")), 15_000);
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
  return { notes, kv };
}

/** 本地时间 `YYYY-MM-DD HH:mm:ss`（本地 = 机器所在时区，不是 UTC） */
function looksLikeLocalStamp(v) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v ?? ""));
}

/* ═════════ ① 他"说了" → 完整那句话进抽屉 ═════════ */

/** 一句话，明显 >40 字（40 字是 `wake_log` 的截断线，正好用来证明"不是那个"） */
const LONG_SAID =
  "刚才你翻到那张去年冬天的照片停了好一会儿，我就没出声；这会儿想问问你，那天到底冷不冷，你后来又是怎么把自己哄好的。";

console.log("【一】他说了一句（>40 字）→ 抽屉里必须是**完整**那句，不是 40 字日志");
{
  reply = LONG_SAID;
  const r = await wake(drawer(), new Map(), [0.1]);

  const pending = r.kv.get("wake_pending_text");
  check("弹了通知（老行为没坏）", r.notes.length === 1, `弹了 ${r.notes.length} 条`);
  check(
    "写了 wake_pending_text",
    typeof pending === "string" && pending.length > 0,
    `pending=${JSON.stringify(pending ?? null)}`,
  );
  check(
    `这句话**没被截断**（长度 ${String(pending ?? "").length} > 40，且跟原句一字不差）`,
    pending === LONG_SAID,
    pending === LONG_SAID ? "" : `拿到的长度 ${String(pending ?? "").length}`,
  );
  check(
    "抽屉里那句跟通知正文**一模一样**（两处不能各写各的）",
    pending === r.notes[0]?.body,
    `通知=${JSON.stringify(r.notes[0]?.body ?? null)}`,
  );
  check("通知带上了「他说了一句」的身份标记（点通知要靠它直达）", r.notes[0]?.actionTypeId === "qidao-wake-said", String(r.notes[0]?.actionTypeId));
  check("wake_pending_at 是**本地时间**（不是 UTC 那种 ISO）", looksLikeLocalStamp(r.kv.get("wake_pending_at")), String(r.kv.get("wake_pending_at")));
  const ms = Number(r.kv.get("wake_pending_at_ms"));
  check("wake_pending_at_ms 是机器可读的时间戳（跟 now 差得不多）", Number.isFinite(ms) && Math.abs(Date.now() - ms) < 60_000, String(r.kv.get("wake_pending_at_ms")));
  check("wake_pending_urge 也记了程度（可为空，但不该是 undefined）", r.kv.get("wake_pending_urge") !== undefined, `urge=${JSON.stringify(r.kv.get("wake_pending_urge"))}`);
}

/* ═════════ ② wake_log 的老行为一个字都没变 ═════════ */

console.log("\n【二】wake_log 的现有行为**不能被改坏**（还是 40 字截断、最新在最前、最多 40 行）");
{
  const r = await wake(drawer(), new Map(), [0.1]);
  const lines = String(r.kv.get("wake_log") ?? "").split("\n");
  const first = lines[0] ?? "";
  check("日志里还是「说了」那一行（格式没变）", /^#1 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} 说了：/.test(first), first.slice(0, 60));
  check(
    "日志里那句话仍然是**截断到 40 字**（要完整那句得看 wake_pending_text）",
    first.endsWith(LONG_SAID.slice(0, 40)),
    `尾部=${JSON.stringify(first.slice(-46))}`,
  );

  /**
   * 攒 45 轮，看 40 行的上限还在不在。
   * ⚠️ 这 45 轮用 SKIP：说成一句会把「醒了几次」归零（用户要求），编号就永远是 #1，
   *    那样验不出"最新的在最前面"。SKIP 时编号会一直往上爬。
   */
  reply = "SKIP";
  let seed = new Map();
  for (let i = 0; i < 45; i += 1) {
    const rr = await wake(drawer(), seed, [0.1]);
    seed = rr.kv;
  }
  const kept = String(seed.get("wake_log") ?? "").split("\n").filter(Boolean);
  check("日志上限仍然是 40 行（没被新键挤爆）", kept.length === 40, `实际 ${kept.length} 行`);
  check("最新的那条在最前面（#45）", kept[0]?.startsWith("#45 "), kept[0]?.slice(0, 24));
  check("SKIP 那些轮一句交接都没写（45 轮里没有一句是他说的）", !seed.get("wake_pending_text"), String(seed.get("wake_pending_text") ?? ""));
}

/* ═════════ ③ SKIP：一个字都不写 ═════════ */

console.log("\n【三】他回 SKIP → **一个字都不写**（不能替他「说」没说过的话）");
{
  reply = "SKIP";
  const r = await wake(drawer(), new Map(), [0.1]);
  check("没弹通知", r.notes.length === 0, `弹了 ${r.notes.length} 条`);
  check(
    "抽屉里没有 wake_pending_text",
    !r.kv.get("wake_pending_text"),
    `pending=${JSON.stringify(r.kv.get("wake_pending_text") ?? null)}`,
  );

  console.log("\n【三·b】SKIP **不能动**上一句还没被前台收走的交接");
  reply = "SKIP";
  const seeded = new Map([
    ["wake_pending_text", "上一句他说的、前台还没落库"],
    ["wake_pending_at", "2026-01-02 03:04:05"],
    ["wake_pending_at_ms", "1767225845000"],
  ]);
  const r2 = await wake(drawer(), seeded, [0.1]);
  check("上一句原封不动（没被 SKIP 清掉、也没被覆盖）", r2.kv.get("wake_pending_text") === "上一句他说的、前台还没落库", String(r2.kv.get("wake_pending_text")));
  check("上一句的时间也没动", r2.kv.get("wake_pending_at") === "2026-01-02 03:04:05", String(r2.kv.get("wake_pending_at")));
}

/* ═════════ ④ 引号照旧清掉，交接里也是清过的那句 ═════════ */

console.log("\n【四】引号清理对交接同样生效（通知和抽屉里必须是同一句）");
{
  reply = "「在忙吗？刚才那句我记着了。」";
  const r = await wake(drawer(), new Map(), [0.1]);
  check("通知里没有中文引号", !/[「」『』“”"]/.test(r.notes[0]?.body ?? "x"), JSON.stringify(r.notes[0]?.body));
  check("抽屉里跟通知一字不差", r.kv.get("wake_pending_text") === r.notes[0]?.body, JSON.stringify(r.kv.get("wake_pending_text")));
}

/* ═════════ ⑤ 备路（Worker）说了话，也要写交接 ═════════ */

console.log("\n【五】备路（Worker 中转）说了话 → 一样要写交接");
{
  const WORKER_SAID = "备路也说了：你昨天说想早点睡，现在都快一点了，还醒着？";
  workerReply = { ok: true, action: "speak", text: WORKER_SAID, urge: 75, aiName: "星芒" };
  /** 抽屉里**没有**上游配置 → 走备路 */
  const r = await wake({ cfg_ai_name: "星芒", cfg_enabled: "1", cfg_quiet_start: "0", cfg_quiet_end: "0" }, new Map(), [0.1]);
  check("备路弹了通知", r.notes.length === 1, `弹了 ${r.notes.length} 条`);
  check("备路那句也**完整**进了抽屉", r.kv.get("wake_pending_text") === WORKER_SAID, JSON.stringify(r.kv.get("wake_pending_text")));
  check("备路的程度（urge）也记下了", r.kv.get("wake_pending_urge") === "75", String(r.kv.get("wake_pending_urge")));
  check("备路的通知也带身份标记", r.notes[0]?.actionTypeId === "qidao-wake-said", String(r.notes[0]?.actionTypeId));
}

/* ═════════ ⑥ key 混进那句话里也不能漏出去 ═════════ */

console.log("\n【六】上游万一把 key 回显进那句话 → 通知和抽屉两边都得遮住");
{
  reply = "我这里有个 sk-abcdef123456 你要不要看看";
  const r = await wake(drawer(), new Map(), [0.1]);
  const pending = String(r.kv.get("wake_pending_text") ?? "");
  check("抽屉里没有明文 key", !pending.includes("sk-abcdef123456"), pending);
  check("通知里也没有明文 key", !String(r.notes[0]?.body ?? "").includes("sk-abcdef123456"), String(r.notes[0]?.body));
}

console.log("-".repeat(64));
console.log(`甲（后台把完整那句交给前台）验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
await new Promise((r) => fake.close(r));
await new Promise((r) => worker.close(r));
process.exit(bad === 0 ? 0 : 1);
