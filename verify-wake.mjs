/**
 * 验收脚本：**`/api/wake`（他主动找你的服务端那一半）**。
 *
 * 用户拍板的是「乙」：AI 的调用发生在 Worker 上，手机上那段后台 JS 只负责
 * 请求这里 + 把他返回的那句话弹成通知。
 * 用户的规矩原话："可以改成随机0 25 50 75 100，打了100，百分百发消息，其他时候自己判断"。
 *
 * 这个脚本用**假上游**把整条路真走一遍（不碰用户的真 key），证明这些事：
 *   ① 缺配置 / 没同步过 → 如实说，不编话
 *   ② 正常 → 拿到他说的那句（与假上游原文一致）
 *   ③ 模型回 SKIP → `action:"wait"`（后台不弹通知）
 *   ④ **100% 那一档必须兑现**：模型回 SKIP 时要重试；试了两次还不说才认输
 *   ⑤ 引号（含中文「」）要清掉
 *   ⑥ **响应里绝不能出现上游 key**（正常与报错两条路）
 *   ⑦ **两道闸门不合格时，绝不调 AI**（这是省钱的关键）：
 *      · 夜间不打扰
 *      · 距上次交流不满"最短间隔"（含 App 报的 `lastChatAt`）
 *   ⑧ "想找你的程度"只能滚出那五档
 *   ⑨ 系统提示词里的时间按**用户时区**算（Worker 在 UTC）
 *
 * 跑法（dev server 要在 8080）：node verify-wake.mjs
 */
import { createServer } from "node:http";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const FAKE_PORT = 4633;
const FAKE_KEY = "sk-FAKE-KEY-DO-NOT-ECHO-1234567890";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ───────── 假上游 ───────── */

let mode = "hi";
/** 上游一共被调了几次 —— 用来验"不该问的时候一次都没问" */
let hits = 0;
let lastBody = null;
let lastAuth = "";

const REPLIES = {
  hi: "刚看你把咖啡换成了热的，胃是不是又不舒服了。",
  skip: "SKIP",
  quoted: "「在忙吗？刚才那句我记着了。」",
  empty: "",
};

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

    let content = REPLIES[mode] ?? "不知道说什么";
    // 第一次回 SKIP、之后正常 —— 验"100% 那档的强制重试"
    if (mode === "skipOnce") content = hits % 2 === 1 ? "SKIP" : REPLIES.hi;

    res.writeHead(mode === "fail" ? 500 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
});

await new Promise((r) => fake.listen(FAKE_PORT, "127.0.0.1", r));

/* ───────── 小工具 ───────── */

async function post(body) {
  const res = await fetch(`${BASE}/api/wake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function get(query = "") {
  const res = await fetch(`${BASE}/api/wake${query}`);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 就把原文带出去 */
  }
  return { status: res.status, text, json };
}

/** 当前北京时间的小时（夜间那条用例要用它，好让结论跟"现在几点"无关） */
function beijingHour() {
  const p = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return Number(p.find((x) => x.type === "hour")?.value ?? "12") % 24;
}

/** 不启用夜间（起止相同 = 关掉），这样"会不会说话"只受间隔影响 */
const NO_QUIET = { minGapMinutes: 60, quietStart: 0, quietEnd: 0 };

const ctx = (over = {}) => ({
  aiName: "星芒",
  displayName: "yan",
  persona: "说话简短，不客套，关心但不唠叨。",
  baseUrl: `http://127.0.0.1:${FAKE_PORT}/v1`,
  apiKey: FAKE_KEY,
  model: "fake-model",
  tz: "Asia/Shanghai",
  recent: [
    { role: "user", text: "我今天有点胃疼" },
    { role: "assistant", text: "那别喝冰的了。" },
  ],
  policy: NO_QUIET,
  ...over,
});

/* 先把上下文清掉：让「还没同步过」那条用例可重复（前一个脚本可能留下了东西） */
await fetch(`${BASE}/api/wake`, { method: "DELETE" });

/* ───────── ① 开错的情况 ───────── */

console.log("【一】开错的情况要如实说");
{
  const r = await post({ aiName: "星芒" });
  check("缺上游配置 → 400 且说清缺什么", r.status === 400 && /上游配置/.test(r.json?.why ?? ""), `HTTP ${r.status}`);
}
{
  const r = await post(ctx({ model: "" }));
  check("只缺 model 也拦得住", r.status === 400, `HTTP ${r.status}`);
}

/* ───────── ② 没同步过上下文 ───────── */

console.log("\n【二】没同步过上下文");
{
  const r = await get("?since=9999");
  check(
    "如实说「还没同步过」（不编一句话糊弄）",
    r.json?.ok === false && /还没同步/.test(r.json?.why ?? ""),
    r.json?.why ?? r.text.slice(0, 80),
  );
}

/* ───────── ③ 正常一路 ───────── */

console.log("\n【三】正常：存上下文 → 要一句话");
{
  mode = "hi";
  const saved = await post(ctx());
  check("存上下文成功（回执只说条数，不带配置）", saved.json?.ok === true, JSON.stringify(saved.json));

  const r = await get("?since=9999");
  check("拿到他说的话（与假上游原文一致）", r.json?.action === "speak" && r.json?.text === REPLIES.hi, r.json?.text ?? r.text.slice(0, 90));
  check("上游收到的是 Bearer + 我们的 key（确实带着配置去问了）", lastAuth === `Bearer ${FAKE_KEY}`);
  check("响应里带上了这一轮「想找你的程度」（能看出他为什么说/不说）", typeof r.json?.urge === "number", `urge=${r.json?.urge}`);
}

/* ───────── ④ 他自己决定不说 ───────── */

console.log("\n【四】他自己决定「现在不说」");
{
  mode = "skip";
  await post(ctx());
  const r = await get("?since=9999&urge=0");
  check("模型回 SKIP → action:wait（后台不弹通知）", r.json?.ok === true && r.json?.action === "wait", JSON.stringify(r.json));
}

/* ───────── ⑤ 100% 那一档必须兑现 ───────── */

console.log("\n【五】「打了 100，百分百发消息」");
{
  mode = "skip";
  await post(ctx());
  const before = hits;
  const r = await get("?since=9999&urge=100");
  check("urge=100 时模型回 SKIP → 会**带着「不许 SKIP」再问一次**", hits - before === 2, `调了 ${hits - before} 次`);
  check("两次都不说 → 认输（action:wait，且说明试了两次）", r.json?.action === "wait" && /两次/.test(r.json?.why ?? ""), r.json?.why ?? "");

  mode = "skipOnce";
  await post(ctx());
  hits = 0;
  const r2 = await get("?since=9999&urge=100");
  check("第一次 SKIP、第二次说了 → 照样发（action:speak）", r2.json?.action === "speak" && r2.json?.text === REPLIES.hi, r2.json?.text ?? JSON.stringify(r2.json));

  mode = "hi";
  await post(ctx());
  const r3 = await get("?since=9999&urge=100");
  check("urge=100 且模型正常 → speak", r3.json?.action === "speak", r3.json?.text ?? "");
}

/* ───────── ⑥ 引号要清干净 ───────── */

console.log("\n【六】通知里不该出现引号或「他：」前缀");
{
  mode = "quoted";
  await post(ctx());
  const r = await get("?since=9999");
  check("中文引号「」被清掉", r.json?.action === "speak" && !/[「」『』“”"]/.test(r.json?.text ?? "x"), `text=${JSON.stringify(r.json?.text)}`);
}

/* ───────── ⑦ 密钥只进不出 ───────── */

console.log("\n【七】上游密钥只进不出");
{
  mode = "hi";
  const saved = await post(ctx());
  const got = await get("?since=9999");
  const all = `${JSON.stringify(saved)}${JSON.stringify(got)}`;
  check("响应里没有 key", !all.includes(FAKE_KEY));
  check("连 key 的前缀都没有", !all.includes("sk-FAKE"));

  mode = "fail";
  await post(ctx());
  const failRes = await get("?since=9999");
  check("上游报错时也不带 key", !JSON.stringify(failRes).includes(FAKE_KEY));
  check("上游报错时说清状态码", /500/.test(failRes.json?.why ?? ""), failRes.json?.why ?? "");
}

/* ───────── ⑧ 两道便宜闸门（省钱的点）───────── */

console.log("\n【八】不该问的时候，一次都不许问 AI");
{
  mode = "hi";

  // 8a 夜间不打扰：把"夜间"设成现在这一小时，结论就跟"现在几点"无关
  const h = beijingHour();
  await post(ctx({ policy: { minGapMinutes: 60, quietStart: h, quietEnd: (h + 1) % 24 } }));
  let before = hits;
  let r = await get("?since=9999");
  check("夜里 → wait，且一次都没调 AI", r.json?.action === "wait" && hits === before, `调了 ${hits - before} 次 · ${r.json?.why ?? ""}`);

  // 8b 最短间隔
  await post(ctx({ policy: NO_QUIET }));
  before = hits;
  r = await get("?since=10");
  check("距上次才 10 分钟（最短 60）→ wait，且一次都没调 AI", r.json?.action === "wait" && hits === before, `调了 ${hits - before} 次 · ${r.json?.why ?? ""}`);

  // 8c 隔够了就该问
  before = hits;
  r = await get("?since=9999");
  check("隔够了 → speak（说明闸门不是把功能锁死）", r.json?.action === "speak" && hits > before, r.json?.text ?? "");

  // 8d 规则下限：安卓唤醒下限是 15 分钟，传 5 分钟要被夹住
  await post(ctx({ policy: { minGapMinutes: 5, quietStart: 0, quietEnd: 0 } }));
  r = await get("?since=6");
  check("minGap 传 5 被夹到 15（就算放宽也不会比 15 更密）", r.json?.action === "wait" && /最短 15/.test(r.json?.why ?? ""), r.json?.why ?? "");

  // 8e App 报的「上一次聊天时间」也要算：刚聊完不许立刻来敲门
  await post(ctx({ policy: NO_QUIET, lastChatAt: Date.now() - 5 * 60000 }));
  before = hits;
  r = await get("?since=9999");
  check("刚聊完 5 分钟（哪怕后台说隔了很久）→ wait，且没调 AI", r.json?.action === "wait" && hits === before, `调了 ${hits - before} 次 · ${r.json?.why ?? ""}`);
}

/* ───────── ⑨ 「想找你的程度」只能是那五档 ───────── */

console.log("\n【九】「想找你的程度」的档位");
{
  mode = "hi";
  await post(ctx({ policy: NO_QUIET }));
  const seen = new Set();
  for (let i = 0; i < 60; i += 1) {
    const r = await get("?since=9999");
    if (typeof r.json?.urge === "number") seen.add(r.json.urge);
  }
  const allowed = [0, 25, 50, 75, 100];
  check(
    "只滚出 0/25/50/75/100 这五档",
    [...seen].every((v) => allowed.includes(v)) && seen.size > 1,
    `出现过 ${[...seen].sort((a, b) => a - b).join("/")}`,
  );

  const r = await get("?since=9999&urge=999");
  check("传非法档位（999）不许改语义，退回随机档", allowed.includes(r.json?.urge), `urge=${r.json?.urge}`);
}

/* ───────── ⑩ 时间与人设 ───────── */

console.log("\n【十】时间必须按用户时区算（Worker 在 UTC）");
{
  mode = "hi";
  await post(ctx({ policy: NO_QUIET }));
  await get("?since=9999");
  const system = lastBody?.messages?.[0]?.content ?? "";

  const stampOf = (tz) => {
    const p = new Intl.DateTimeFormat("zh-CN", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const g = (t) => p.find((x) => x.type === t)?.value ?? "";
    return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
  };

  check("提示词里带上了北京时间（分钟级）", system.includes(stampOf("Asia/Shanghai").slice(0, 16)), system.slice(0, 46).replace(/\n/g, " "));
  check("带上了「你是谁」的人设段", /你是谁/.test(system) && /说话简短/.test(system));
  check("带上了最近的对话", /我今天有点胃疼/.test(lastBody?.messages?.[1]?.content ?? ""));
  check("要求「最多两句」", /最多两句/.test(system));
  check("给了「可以不说」的出口（SKIP）", /SKIP/.test(system));
  check("把这一轮的「想找你的程度」告诉了模型", /想找他的程度/.test(system), system.match(/想找他的程度[^\n]*/)?.[0] ?? "");
}

fake.close();
console.log("-".repeat(64));
console.log(`/api/wake 验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
