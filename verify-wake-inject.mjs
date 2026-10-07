/**
 * 验收脚本：**CI 注入地址之后，后台那段 JS 还对不对**（纯 node，不联网、不用真机）。
 *
 * 为什么单独一测：这条链上有一类错**不报错、只是安静地不工作**，
 * 而且要等真机 15 分钟才能发现。已经栽过两次：
 *   ① 占位符在文件里出现两次 → CI 用 `replace` 只换第一处（注释），变量还是占位符
 *   ② 改成"整串全替换"之后，**运行时那句判断**也被换成了真地址 →
 *      它变成"判断自己是不是包含自己"，恒为假 → 永远以为没配、永远不请求 Worker
 *
 * 所以这里**照着 CI 的做法真替换一遍**，然后把替换后的文件**真执行一次**，
 * 看它到底有没有去请求那个地址、请求的对不对、通知里是不是他说的那句话。
 *
 * 跑法：`node verify-wake-inject.mjs`
 */
import { readFileSync } from "node:fs";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

const SRC = readFileSync("public/runners/wake.js", "utf8");

/** **跟 CI 完全一致的注入方式**（`split…join` = 整串全替换） */
const MARK = "__QIDAO_" + "WAKE_URL__";
const FAKE_URL = "https://example.workers.dev/api/wake?pass=TESTPASS";

/** 真实跑一次替换后的文件；返回它干了什么 */
async function runInjected({ url = FAKE_URL, serverReply = null, failFetch = false } = {}) {
  const out = SRC.split(MARK).join(url);

  const kv = new Map();
  const notes = [];
  let handler = null;
  let asked = null;

  globalThis.CapacitorKV = {
    get: (k) => ({ value: kv.get(k) ?? "" }),
    set: (k, v) => kv.set(k, String(v)),
  };
  globalThis.CapacitorNotifications = { schedule: (arr) => notes.push(...arr) };
  globalThis.addEventListener = (n, f) => {
    if (n === "qidaoWake") handler = f;
  };
  globalThis.fetch = async (u) => {
    asked = String(u);
    if (failFetch) throw new Error("模拟网络不通");
    const body = JSON.stringify(
      serverReply ?? { ok: true, action: "speak", text: "刚看你把咖啡换成了热的。", urge: 100, aiName: "星芒" },
    );
    return { text: async () => body };
  };

  // 用 Function 包一层执行，避免文件里的 var 污染这里
  // eslint-disable-next-line no-new-func
  new Function(out)();

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("处理函数没有回调（后台那边会永远挂着）")), 10_000);
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

  return { asked, notes, kv };
}

/* ───────── ① 注入之后真的会去请求 ───────── */

console.log("【一】注入地址之后：真的去请求，而且地址对");
{
  const r = await runInjected();
  check("请求了（说明「地址配好了吗」那句判断是对的）", r.asked !== null, r.asked ?? "（没有请求）");
  check("请求的是注入进去的那个地址", (r.asked ?? "").startsWith(FAKE_URL), r.asked ?? "");
  check("带上了 since（Worker 靠它算最短间隔）", (r.asked ?? "").includes("since="), r.asked ?? "");
  check("地址里本来带 `?` 时用 `&` 接，不会接出两个问号", !/https:\/\/[^?]*\?[^?]*\?/.test(r.asked ?? ""), r.asked ?? "");
}

/* ───────── ② 通知里就是他说的那句话 ───────── */

console.log("\n【二】通知里是他说的那句话，标题是他的名字");
{
  const r = await runInjected();
  check("弹了一条通知", r.notes.length === 1, `弹了 ${r.notes.length} 条`);
  check("标题 = 他的 AI 名字（像微信那样显示发件人）", r.notes[0]?.title === "星芒", `title=${r.notes[0]?.title}`);
  check("正文 = 他生成的那句话", r.notes[0]?.body === "刚看你把咖啡换成了热的。", `body=${r.notes[0]?.body}`);
  check("记下了「他上次开口的时间」（程度从这里重新计时）", Number(r.kv.get("last_spoke_at")) > 0);
}

/* ───────── ③ 他说不说由 Worker 定 ───────── */

console.log("\n【三】一键关闭 / 他说别说 时，一条通知都不弹");
{
  const r = await runInjected({
    serverReply: { ok: true, action: "wait", why: "你把它关掉了", muted: true },
  });
  check("没弹通知", r.notes.length === 0, `弹了 ${r.notes.length} 条`);
  /** 新规则的核心：他没说 → 时间继续攒 → 下一轮程度更高（25 → 50 → …→ 100 必发） */
  check("没说 → 「他上次开口的时间」不动（程度继续往上爬）", Number(r.kv.get("last_spoke_at") ?? 0) === 0);
  check("认「总开关关掉」的静音标记并记下来（接下来几小时连请求都不发）", Number(r.kv.get("muted_at") ?? 0) > 0);
}

/* ───────── ④ 地址没注入（占位符还在）───────── */

console.log("\n【四】没注入地址：退回调试通知，不请求任何东西");
{
  const r = await runInjected({ url: MARK });
  check("没有发任何请求", r.asked === null, r.asked ?? "（没请求 ✅）");
  check("弹了一条「第 N 次醒来」的调试通知", r.notes.length === 1 && /第 1 次醒来/.test(r.notes[0]?.body ?? ""), `body=${r.notes[0]?.body}`);
}

/* ───────── ⑤ 出故障时也要收尾 ───────── */

console.log("\n【五】请求失败：也要弹得出来、也要收尾（后台那边没有超时）");
{
  const r = await runInjected({ failFetch: true });
  check("处理函数仍按约定收尾了", true);
  check("弹了一条「没成功」的调试通知（他和坏掉要分得开）", /没成功/.test(r.notes[0]?.title ?? ""), `title=${r.notes[0]?.title}`);
  check("记了错误冷却时间", Number(r.kv.get("last_err_at")) > 0);
}

console.log("-".repeat(64));
console.log(`注入之后的验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
