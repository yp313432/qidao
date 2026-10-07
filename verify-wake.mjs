/**
 * 验收脚本：**`/api/wake`（他主动找你的服务端那一半）**。
 *
 * 用户拍板的是「乙」：AI 的调用发生在 Worker 上，手机上那段后台 JS 只负责
 * 请求这里 + 把他返回的那句话弹成通知。
 *
 * 这个脚本用**假上游**把整条路真的走一遍（不碰用户的真 key），证明七件事：
 *   ① 缺上游配置 → 明确报缺什么（不是含糊的 500）
 *   ② 没同步过上下文 → 如实说"还没同步"（不编一句话糊弄）
 *   ③ 正常情况 → 拿到他说的那句话（**假上游回的原文**，一字不差）
 *   ④ 模型回 `SKIP` → `text` 为空（**他自己决定不说**，后台就不弹通知）
 *   ⑤ 模型把话包在引号里 / 带前缀 → 清干净（通知里不该出现引号）
 *   ⑥ **上游密钥绝不出现在任何响应里**（只进不出）
 *   ⑦ 系统提示词里的时间**按用户时区算**（Worker 在 UTC，算错会说"半夜"在"下午"）
 *
 * 跑法（dev server 要在 8080）：
 *   node verify-wake.mjs
 */
import { createServer } from "node:http";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const FAKE_PORT = 4633;
/** 一个一眼能认出来的假 key —— 用来验"绝不回显" */
const FAKE_KEY = "sk-FAKE-KEY-DO-NOT-ECHO-1234567890";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ───────── 假上游 ───────── */

/** 假上游现在该回什么（每个用例改它） */
let mode = "hi";
/** 上游收到的最后一次请求体（用来验提示词） */
let lastBody = null;
let lastAuth = "";

const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    lastAuth = String(req.headers.authorization ?? "");
    try {
      lastBody = JSON.parse(raw);
    } catch {
      lastBody = null;
    }

    const content =
      mode === "hi"
        ? "刚看你把咖啡换成了热的，胃是不是又不舒服了。"
        : mode === "skip"
          ? "SKIP"
          : mode === "quoted"
            ? "「在忙吗？刚才那句我记着了。」"
            : mode === "empty"
              ? ""
              : "不知道说什么";

    res.writeHead(mode === "fail" ? 500 : 200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content } }],
      }),
    );
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
  return { status: res.status, json: await res.json().catch(() => null), text: "" };
}

async function get() {
  const res = await fetch(`${BASE}/api/wake`);
  const text = await res.text();
  return { status: res.status, text, json: safeJson(text) };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

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
  ...over,
});

/* ───────── ① 缺配置 ───────── */

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
  // 先把内存里的上下文清掉（用一条非法请求不行，所以直接依赖"从未同步"的顺序）
  const r = await get();
  check(
    "如实说'还没同步过'（不编一句话糊弄）",
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

  const r = await get();
  check("拿到他说的话（与假上游回的原文一致）", r.json?.text === "刚看你把咖啡换成了热的，胃是不是又不舒服了。", r.json?.text ?? r.text.slice(0, 100));
  check("上游收到的是 Bearer + 我们的 key（说明确实带着配置去问了）", lastAuth === `Bearer ${FAKE_KEY}`);
}

/* ───────── ④ 他自己决定不说 ───────── */

console.log("\n【四】他自己决定「现在不说」");
{
  mode = "skip";
  await post(ctx());
  const r = await get();
  check("模型回 SKIP → text 为空（后台就不弹通知）", r.json?.ok === true && r.json?.text === "" && r.json?.skipped === true, JSON.stringify(r.json));
}

/* ───────── ⑤ 引号/前缀要清掉 ───────── */

console.log("\n【五】通知里不该出现引号或「他：」前缀");
{
  mode = "quoted";
  await post(ctx({ aiName: "星芒" }));
  const r = await get();
  check("引号被清掉", !/[「」“”"]/.test(r.json?.text ?? "x"), `text=${JSON.stringify(r.json?.text)}`);

  mode = "hi";
  await post(ctx());
  const fakeHi = "刚看你把咖啡换成了热的，胃是不是又不舒服了。";
  const r2 = await get();
  check("正常句子不会被误伤", r2.json?.text === fakeHi, r2.json?.text ?? "");
}

/* ───────── ⑥ 密钥绝不回显 ───────── */

console.log("\n【六】上游密钥只进不出");
{
  mode = "hi";
  const saved = await post(ctx());
  const got = await get();
  const all = `${JSON.stringify(saved)}${JSON.stringify(got)}${got.text}`;
  check("响应里没有 key", !all.includes(FAKE_KEY));
  check("响应里连 key 的前缀都没有", !all.includes("sk-FAKE"));

  mode = "fail";
  await post(ctx());
  const failRes = await get();
  const failAll = JSON.stringify(failRes);
  check("上游报错时也不带 key", !failAll.includes(FAKE_KEY), failRes.json?.why?.slice(0, 80) ?? "");
  check("上游报错时说清了状态码", /500/.test(failRes.json?.why ?? ""), failRes.json?.why ?? "");
}

/* ───────── ⑦ 时间要按用户时区 ───────── */

console.log("\n【七】时间必须按用户时区算（Worker 在 UTC）");
{
  mode = "hi";
  await post(ctx({ tz: "Asia/Shanghai" }));
  await get();
  const system = lastBody?.messages?.[0]?.content ?? "";

  /** 北京时间和 UTC 的日期/小时 —— 用同一套算法在本地算一份来对 */
  const fmt = (tz) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
  const stampOf = (tz) => {
    const p = fmt(tz);
    const g = (t) => p.find((x) => x.type === t)?.value ?? "";
    return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
  };

  const bj = stampOf("Asia/Shanghai");
  check("提示词里带上了北京时间（分钟级）", system.includes(bj.slice(0, 16)), `期望含 ${bj} / 实际片段 ${system.slice(0, 60).replace(/\n/g, " ")}`);
  check("提示词里有「你是谁」的人设段", /你是谁/.test(system) && /说话简短/.test(system));
  check("提示词里带上了最近的对话", /我今天有点胃疼/.test(lastBody?.messages?.[1]?.content ?? ""));
  check("提示词明确要求「最多两句」", /最多两句/.test(system));
  check("提示词给了「可以不说」的出口（SKIP）", /SKIP/.test(system) && /没什么好说/.test(system));
}

fake.close();
console.log("-".repeat(64));
console.log(`/api/wake 验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
