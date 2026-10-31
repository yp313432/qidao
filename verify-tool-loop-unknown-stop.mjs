#!/usr/bin/env node
/**
 * 验收脚本：**不存在的动作 → 抬手就停**（tool-loop.ts 的硬终止，两道闸门）
 *
 * ── 这一轮要证明什么（用户实机截图）────────────────────────────
 *
 *   "模型反复调一个不存在的动作，连续 12 条「小克 想叫一个不存在的动作」，
 *    直到步数上限才停。"
 *
 *   根因：`runOneAction` 对未知工具名只回一句「没有这个动作，请只用清单里的名字」——
 *   这是一句**软提示**。模型不看，或者换个写法接着编，而主循环**没有任何硬终止条件**，
 *   于是每一轮都重新请求模型，一路烧到 `TOOL_LOOP_MAX`（12 步）。
 *
 *   现在要的两道闸门（任一命中都不再请求模型）：
 *     ① 同名第二次 —— `UNKNOWN_ACTION_STOP_AFTER`，
 *        人话：「他想调 XXX，但没这个动作 · 抬手就停」。
 *     ② 一整轮所有不存在动作加起来第 3 个 —— `UNKNOWN_ACTION_TOTAL_STOP`，
 *        **换名字也躲不掉**（模型把 delete_everything 改成 deleteEverything 就绕过了①），
 *        人话：「他想调几个不存在的动作（共 N 次）· 抬手就停」。
 *
 * ── 怎么验（纯 node，不起浏览器、不连外网、不起端口）──────────────
 *
 *   · `send` 是本脚本自己写的**假上游**：它记下被请求了几次，按剧本回 tool_calls。
 *     —— 这正是 `runToolLoop` 的注入点，所以"只请求了 2 次 / 3 次"是**真循环**给出的，
 *        不是我看日志推出来的。
 *   · 动作执行用**真** `runOneAction` + **假**闸门（真闸门在 React 里）：
 *     未知名字**根本到不了闸门**（这一点也断言了 —— 不能弹一张写着 undefined 的卡）。
 *
 * 跑法：node verify-tool-loop-unknown-stop.mjs
 * 退出码 0 = 全过。
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/* ───────────────── 一、按 Vite 的规矩把源码 import 进来（纯 node） ───────────────── */

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, "index.ts")];

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      const base = path.join(ROOT, "src", spec.slice(2));
      for (const cand of withExt(base)) {
        if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
    }
    if (spec.startsWith("./") || spec.startsWith("../")) {
      const base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const cand of withExt(base)) {
        if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
    }
    return next(spec, ctx);
  },
});

const {
  runToolLoop,
  runOneAction,
  limitNoteFor,
  UNKNOWN_ACTION_STOP_AFTER,
  UNKNOWN_ACTION_TOTAL_STOP,
  TOOL_LOOP_MAX,
} = await import("./src/lib/tool-loop.ts");
const { actionToolsFor, kindOfToolName } = await import("./src/lib/action-schema.ts");

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

/* ───────────────────── 三、假闸门（真 store 契约的最小实现） ───────────────────── */

/**
 * 真闸门在 `action-gate.tsx` 里（React 组件，纯 node 拉不起来），
 * 所以这里给一个**只满足 ActionQueue 契约**的假闸门：
 *
 *   · `requestAction` 记下谁进了闸门（`requests`）—— 未知动作**不该走到这里**
 *     （`runOneAction` 在 `!kind` 分支就返回了），断言里要证明它一次都没被调用；
 *   · 合法的动作：立刻往 `actionLog` 里补一条"已执行"，
 *     `waitForResolution` 靠 `actionLog` 有新条目来判断某笔动作有结果了。
 *     —— 不补这条，真代码会一直轮询到这一轮的截止时刻（5 分钟上限），
 *        验收脚本就变成"等 5 分钟"，那没意义（也证明不了什么）。
 */
function makeGate() {
  const requests = [];
  const actionLog = [];
  let seq = 0;
  return {
    requests,
    getState: () => ({
      actionLog,
      requestAction: (action, from) => {
        requests.push({ action, from });
        seq += 1;
        actionLog.push({
          title: `（假闸门）${action.kind}`,
          result: "（假闸门：已执行）",
          message: "",
          at: 1_700_000_000_000 + seq,
        });
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

/* ───────────────────── 四、假上游：按剧本回 tool_calls ───────────────────── */

/**
 * @param script (第几次请求, 已发请求数) => tool_calls[]（空数组 = 给最终回答）
 */
function makeSend(script) {
  const sent = [];
  const send = async ({ messages, tools, onDelta }) => {
    sent.push({ messages, tools });
    const n = sent.length;
    const calls = script(n, sent);
    for (const c of calls) {
      onDelta({ toolCalls: [{ index: c.index, id: c.id, name: c.name, args: c.args }] });
    }
    return { content: calls.length === 0 ? "好。" : "", thinking: "", toolCalls: calls };
  };
  return { send, sent };
}

const call = (name, args = "{}", i = 0) => ({ index: i, id: `call_${name}_${i}`, name, args });

/** 跑一整轮 loop（真循环 + 假上游 + 真 runOneAction） */
async function runOnce(script, opts = {}) {
  const up = makeSend(script);
  const gate = makeGate();
  const result = await runToolLoop({
    send: up.send,
    baseMessages: [
      { role: "system", content: "（验收用的系统提示词）" },
      { role: "user", content: "把那个东西删了" },
    ],
    tools: actionToolsFor(["ui.highlight", "todo.add"]),
    runActions: execWith(gate),
    budgetMs: 20_000,
    maxRounds: opts.maxRounds ?? TOOL_LOOP_MAX,
  });
  return { result, sent: up.sent, gate };
}

/* ═══════════════════════════ 开跑 ═══════════════════════════ */

console.log("【0】常量自检");
check(
  `同名未知动作的容忍次数是 2（UNKNOWN_ACTION_STOP_AFTER=${UNKNOWN_ACTION_STOP_AFTER}）`,
  UNKNOWN_ACTION_STOP_AFTER === 2,
  `实际 ${UNKNOWN_ACTION_STOP_AFTER}`,
);
check(
  `一整轮不存在动作的总量闸门是 3（UNKNOWN_ACTION_TOTAL_STOP=${UNKNOWN_ACTION_TOTAL_STOP}）`,
  UNKNOWN_ACTION_TOTAL_STOP === 3,
  `实际 ${UNKNOWN_ACTION_TOTAL_STOP}`,
);
check(
  "runOneAction / runToolLoop / limitNoteFor 都是真模块里的函数",
  typeof runOneAction === "function" &&
    typeof runToolLoop === "function" &&
    typeof limitNoteFor === "function",
);
check(
  "假上游里的名字确实是「不存在」的（kindOfToolName 对 delete_everything 给空）",
  !kindOfToolName("delete_everything"),
  String(kindOfToolName("delete_everything")),
);

/* ═════════ A. 核心：连续两次调同一个不存在的动作 → 停在第 2 次 ═════════ */

console.log("\n【A】连续两次调同一个不存在的动作 —— 必须只请求 2 次就收尾");
const A = await runOnce((n) => [call("delete_everything")]);

check(
  "① 只请求了模型 **2 次**（第 3 次没有发生 —— 不再往下试）",
  A.sent.length === 2,
  `实际请求 ${A.sent.length} 次（TOOL_LOOP_MAX=${TOOL_LOOP_MAX}）`,
);
check(
  "② 循环确实执行了 2 步，但**没有**走到步数上限",
  A.result.steps === 2 && A.result.steps < TOOL_LOOP_MAX,
  `steps=${A.result.steps} maxRounds=${TOOL_LOOP_MAX}`,
);
check(
  "③ 有 terminate 标记：stoppedBy === \"unknownAction\" 且 hitLimit === true",
  A.result.stoppedBy === "unknownAction" && A.result.hitLimit === true,
  `stoppedBy=${A.result.stoppedBy} hitLimit=${A.result.hitLimit}`,
);

const aNote = A.result.limitNote ?? "";
check(
  "④ 给用户的人话：「他想调 delete_everything，但没这个动作 · 抬手就停」",
  aNote.includes("他想调 delete_everything，但没这个动作 · 抬手就停"),
  JSON.stringify(aNote),
);
check(
  "⑤ 这句人话**不是**「到上限了」（两种停法是两件事，不能混为一谈）",
  !aNote.includes("到上限了") && aNote.includes("抬手就停"),
  JSON.stringify(aNote),
);

const aSecond = A.result.rounds[1]?.calls?.[0];
check(
  "⑥ 第 2 次那条记录：category 还是 unknown、notice 是那句「抬手就停」",
  aSecond?.category === "unknown" &&
    String(aSecond?.notice).includes("他想调 delete_everything，但没这个动作 · 抬手就停"),
  JSON.stringify(aSecond ?? null).slice(0, 240),
);
check(
  "⑦ 第 2 次回给模型的结果明确写了「这个动作不存在，别再试」+「可用动作只有本次 tools 清单」",
  String(aSecond?.result).includes("这个动作不存在，别再试") &&
    String(aSecond?.result).includes("可用动作只有本次 tools 清单里的那些"),
  JSON.stringify(aSecond?.result ?? null).slice(0, 240),
);
check(
  "⑧ 第 1 次仍是软提示（没有被误判成「要停」），而且分类是 unknown",
  A.result.rounds[0]?.calls?.[0]?.category === "unknown" &&
    String(A.result.rounds[0]?.calls?.[0]?.notice).includes("没有叫 delete_everything 的动作"),
  JSON.stringify(A.result.rounds[0]?.calls?.[0] ?? null).slice(0, 240),
);
check(
  "⑨ 最后一步的结果**如实说没回给模型**（pendingCalls 非空，不是「都做好了」）",
  A.result.pendingCalls.length === 1 && A.result.pendingCalls[0].name === "delete_everything",
  `pendingCalls=${JSON.stringify(A.result.pendingCalls.map((c) => c.name))}`,
);
check(
  "⑩ 瞎编的名字**一次都没进权限闸门**（不会弹一张写着 undefined 的卡片）",
  A.gate.requests.length === 0,
  JSON.stringify(A.gate.requests.map((r) => r.action)),
);
check(
  "⑪ 第 2 次请求里确实带着第 1 次的 tool 结果（软提示真回给了模型，他没理由不知道）",
  JSON.stringify(A.sent[1]?.messages ?? []).includes("没有「delete_everything」"),
  JSON.stringify(
    (A.sent[1]?.messages ?? []).filter((m) => m.role === "tool").map((m) => m.content),
  ).slice(0, 240),
);

/* ═════════ B. 不能误伤：只调一次未知动作、然后正常答完 ═════════ */

console.log("\n【B】只调一次未知动作 → 给一次自纠机会，不终止");
const B = await runOnce((n) =>
  n === 1 ? [call("delete_everything")] : n === 2 ? [call("ui_highlight", '{"text":"验收"}')] : [],
);
check(
  "⑫ 第 1 次未知名字之后循环照常继续（请求 3 次：未知 → 合法动作 → 最终回答）",
  B.sent.length === 3,
  `实际请求 ${B.sent.length} 次`,
);
check(
  "⑬ 正常收尾：stoppedBy === \"done\"、没有 limitNote、steps === 2",
  B.result.stoppedBy === "done" && B.result.limitNote === undefined && B.result.steps === 2,
  `stoppedBy=${B.result.stoppedBy} steps=${B.result.steps} limitNote=${JSON.stringify(B.result.limitNote)}`,
);
check(
  "⑭ 合法动作照旧执行（闸门收到了 ui.highlight 那一笔）",
  B.gate.requests.length === 1 && B.gate.requests[0].action.kind === "ui.highlight",
  JSON.stringify(B.gate.requests.map((r) => r.action)),
);

/* ═════════ C. 同一批里出现两次同名未知动作 → 也停 ═════════ */

console.log("\n【C】同一批 tool_calls 里出现两次同名未知动作 → 同样终止");
const C = await runOnce(() => [call("delete_everything", "{}", 0), call("delete_everything", "{}", 1)]);
check(
  "⑮ 一批就触发终止：只请求 1 次、stoppedBy=unknownAction",
  C.sent.length === 1 && C.result.stoppedBy === "unknownAction",
  `请求=${C.sent.length} stoppedBy=${C.result.stoppedBy}`,
);
check(
  "⑯ 批里第 2 条的结果带硬话，第 1 条仍是软提示（计数按出现顺序）",
  String(C.result.rounds[0]?.calls?.[1]?.result).includes("这个动作不存在，别再试") &&
    !String(C.result.rounds[0]?.calls?.[0]?.result).includes("这个动作不存在，别再试"),
  JSON.stringify(C.result.rounds[0]?.calls?.map((c) => c.result)).slice(0, 320),
);

/* ═════════ D. 不同的未知名字各一次 → 总量还没到 3，不终止 ═════════ */

console.log("\n【D】两个**不同**的不存在名字各一次 → 总量只到 2，不终止（给一次改名字的机会）");
const D = await runOnce((n) =>
  n === 1 ? [call("delete_everything")] : n === 2 ? [call("make_coffee")] : [],
);
check(
  "⑰ 两个不同名字各一次：照常收尾（stoppedBy=done），没有误杀",
  D.result.stoppedBy === "done" && D.sent.length === 3,
  `stoppedBy=${D.result.stoppedBy} 请求=${D.sent.length}`,
);

/* ═════════ E. 步数上限那条老路没被破坏 ═════════ */

console.log("\n【E】没破坏：合法动作一直调 → 照旧撞 maxRounds");
const E = await runOnce(() => [call("ui_highlight", '{"text":"再来"}')], { maxRounds: 3 });
check(
  "⑱ 合法动作反复调：停在 maxRounds，文案仍是「到上限了」（没有误改成「抬手就停」）",
  E.result.stoppedBy === "maxRounds" &&
    E.sent.length === 3 &&
    String(E.result.limitNote).includes("到上限了") &&
    !String(E.result.limitNote).includes("抬手就停"),
  `stoppedBy=${E.result.stoppedBy} 请求=${E.sent.length} limitNote=${JSON.stringify(E.result.limitNote).slice(0, 120)}`,
);

/* ═════════ F. 换名字也躲不掉：三个不同的不存在名字各一次 → 第 3 个就停 ═════════ */

console.log("\n【F】三个**不同**的不存在名字各一次（换写法绕同名计数）→ 第 3 次就停");
const F = await runOnce((n) =>
  n === 1
    ? [call("deleteEverything")]
    : n === 2
      ? [call("delete_all")]
      : n === 3
        ? [call("remove_everything")]
        : [],
);
check(
  "⑲ 总量闸门：**只请求模型 3 次**（第 4 次没发生 —— 名字换着来也躲不掉）",
  F.sent.length === 3,
  `实际请求 ${F.sent.length} 次（TOOL_LOOP_MAX=${TOOL_LOOP_MAX}）`,
);
check(
  "⑳ terminate 标记：stoppedBy === \"unknownAction\"、hitLimit === true、steps=3",
  F.result.stoppedBy === "unknownAction" &&
    F.result.hitLimit === true &&
    F.result.steps === 3,
  `stoppedBy=${F.result.stoppedBy} hitLimit=${F.result.hitLimit} steps=${F.result.steps}`,
);
const fNote = F.result.limitNote ?? "";
check(
  "㉑ 人话：含「不存在的动作」+「共 3 次」+「抬手就停」，且不是「到上限了」",
  fNote.includes("不存在的动作") &&
    fNote.includes("共 3 次") &&
    fNote.includes("抬手就停") &&
    !fNote.includes("到上限了"),
  JSON.stringify(fNote),
);
check(
  "㉒ 第 3 条记录：notice 说明「这一轮已经第 3 个不存在的动作了」，result 是硬话",
  String(F.result.rounds[2]?.calls?.[0]?.notice).includes("这一轮已经第 3 个不存在的动作了") &&
    String(F.result.rounds[2]?.calls?.[0]?.result).includes("这个动作不存在，别再试"),
  JSON.stringify(F.result.rounds[2]?.calls?.[0] ?? null).slice(0, 320),
);
check(
  "㉓ 前两个不同名字仍是软提示（没提前误杀），闸门 0 次调用",
  !String(F.result.rounds[0]?.calls?.[0]?.result).includes("这个动作不存在，别再试") &&
    !String(F.result.rounds[1]?.calls?.[0]?.result).includes("这个动作不存在，别再试") &&
    F.gate.requests.length === 0,
  JSON.stringify(F.result.rounds.slice(0, 2).map((r) => r.calls[0]?.result)).slice(0, 320),
);
check(
  "㉔ pendingCalls 如实记着最后那一笔（没谎称都做好了）",
  F.result.pendingCalls.length === 1 &&
    F.result.pendingCalls[0].name === "remove_everything",
  JSON.stringify(F.result.pendingCalls.map((c) => c.name)),
);

/* ═════════ G. 总量跨轮累计：中间夹一次合法动作，也照数 ═════════ */

console.log("\n【G】总量跨轮累计：未知 → 合法 → 未知 → 未知 → 停在第 4 轮请求");
const G = await runOnce((n) =>
  n === 1
    ? [call("deleteEverything")]
    : n === 2
      ? [call("ui_highlight", '{"text":"先干点正事"}')]
      : n === 3
        ? [call("delete_all")]
        : n === 4
          ? [call("make_coffee")]
          : [],
);
check(
  "㉕ 3 个不存在动作分在 3 个不同轮里（中间夹了一次合法动作）→ 依然在第 3 个停下",
  G.sent.length === 4 && G.result.stoppedBy === "unknownAction",
  `请求=${G.sent.length} stoppedBy=${G.result.stoppedBy} steps=${G.result.steps}`,
);
check(
  "㉖ 合法动作那次没有被误判成停手（那一轮结束后循环还在继续）",
  G.gate.requests.length === 1 && String(G.result.limitNote).includes("共 3 次"),
  `闸门=${G.gate.requests.length} limitNote=${JSON.stringify(G.result.limitNote).slice(0, 140)}`,
);

/* ═════════ 收尾 ═════════ */

console.log(`\n${"─".repeat(72)}`);
console.log(
  failures.length === 0
    ? `全部通过：${passed} 项断言 ✅（纯 node；无端口、无浏览器、无外网）`
    : `通过 ${passed} 项，失败 ${failures.length} 项 ❌`,
);
for (const f of failures) console.log(`  · ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
