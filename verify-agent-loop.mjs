#!/usr/bin/env node
/**
 * 验收脚本：**agent loop（多步工具调用 + 同轮回执）**
 *
 * ── 这一轮要证明什么（用户原话）────────────────────────────────
 *
 *   "行动反过来说，是我盲发的。这一轮我发出动作，成没成，要等下一轮结果回来才知道；
 *    这一轮里我完全看不见。"
 *   "你在客户端里把'执行结果'那一栏做成永远有回话就行：匹配不到动作也回一条'没匹配上'，别沉默。"
 *
 * 以前：模型回 tool_calls → 客户端执行 → **结果攒着，等下一轮用户说话才带过去**。
 * 现在：模型回 tool_calls → 客户端执行 → **结果立刻作为 `role:"tool"` 消息再发一次** →
 *       模型基于结果继续说（可以再调）→ …直到给出最终回答，或者撞上上限（6 步 / 60 秒）。
 *
 * 所以这个脚本要端到端证明这些事：
 *   【A】主线：假上游第 1 次回 `tool_calls`（**故意分片**）→ 客户端**自动又发了一次请求**，
 *        且第二次请求里**真的带上了 tool 结果消息**（`role:"tool"` + 对得上的 `tool_call_id`
 *        + assistant 那条带 `tool_calls`）→ 假上游第 2 次回最终文本 → 客户端拿到了那段最终回答。
 *   【B】没匹配上：模型瞎编一个动作名 → 有**可见的**"没有叫 X 的动作（是不是名字写错了？）"，
 *        而且这句话**同时作为 tool 消息回了模型**（两边都不沉默），并且**没有**带着垃圾进权限闸门。
 *   【B2】参数错 / 被拒 / 还在等确认：每一种都有一行不重样的回话（说清哪个参数、说清是你拒的）。
 *   【C】上限：假上游**每次都回 tool_calls** → 最多 6 步收尾，并且**如实说明"到上限了"**。
 *   【C2】时间上限：墙钟预算到点也收尾（常量 60 秒；脚本里调小来验这条逻辑）。
 *   【C3】用户点停止 → 立刻收尾，不撒谎。
 *   【D】没破坏：上游明确不认 `tools` 时照样能识别（降级那条路不受这次改动影响）。
 *
 * ── 怎么做到"真的"（而不是测我自己的假包装）────────────────────
 *
 * 纯 node、**不起浏览器、不连外网**（只有一个 127.0.0.1 上的临时端口假上游）：
 *   · "客户端"用的是**真** `src/lib/tool-loop.ts`（`runToolLoop` / `runOneAction`）
 *     + **真** `src/lib/chat-client.ts`（`makeDirectRound` 那条直连通道，SSE 解析、
 *       分片 `tool_calls` 装配、看门狗全是线上那一套）；
 *   · "动作执行"用的是**真** `runOneAction` + **假**闸门（真闸门在 React 里，
 *     这里只实现 store 契约的那两个口：`requestAction` / `actionLog`）——
 *     所以"没匹配上 / 参数错 / 被拒 / 超时"这四条路是**真代码**走出来的；
 *   · 假上游记下**每一轮收到的完整请求体**，断言直接读它（"第二次请求里到底带了什么"）。
 *
 * ⚠️ 源码用的是 `@/` 别名 + 省略扩展名的 import（Vite 认，纯 node 不认）。
 * 验收脚本不许为了跑通去改源码，所以这里挂一个 `registerHooks` 的 resolve 钩子把它们补上。
 *
 * 跑法：
 *   node verify-agent-loop.mjs
 * 退出码 0 = 全过。反向验证见文件末尾 `【反向验证】` 那段说明。
 */
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/* ───────────────── 一、把源码按 Vite 的规矩 import 进来（纯 node） ───────────────── */

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const withExt = (base) => [
  base,
  `${base}.ts`,
  `${base}.tsx`,
  `${base}.js`,
  path.join(base, "index.ts"),
];

registerHooks({
  resolve(spec, ctx, next) {
    // `@/lib/x` → `<repo>/src/lib/x`
    if (spec.startsWith("@/")) {
      const base = path.join(ROOT, "src", spec.slice(2));
      for (const cand of withExt(base)) {
        if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
    }
    // `./models` → `./models.ts`（Vite 会自动补扩展名，node 不会）
    if (spec.startsWith("./") || spec.startsWith("../")) {
      const base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const cand of withExt(base)) {
        if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
    }
    return next(spec, ctx);
  },
});

/**
 * 直连通道的看门狗用的是 `window.setInterval`（浏览器 API）。
 * 这里给它一个最小的替身 —— 只补计时器，**不补任何行为**，所以还是真代码在跑。
 */
globalThis.window = globalThis.window ?? { setInterval, clearInterval, setTimeout, clearTimeout };

const {
  runToolLoop,
  runOneAction,
  toolResultMessages,
  TOOL_LOOP_MAX,
  TOOL_LOOP_BUDGET_MS,
} = await import("./src/lib/tool-loop.ts");
const { makeDirectRound } = await import("./src/lib/chat-client.ts");
const { actionToolsFor, kindOfToolName } = await import("./src/lib/action-schema.ts");
const { actionTitle } = await import("./src/lib/action-meta.ts");

/* ──────────────────────────── 二、断言小工具 ──────────────────────────── */

let passed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(detail ? `${name} —— ${detail}` : name);
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────────────────── 三、本地假上游（SSE） ───────────────────────── */

/** 每一轮收到的完整请求体（断言"第二次请求里带了什么"就看它） */
let sawRequests = [];
/** 这一轮假上游怎么回（每个用例自己换） */
let responder = () => [];

const frame = (delta) => ({ choices: [{ index: 0, delta, finish_reason: null }] });
const textFrame = (content) => frame({ role: "assistant", content });

/** 一帧 SSE 里的分片 tool_call（有的帧故意不给 index —— 真实中转就是这么发的） */
const callFrame = (part) => frame({ tool_calls: [part] });

function sse(res, frames) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
  });
  for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

const upstream = createServer(async (req, res) => {
  const body = await readBody(req);
  let parsed = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    /* ignore */
  }
  sawRequests.push({ raw: body, body: parsed });
  const frames = responder(parsed, sawRequests.length);
  if (frames?.rejectTools) {
    res.writeHead(400, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ error: { message: frames.rejectTools } }));
    return;
  }
  if (frames?.delayMs) await sleep(frames.delayMs);
  sse(res, frames ?? []);
});

await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const UP_BASE = `http://127.0.0.1:${upstream.address().port}/v1`;
console.log(`假上游（只监听 127.0.0.1 的临时端口）  ${UP_BASE}\n`);

/* ───────────────────── 四、假闸门（真 store 契约的最小实现） ───────────────────── */

/**
 * 闸门那一侧的替身。**只实现 store 的那两个口**：
 *   · `requestAction(action)` —— 真闸门把它排进 pendingActions，然后由权限卡片/授权决定
 *   · `actionLog` —— 真闸门执行完往这里写一条（`result: "denied"` = 用户拒了）
 * `behavior` 决定这一笔怎么落地：allow（已授权 → 直接执行）/ deny（用户拒绝）/ silent（没人点卡片）
 */
function makeGate(behavior, allowMessage) {
  const state = { actionLog: [], requests: [] };
  return {
    state,
    getState: () => ({
      actionLog: state.actionLog,
      requestAction: (action, from) => {
        state.requests.push({ action, from });
        if (behavior === "silent") return; // 卡片没人点 —— 真实现会一直挂在 pendingActions 里
        const title = actionTitle(action);
        if (behavior === "deny") {
          state.actionLog = [
            { title, result: "denied", message: "你拒绝了这次请求", at: Date.now() },
            ...state.actionLog,
          ];
          return;
        }
        state.actionLog = [
          {
            title,
            result: "allowed",
            message: allowMessage ? allowMessage(action) : `已执行：${title}`,
            at: Date.now(),
          },
          ...state.actionLog,
        ];
      },
    }),
  };
}

/** 用**真** runOneAction 拼出来的执行器（循环要的那个形状） */
function execWith(gate) {
  return async (calls, signal, deadline) => {
    const out = [];
    for (const call of calls) out.push(await runOneAction(call, signal, gate, deadline));
    return out;
  };
}

const reqFor = () => ({
  model: "sonnet",
  messages: [],
  style: "default",
  tools: [],
  customBaseUrl: UP_BASE,
  customApiKey: "stub-key",
  upstreamModel: "stub-model",
  name: "验收",
});

/** 跑一条完整的 loop（真 loop + 真直连通道 + 假上游 + 假闸门） */
async function runOnce({ tools = ["ui.highlight", "navigate"], gate, signal, maxRounds, budgetMs }) {
  const send = makeDirectRound(reqFor());
  return runToolLoop({
    send,
    baseMessages: [
      { role: "system", content: "（验收用的系统提示词）" },
      { role: "user", content: "把「验收」这两个字高亮一下" },
    ],
    tools: actionToolsFor(tools),
    runActions: execWith(gate),
    signal,
    maxRounds,
    budgetMs,
  });
}

/** 从某一轮请求里挑出工具调用/结果（断言用） */
const msgsOf = (i) => (Array.isArray(sawRequests[i]?.body?.messages) ? sawRequests[i].body.messages : []);
const toolMsgsOf = (i) => msgsOf(i).filter((m) => m?.role === "tool");
const assistantCallMsgsOf = (i) =>
  msgsOf(i).filter((m) => m?.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length);

/* ═══════════════════════════ 开跑 ═══════════════════════════ */

console.log("【0】常量与模块自检");
check(`步数上限是 6（TOOL_LOOP_MAX=${TOOL_LOOP_MAX}）`, TOOL_LOOP_MAX === 6, `实际 ${TOOL_LOOP_MAX}`);
check(
  `时间上限是 60 秒（TOOL_LOOP_BUDGET_MS=${TOOL_LOOP_BUDGET_MS}）`,
  TOOL_LOOP_BUDGET_MS === 60_000,
  `实际 ${TOOL_LOOP_BUDGET_MS}`,
);
check("runToolLoop / runOneAction / toolResultMessages 都能拿到（真模块）", 
  typeof runToolLoop === "function" && typeof runOneAction === "function" && typeof toolResultMessages === "function");
check(
  "假上游里的工具名确实是真动作名（ui_highlight ↔ ui.highlight）",
  kindOfToolName("ui_highlight") === "ui.highlight",
  String(kindOfToolName("ui_highlight")),
);

/* ═════════ A. 主线：执行完**立刻**回灌，自动再发一次 ═════════ */

console.log("\n【A】主线 —— 模型回 tool_calls → 执行 → 结果立刻再发一次 → 最终回答");
sawRequests = [];
/** 第 1 轮：**分片**的 tool_calls（名字切两段、参数切三段、后半段不带 index） */
responder = (_body, n) => {
  if (n === 1) {
    return [
      textFrame("好，我先标一下。"),
      callFrame({ index: 0, id: "call_hl_1", type: "function", function: { name: "ui_h", arguments: "" } }),
      callFrame({ index: 0, function: { name: "ighlight", arguments: '{"te' } }),
      callFrame({ function: { arguments: 'xt":"验' } }),
      callFrame({ function: { arguments: '收"}' } }),
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
  }
  return [textFrame("高亮好了，你看看那两个字。")];
};
const gateA = makeGate("allow", (a) => `已高亮页面上的「${a.text}」`);
const a = await runOnce({ gate: gateA });

check(
  "① 客户端**自动又发了一次请求**（假上游被请求 ≥2 次 —— 不再是'执行完就等下一轮'）",
  sawRequests.length >= 2,
  `假上游只收到 ${sawRequests.length} 轮`,
);
const aTool = toolMsgsOf(1);
const aCall = assistantCallMsgsOf(1)[0]?.tool_calls?.[0];
check(
  "② 第二次请求里带上了 tool 结果消息（role:\"tool\"，且内容含真实执行结果）",
  aTool.length === 1 && typeof aTool[0].content === "string" && aTool[0].content.includes("已高亮"),
  JSON.stringify(aTool.map((m) => m.content)).slice(0, 160),
);
check(
  "③ 回灌顺序对：assistant（带 tool_calls）在前、tool 结果在后，且 tool_call_id 对得上",
  Boolean(aCall) &&
    aTool.length === 1 &&
    aTool[0].tool_call_id === aCall.id &&
    msgsOf(1).findIndex((m) => m.role === "tool") >
      msgsOf(1).findIndex((m) => Array.isArray(m.tool_calls)),
  `call_id=${aCall?.id} tool_call_id=${aTool[0]?.tool_call_id}`,
);
check(
  "④ 分片被拼全了：函数名是 ui_highlight、参数是完整 JSON",
  aCall?.function?.name === "ui_highlight" && (() => {
    try {
      return JSON.parse(aCall.function.arguments)?.text === "验收";
    } catch {
      return false;
    }
  })(),
  JSON.stringify(aCall ?? null).slice(0, 160),
);
check(
  "⑤ 动作**真的执行**了（闸门收到了一笔 ui.highlight 的请求 —— 不是绕过去直接假装的）",
  gateA.state.requests.length === 1 && gateA.state.requests[0].action.kind === "ui.highlight",
  JSON.stringify(gateA.state.requests.map((r) => r.action)).slice(0, 160),
);
check(
  "⑥ 界面/状态里拿到了最终回答（假上游第 2 次的正文）",
  a.content.includes("高亮好了，你看看那两个字。"),
  JSON.stringify(a.content).slice(0, 120),
);
check(
  "⑦ 每一步都有一行可见回话（✅ + 动作名 + 一句话结果）",
  a.rounds[0]?.calls?.[0]?.notice?.startsWith("✅") &&
    a.rounds[0].calls[0].notice.includes("ui.highlight") &&
    a.rounds[0].calls[0].notice.includes("已高亮"),
  JSON.stringify(a.rounds[0]?.calls?.[0] ?? null).slice(0, 200),
);
check(
  "⑧ 正常收尾：stoppedBy=done、没有撞上限、steps=1",
  a.stoppedBy === "done" && a.hitLimit === false && a.steps === 1,
  `stoppedBy=${a.stoppedBy} hitLimit=${a.hitLimit} steps=${a.steps}`,
);

/* ═════════ B. 没匹配上：可见的回话（用户点名"别沉默"） ═════════ */

console.log("\n【B】动作名不存在 —— 必须有可见的「没匹配上」，而且也要回给模型");
sawRequests = [];
responder = (_body, n) =>
  n === 1
    ? [
        callFrame({ index: 0, id: "call_ghost", function: { name: "ui_glow", arguments: "{}" } }),
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]
    : [textFrame("抱歉，那个名字我编错了。")];
const gateB = makeGate("allow");
const b = await runOnce({ gate: gateB });

const bCall = b.rounds[0]?.calls?.[0];
check(
  "⑨ 有可见的「没匹配上」：⚠️ 没有叫 ui_glow 的动作（是不是名字写错了？）",
  bCall?.notice?.startsWith("⚠️") &&
    bCall.notice.includes("没有叫 ui_glow 的动作") &&
    bCall.notice.includes("是不是名字写错了"),
  JSON.stringify(bCall?.notice ?? null),
);
check("⑩ 分类是 unknown（界面按它上色/单独计数）", bCall?.category === "unknown", String(bCall?.category));
check(
  "⑪ 这句话**同时**作为 tool 消息回了模型（他自己也看得见，不用等下一轮）",
  toolMsgsOf(1).some((m) => String(m.content).includes("没有「ui_glow」")),
  JSON.stringify(toolMsgsOf(1).map((m) => m.content)).slice(0, 200),
);
check(
  "⑫ 瞎编的名字**没有**带着垃圾进权限闸门（不入队 = 不会弹一张写着 undefined 的卡片）",
  gateB.state.requests.length === 0,
  JSON.stringify(gateB.state.requests.map((r) => r.action)),
);

/* ═════════ B2. 参数错 / 被拒 / 还在等确认：每一种都有不重样的回话 ═════════ */

console.log("\n【B2】参数错 / 被拒 / 等确认 —— 三条路各自的回话");
const gateArgs = makeGate("allow");
const badArgs = await runOneAction(
  { index: 0, name: "navigate", args: '{"pth":"/play"}' },
  undefined,
  gateArgs,
);
check(
  "⑬ 参数错：说清**是哪个参数**不对（少了参数「path」）",
  badArgs.category === "badargs" && badArgs.notice.includes("path") && badArgs.notice.startsWith("❌"),
  JSON.stringify(badArgs.notice),
);
const brokenJson = await runOneAction(
  { index: 0, name: "navigate", args: '{"path":' },
  undefined,
  makeGate("allow"),
);
check(
  "⑭ 参数不是合法 JSON：说清 + 告诉他这个动作要的参数（path（必填））",
  brokenJson.category === "badargs" &&
    brokenJson.notice.includes("参数不是合法 JSON") &&
    brokenJson.notice.includes("path"),
  JSON.stringify(brokenJson.notice).slice(0, 200),
);
const denied = await runOneAction(
  { index: 0, name: "todo_add", args: '{"text":"验收"}' },
  undefined,
  makeGate("deny"),
);
check(
  "⑮ 被拒：说清**是你拒的**（不是他写错、也不是系统坏了）",
  denied.category === "denied" && denied.notice.startsWith("❌") && denied.notice.includes("你拒"),
  JSON.stringify(denied.notice),
);
const t0 = Date.now();
const pending = await runOneAction(
  { index: 0, name: "todo_add", args: '{"text":"验收"}' },
  undefined,
  makeGate("silent"),
  Date.now() + 600,
);
check(
  "⑯ 还在等你点确认：不沉默、也不挂死（有 ⏳ 回话，而且到点就返回）",
  pending.category === "pending" && pending.notice.startsWith("⏳") && Date.now() - t0 < 5000,
  `${JSON.stringify(pending.notice)} 用了 ${Date.now() - t0}ms`,
);

/* ═════════ C. 上限：最多 6 步 + 如实说明 ═════════ */

console.log("\n【C】上限 —— 假上游每次都回 tool_calls");
sawRequests = [];
responder = () => [
  callFrame({ index: 0, id: "call_loop", function: { name: "ui_highlight", arguments: '{"text":"再来"}' } }),
  { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
];
const gateC = makeGate("allow", (a) => `已高亮页面上的「${a.text}」`);
const c = await runOnce({ gate: gateC });

check(
  `⑰ 最多 ${TOOL_LOOP_MAX} 步就收尾（发出去的请求数 = ${sawRequests.length}，不会无限调下去）`,
  sawRequests.length === TOOL_LOOP_MAX && c.steps === TOOL_LOOP_MAX,
  `请求 ${sawRequests.length} 轮 / 执行 ${c.steps} 步`,
);
check(
  "⑱ stoppedBy=maxRounds、hitLimit=true（调用方知道这是撞上限，不是模型说完了）",
  c.stoppedBy === "maxRounds" && c.hitLimit === true,
  `stoppedBy=${c.stoppedBy} hitLimit=${c.hitLimit}`,
);
check(
  "⑲ **如实说明「到上限了」**（不是含糊的「先停下让你看看」）",
  typeof c.limitNote === "string" && c.limitNote.includes("到上限了") && c.limitNote.includes(`${TOOL_LOOP_MAX} 步`),
  JSON.stringify(c.limitNote ?? null),
);
check(
  "⑳ 最后一步的结果**老实说没回给他**（pendingCalls 非空 —— 不许说成「都做好了」）",
  c.pendingCalls.length > 0,
  `pendingCalls=${c.pendingCalls.length}`,
);
check(
  "㉑ 每一步都留下了记录（6 步 6 条，每一条都有 notice）",
  c.rounds.length === TOOL_LOOP_MAX && c.rounds.every((r) => r.calls.every((x) => x.notice)),
  `rounds=${c.rounds.length}`,
);

/* ═════════ C2. 时间上限：到点也收尾（60 秒那条逻辑） ═════════ */

console.log("\n【C2】时间上限 —— 墙钟预算到点收尾（脚本里把预算调小来验这条逻辑）");
sawRequests = [];
/** 每一轮都慢 400ms、都回 tool_calls —— 只有时间上限能拦住它 */
responder = () => [
  callFrame({ index: 0, id: "call_slow", function: { name: "ui_highlight", arguments: '{"text":"慢"}' } }),
  { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
];
const slowSend = makeDirectRound(reqFor());
const slowGate = makeGate("allow");
const c2 = await runToolLoop({
  send: async (args) => {
    await sleep(400);
    return slowSend(args);
  },
  baseMessages: [{ role: "user", content: "慢慢来" }],
  tools: actionToolsFor(["ui.highlight"]),
  runActions: execWith(slowGate),
  budgetMs: 1500,
});
check(
  "㉒ 预算 1.5 秒内就收尾了（没跑满 6 步，也没再往下发请求）",
  c2.stoppedBy === "budget" && c2.steps < TOOL_LOOP_MAX && sawRequests.length === c2.steps,
  `stoppedBy=${c2.stoppedBy} steps=${c2.steps} 请求=${sawRequests.length}`,
);
check(
  "㉓ 时间上限也**如实说明**（「到上限了」+ 秒数）",
  typeof c2.limitNote === "string" && c2.limitNote.includes("到上限了") && c2.limitNote.includes("秒"),
  JSON.stringify(c2.limitNote ?? null),
);

/* ═════════ C3. 用户点停止：立刻收尾、不撒谎 ═════════ */

console.log("\n【C3】用户点了停止 —— 立刻收尾");
sawRequests = [];
responder = () => [
  callFrame({ index: 0, id: "call_abort", function: { name: "ui_highlight", arguments: '{"text":"停"}' } }),
  { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
];
const ac = new AbortController();
const gateD = makeGate("allow");
const d = await runToolLoop({
  send: makeDirectRound(reqFor()),
  baseMessages: [{ role: "user", content: "停一下" }],
  tools: actionToolsFor(["ui.highlight"]),
  signal: ac.signal,
  runActions: async (calls, signal, deadline) => {
    const out = await execWith(gateD)(calls, signal, deadline);
    ac.abort(); // 模拟"用户在第一步执行完那一刻按了停止"
    return out;
  },
});
check(
  "㉔ 停止之后立刻收尾：只发了 1 轮请求、stoppedBy=aborted",
  sawRequests.length === 1 && d.stoppedBy === "aborted" && d.hitLimit === true,
  `请求=${sawRequests.length} stoppedBy=${d.stoppedBy}`,
);
check(
  "㉕ 停止也如实说明（「你按了停止」），不许装作是正常答完的",
  typeof d.limitNote === "string" && d.limitNote.includes("你按了停止"),
  JSON.stringify(d.limitNote ?? null),
);

/* ═════════ D. 没破坏：上游不认 tools 时照样识别（降级那条路） ═════════ */

console.log("\n【D】没破坏 —— 上游明确不认 tools 时，循环要如实把它标出来");
sawRequests = [];
responder = () => ({ rejectTools: "tools is not supported by this model" });
const e = await runToolLoop({
  send: makeDirectRound(reqFor()),
  baseMessages: [{ role: "user", content: "记个待办" }],
  tools: actionToolsFor(["todo.add"]),
  runActions: execWith(makeGate("allow")),
});
check(
  "㉖ toolsRejected=true、正文清空（调用方才能按文本协议重来）",
  e.toolsRejected === true && e.content === "",
  `toolsRejected=${e.toolsRejected} content=${JSON.stringify(e.content).slice(0, 40)}`,
);

/* ═════════ 收尾 ═════════ */

console.log(`\n${"─".repeat(72)}`);
console.log(
  failures.length === 0
    ? `全部通过：${passed} 项断言 ✅（纯 node；假上游只监听 127.0.0.1 临时端口；未起浏览器、未连外网）`
    : `通过 ${passed} 项，失败 ${failures.length} 项 ❌`,
);
for (const f of failures) console.log(`  · ${f}`);

upstream.close();
process.exit(failures.length === 0 ? 0 : 1);
