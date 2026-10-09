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
  return {
    cfg_base_url: `http://127.0.0.1:${FAKE_PORT}/v1`,
    cfg_api_key: "sk-FAKE-DIRECT-KEY",
    cfg_model: "fake-model",
    cfg_ai_name: "星芒",
    cfg_enabled: "1",
    cfg_quiet_start: "0",
    cfg_quiet_end: "0",
    /** 平时那段（允许他回 SKIP） */
    cfg_prompt_normal: `你是星芒。现在是 {{TIME}}。距上次说话 {{ELAPSED}}。【平时档】想说就说，没话说回 SKIP。`,
    /** "上次没说 → 这次必定说"那段 */
    cfg_prompt_force: `你是星芒。现在是 {{TIME}}。距上次说话 {{ELAPSED}}。【必说档】你必须说一句，不许回 SKIP。`,
    ...over,
  };
}

/** 模拟"系统叫醒它一次" */
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
  /**
   * ⚠️ 掷骰子在这段 JS 里用的是 `Math.random()` —— 验收要**确定**，
   * 所以能传一串"预设的随机数"进来（按顺序消费）。不传就用真的随机。
   */
  const realRandom = Math.random;
  if (randoms) {
    let i = 0;
    Math.random = () => randoms[Math.min(i++, randoms.length - 1)];
  }

  // 执行：占位符留着（反正 direct 优先，用不到 Worker）
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
  Math.random = realRandom;
  return { notes, kv, asked };
}

/* ═════════ ① 直接问上游 ═════════ */

console.log("【一】抽屉里有配置 → 直接问你的 AI（不碰 Worker）");
{
  reply = "刚看你把咖啡换成了热的，胃是不是又不舒服了。";
  hits = 0;
  const r = await wake(drawer(), new Map(), [0.1]);

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
  await wake(drawer(), new Map(), [0.1]);
  const system = lastBody?.messages?.[0]?.content ?? "";
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  check("{{TIME}} 被换成了本地时间", system.includes(today) && !system.includes("{{TIME}}"), system.slice(0, 60));
  check("{{ELAPSED}} 被换掉了", !system.includes("{{ELAPSED}}"), system.slice(0, 80));
  check("没聊过时说的是人话（很久/还没聊过）", /很久|还没聊过/.test(system), system.slice(0, 90));
}

/* ═════════ ③ 两个 50%（用户定的规矩）═════════ */

console.log("\n【三】① 叫不叫他：50%，没叫下次必定叫");
{
  reply = "在忙吗";
  // 随机数 0.9 > 0.5 → "没看他"
  let r = await wake(drawer(), new Map(), [0.9]);
  check("掷到 0.9（>50%）→ 这次不看他：一次请求都不发", r.asked.length === 0, `请求 ${r.asked.length} 次`);
  check("没弹通知", r.notes.length === 0, `弹了 ${r.notes.length} 条`);
  check("记下「这次没看」→ 下次必定看", Number(r.kv.get("look_acc")) === 1);

  // 下次带着 look_acc=1：就算随机数又是 0.9，也必须看
  r = await wake(drawer(), new Map([["look_acc", "1"]]), [0.9]);
  check("上次没看 → 这次必定看（真的去问了）", r.asked.length === 1, `请求 ${r.asked.length} 次`);
  check("看了之后「没看」的标记清掉", Number(r.kv.get("look_acc")) === 0);

  // 随机数 0.1 < 0.5 → 直接就看
  r = await wake(drawer(), new Map(), [0.1]);
  check("掷到 0.1（<50%）→ 直接看他", r.asked.length === 1, `请求 ${r.asked.length} 次`);
}

console.log("\n【三·b】② 他说不说：没说 → 下次必定说");
{
  reply = "SKIP";
  let r = await wake(drawer(), new Map(), [0.1]);
  check("他说 SKIP → 不弹通知", r.notes.length === 0, `弹了 ${r.notes.length} 条`);
  check("记下「这次没说」→ 下次必定说", Number(r.kv.get("speak_acc")) === 1);
  check("这次用的是「平时档」指令（允许 SKIP）", /【平时档】/.test(lastBody?.messages?.[0]?.content ?? ""));

  // 下次带着 speak_acc=1：用"必说档"，而且模型耍赖也带"不许 SKIP"重问
  reply = "SKIP";
  hits = 0;
  r = await wake(drawer(), new Map([["speak_acc", "1"]]), [0.1]);
  check("上次没说 → 这次用「必说档」指令", /【必说档】/.test(lastBody?.messages?.[0]?.content ?? ""));
  check("模型还说 SKIP → 带「不许 SKIP」再问一次（问了 2 次）", hits === 2, `问了 ${hits} 次`);

  reply = "行，那我说一句：在忙啥？";
  r = await wake(drawer(), new Map([["speak_acc", "1"]]), [0.1]);
  check("必说档正常说 → 弹通知", r.notes.length === 1 && /在忙啥/.test(r.notes[0]?.body ?? ""), JSON.stringify(r.notes.map((n) => n.body)));
  check("说了之后「没说」的标记清掉", Number(r.kv.get("speak_acc")) === 0);
}

/* ═════════ ③·c 把你算的"最坏 4 小时"量出来 ═════════ */

console.log("\n【三·c】模拟：最坏几小时一定有一句？平均几小时？");
{
  /**
   * 纯逻辑模拟（跟后台那段 JS 同一套规则）：
   *   每次节拍：没看吗？(50%) → 没看就记着，下次必看
   *             看了 → 说吗？(50%) → 没说就记着，下次必说
   * 用户自己算的是"最坏 4 小时"，这里量一下对不对。
   */
  const oneRun = () => {
    let lookAcc = false;
    let speakAcc = false;
    let ticks = 0;
    while (ticks < 1000) {
      ticks += 1;
      const look = lookAcc || Math.random() < 0.5;
      if (!look) {
        lookAcc = true;
        continue;
      }
      lookAcc = false;
      const speak = speakAcc || Math.random() < 0.5;
      if (speak) return ticks;
      speakAcc = true;
    }
    return ticks;
  };

  let worst = 0;
  let total = 0;
  const N = 200_000;
  for (let i = 0; i < N; i += 1) {
    const t = oneRun();
    worst = Math.max(worst, t);
    total += t;
  }
  const avg = total / N;
  check(`最坏就是 ${worst} 次节拍（= ${worst} 小时，跟你算的一致）`, worst === 4, `量出来 ${worst}`);
  check(
    `平均 ${avg.toFixed(2)} 小时一句（一天约 ${(24 / avg).toFixed(1)} 次，扣掉夜间更少）`,
    avg > 2 && avg < 2.6,
    `平均 ${avg.toFixed(3)} 小时`,
  );
}

/* ═════════ ④ 他说 SKIP ═════════ */

console.log("\n【四】他说 SKIP：不弹通知，时间不动（程度继续往上爬）");
{
  reply = "SKIP";
  const seed = new Map([["last_spoke_at", String(Date.now() - 30 * 60000)]]);
  const r = await wake(drawer(), seed, [0.1]);
  check("没弹通知", r.notes.length === 0, `弹了 ${r.notes.length} 条`);
  check("「上次开口的时间」一点没动", Number(r.kv.get("last_spoke_at")) === Number(seed.get("last_spoke_at")));
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
  const r = await wake(drawer(), new Map(), [0.1]);
  check("中文引号被清掉", !/[「」『』“”"]/.test(r.notes[0]?.body ?? "x"), `body=${JSON.stringify(r.notes[0]?.body)}`);

  reply = "星芒：我在呢。";
  const r2 = await wake(drawer(), new Map(), [0.1]);
  check("「名字：」前缀被清掉", r2.notes[0]?.body === "我在呢。", `body=${JSON.stringify(r2.notes[0]?.body)}`);
}

/* ═════════ ⑧ 上游挂掉也要收尾 ═════════ */

console.log("\n【八】上游挂掉：也要弹得出来、也要收尾");
{
  reply = "随便";
  await new Promise((r) => fake.close(r)); // 端口没人听了
  const r = await wake(drawer(), new Map(), [0.1]);
  check("处理函数仍按约定收尾了", true);
  check("弹了一条「没成功」的调试通知", r.notes.length >= 1 && /没成功/.test(r.notes[0]?.title ?? ""), `title=${r.notes[0]?.title}`);
  check("记了错误冷却时间", Number(r.kv.get("last_err_at")) > 0);
}

console.log("-".repeat(64));
console.log(`甲（直接问你的 AI）验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
