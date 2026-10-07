/**
 * 验收脚本：**甲那条路 —— 后台那段 JS 直接问你的 AI**（本地，不用真机）。
 *
 * 这是用户选的方案：`qidao.…workers.dev` 在国内被 DNS 污染，而他的 AI 是国内那条快的 ——
 * 所以让后台**直接问 AI**，Worker 和梯都不需要。配置由 App 通过"抽屉"
 * （`WakeBridgePlugin`）交过来。
 *
 * 做法跟 `verify-wake-runner.mjs` 一样：把后台那段 JS（`public/runners/wake.js`）
 * **原样执行**，只替掉它依赖的四个全局（`addEventListener` / `CapacitorKV` /
 * `CapacitorNotifications` / `fetch` 用真的打本地假上游）。
 *
 * 证明这些：
 *   ① 抽屉里有配置 → **真的去问你的上游**（一条直路，不碰 Worker）
 *   ② `{{TIME}}` / `{{ELAPSED}}` 被换成**此刻**的值（不是同步那一刻的）
 *   ③ 程度按"距他上次开口多久"选对那一段指令（0/25/50/75/100 五段）
 *   ④ 他说了 → 通知里就是那句话、标题是他的名字、记下"上次开口"时间
 *   ⑤ 他说 SKIP → 不弹通知，而且**那次开口时间不动**（程度继续往上爬）
 *   ⑥ **100% 那档是保底**：模型说 SKIP 也要带"不许 SKIP"重问一次
 *   ⑦ 总开关关掉 / 夜间 → **一次请求都不发**
 *   ⑧ 引号（含中文「」）清干净
 *   ⑨ 无论如何都收尾（后台那边没有超时，漏了 resolve 就永远挂着）
 *
 * 跑法：`node verify-wake-direct.mjs`
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const FAKE_PORT = 4635;
const RUNNER_SRC = readFileSync("public/runners/wake.js", "utf8");

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ───────── 假上游（就是"你的 AI"）───────── */

let reply = "刚看你把咖啡换成了热的，胃是不是又不舒服了。";
let hits = 0;
let lastBody = null;
let lastAuth = "";

const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    hits += 1;
    lastAuth = String(req.headers.authorization ?? "");
    try {
      lastBody = JSON.parse(raw);
    } catch {
      lastBody = null;
    }
    // 支持"第一次 SKIP、之后正常"，用来验保底重试
    const content = reply === "SKIP_ONCE" ? (hits % 2 === 1 ? "SKIP" : "行，那我说一句：在忙啥？") : reply;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: content } }] }));
  });
});
await new Promise((r) => fake.listen(FAKE_PORT, "127.0.0.1", r));

/* ───────── 把后台那段 JS 跑起来 ───────── */

let kv = new Map();
let notes = [];
let handler = null;
let asked = [];
const realFetch = globalThis.fetch;

/** App 交过来的那份配置（就是抽屉里的东西） */
function drawer(over = {}) {
  const base = {
    cfg_base_url: `http://127.0.0.1:${FAKE_PORT}/v1`,
    cfg_api_key: "sk-FAKE-DIRECT-KEY",
    cfg_model: "fake-model",
    cfg_ai_name: "星芒",
    cfg_enabled: "1",
    cfg_quiet_start: "0",
    cfg_quiet_end: "0",
  };
  for (let i = 0; i < 5; i += 1) {
    const level = i * 25;
    base[`cfg_prompt_${i}`] =
      `你是星芒。现在是 {{TIME}}。距上次说话 {{ELAPSED}}。【程度 ${level}%】` +
      (level === 100 ? " 一定要说，不许回 SKIP。" : " 自己判断，可以回 SKIP。");
  }
  return { ...base, ...over };
}

/** 模拟"系统叫醒它一次" */
async function wake(config, kvSeed = new Map()) {
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

  // 执行：占位符留着（反正 direct 优先，用不到 Worker）
  // eslint-disable-next-line no-new-func
  new Function(RUNNER_SRC)();
  if (!handler) throw new Error("后台 JS 没有注册 addEventListener(\"qidaoWake\")");

  // 把配置当成"抽屉里的东西"：它读的就是 CapacitorKV
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
  return { notes, kv, asked };
}

/* ═════════ ① 直接问上游 ═════════ */

console.log("【一】抽屉里有配置 → 直接问你的 AI（不碰 Worker）");
{
  reply = "刚看你把咖啡换成了热的，胃是不是又不舒服了。";
  hits = 0;
  const r = await wake(drawer());

  check("真的去请求了（而且只有一处：你的上游）", r.asked.length === 1, r.asked.join(" , "));
  check("请求的是**你的上游**（不是 Worker 域名）", (r.asked[0] ?? "").includes(`127.0.0.1:${FAKE_PORT}`), r.asked[0] ?? "");
  check("用的是 Bearer + 你的 key", lastAuth === "Bearer sk-FAKE-DIRECT-KEY", lastAuth);
  check("弹了一条通知", r.notes.length === 1, `弹了 ${r.notes.length} 条`);
  check("标题是他的名字", r.notes[0]?.title === "星芒", `title=${r.notes[0]?.title}`);
  check("正文就是他生成的那句话", r.notes[0]?.body === reply, `body=${r.notes[0]?.body}`);
  check("记下了「他上次开口的时间」（程度从这里重新计时）", Number(r.kv.get("last_spoke_at")) > 0);
}

/* ═════════ ② 占位符换成此刻 ═════════ */

console.log("\n【二】指令里的时间占位符要换成「此刻」的值");
{
  const r = await wake(drawer());
  const system = lastBody?.messages?.[0]?.content ?? "";
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  check("{{TIME}} 被换成了本地时间", system.includes(today) && !system.includes("{{TIME}}"), system.slice(0, 60));
  check("{{ELAPSED}} 被换掉了", !system.includes("{{ELAPSED}}"), system.slice(0, 80));
  check("没聊过时说的是人话（很久/还没聊过）", /很久|还没聊过/.test(system), system.slice(0, 90));
}

/* ═════════ ③ 程度选对指令 ═════════ */

console.log("\n【三】程度 → 选对那一段指令（每 25 分钟一档）");
{
  const cases = [
    [null, 0],
    [10, 0],
    [30, 25],
    [60, 50],
    [80, 75],
    [130, 100],
  ];
  let allOk = true;
  const detail = [];
  for (const [mins, want] of cases) {
    const seed = new Map();
    if (mins !== null) seed.set("last_spoke_at", String(Date.now() - mins * 60000));
    await wake(drawer(), seed);
    const system = lastBody?.messages?.[0]?.content ?? "";
    if (!system.includes(`【程度 ${want}%】`)) {
      allOk = false;
      detail.push(`${mins}分→期望${want}%`);
    }
  }
  check("没聊过/10/30/60/80/130 分 → 0/0/25/50/75/100 档", allOk, allOk ? "6 个点全对" : detail.join(" "));
  check("ELAPSED 说的是人话（分钟/小时）", /分钟|小时/.test(lastBody?.messages?.[0]?.content ?? ""));
}

/* ═════════ ④ 他说 SKIP ═════════ */

console.log("\n【四】他说 SKIP：不弹通知，时间不动（程度继续往上爬）");
{
  reply = "SKIP";
  const seed = new Map([["last_spoke_at", String(Date.now() - 30 * 60000)]]);
  const r = await wake(drawer(), seed);
  check("没弹通知", r.notes.length === 0, `弹了 ${r.notes.length} 条`);
  check("「上次开口的时间」一点没动", Number(r.kv.get("last_spoke_at")) === Number(seed.get("last_spoke_at")));
}

/* ═════════ ⑤ 100% 保底 ═════════ */

console.log("\n【五】100% 那档是保底：SKIP 也要带「不许 SKIP」重问一次");
{
  reply = "SKIP_ONCE";
  hits = 0;
  const seed = new Map([["last_spoke_at", String(Date.now() - 130 * 60000)]]);
  const r = await wake(drawer(), seed);
  check("一共问了两次（先 SKIP、再重问）", hits === 2, `问了 ${hits} 次`);
  check("第二次带着「不许 SKIP」", /不许回 SKIP/.test(lastBody?.messages?.[0]?.content ?? ""));
  check("第二次说了 → 照样弹通知", r.notes.length === 1 && /在忙啥/.test(r.notes[0]?.body ?? ""), `notes=${JSON.stringify(r.notes.map((n) => n.body))}`);

  // 低档位不该重试
  reply = "SKIP";
  hits = 0;
  await wake(drawer(), new Map([["last_spoke_at", String(Date.now() - 30 * 60000)]]));
  check("低档位（25%）不会做这个重试", hits === 1, `问了 ${hits} 次`);
}

/* ═════════ ⑥ 关掉 / 夜间：一次请求都不发 ═════════ */

console.log("\n【六】关掉 / 夜间 → 一次请求都不发");
{
  reply = "不该被问到的句子";
  hits = 0;
  let r = await wake(drawer({ cfg_enabled: "0" }));
  check("总开关关掉：没请求、没通知", hits === 0 && r.notes.length === 0, `请求 ${hits} 次 · 通知 ${r.notes.length} 条`);
  check("记下了「静音」时间（接下来 4 小时都不发请求）", Number(r.kv.get("muted_at")) > 0);

  // 静音期内再醒一次
  const seed = new Map([["muted_at", String(Date.now() - 5 * 60000)]]);
  hits = 0;
  r = await wake(drawer({ cfg_enabled: "0" }), seed);
  check("静音期内：连请求都不发", hits === 0, `请求 ${hits} 次`);

  const h = new Date().getHours();
  hits = 0;
  r = await wake(drawer({ cfg_quiet_start: String(h), cfg_quiet_end: String((h + 1) % 24) }));
  check("夜间不打扰：没请求、没通知", hits === 0 && r.notes.length === 0, `请求 ${hits} 次 · 通知 ${r.notes.length} 条`);
}

/* ═════════ ⑦ 引号要清干净 ═════════ */

console.log("\n【七】通知里不该出现引号或「他：」前缀");
{
  reply = "「在忙吗？刚才那句我记着了。」";
  const r = await wake(drawer());
  check("中文引号被清掉", !/[「」『』“”"]/.test(r.notes[0]?.body ?? "x"), `body=${JSON.stringify(r.notes[0]?.body)}`);

  reply = "星芒：我在呢。";
  const r2 = await wake(drawer());
  check("「名字：」前缀被清掉", r2.notes[0]?.body === "我在呢。", `body=${JSON.stringify(r2.notes[0]?.body)}`);
}

/* ═════════ ⑧ 上游挂掉也要收尾 ═════════ */

console.log("\n【八】上游挂掉：也要弹得出来、也要收尾");
{
  reply = "随便";
  await new Promise((r) => fake.close(r)); // 端口没人听了
  const r = await wake(drawer());
  check("处理函数仍按约定收尾了", true);
  check("弹了一条「没成功」的调试通知", r.notes.length >= 1 && /没成功/.test(r.notes[0]?.title ?? ""), `title=${r.notes[0]?.title}`);
  check("记了错误冷却时间", Number(r.kv.get("last_err_at")) > 0);
}

console.log("-".repeat(64));
console.log(`甲（直接问你的 AI）验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
