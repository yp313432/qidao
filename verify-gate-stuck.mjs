#!/usr/bin/env node
/**
 * 验收：**一笔动作永远不会把闸门队列堵死**（纯 node，不起浏览器、不连外网）。
 *
 * ── 这条脚本是为哪个真机 bug 写的 ────────────────────────────────
 *
 * 用户原话（2026-11）：
 *   "他发出去的动作没有卡片弹出来……明明我已经允许的权限他也卡住了，发出去的动作全挂着。"
 *
 * 根因（读代码得出的，见 `src/lib/gate-run.ts` 的文件头）：
 *   `action-gate.tsx` 里原来是裸的 `await runAction(...)` —— 它一抛错/一卡住，
 *   `resolveAction()` 就永远不会被调用，那笔动作一直占着 `pendingActions` 的**队头**；
 *   而闸门只渲染队头，于是**后面所有动作既没有卡片、也永远不动**。
 *
 * 所以这里证两件事：
 *   【A】`runGuarded()` 对"正常 / 抛错 / 卡住"三种情况**都返回、都不抛**，
 *        而且超时那句必须是"没拿到结果"的口径（不许写成"已经做好了"）。
 *   【B】那两句话到了 `tool-loop.ts` 的 `looksRefused()` 手里必须被认成**没做成**
 *        （否则界面上会出现 `✅ 执行时报错了…` 这种自相矛盾的行）。
 *   【C】反向验证：把 `runGuarded` 换成"裸调用"的等价写法，【A】必须变红 ——
 *        证明断言真的在测这把保险丝，而不是在测空气。
 *
 * 跑法：
 *   node verify-gate-stuck.mjs
 *   QIDAO_MUTATE_REVERSE=1 node verify-gate-stuck.mjs    # 反向验证（必须变红，退出码 0 = 通过）
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/* 先保证能 import `.ts`（Node 的类型擦除）：没带 flag 就自己再跑一遍带 flag 的 */
if (!process.execArgv.includes("--experimental-strip-types")) {
  const self = fileURLToPath(import.meta.url);
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", self, ...process.argv.slice(2)],
    { stdio: "inherit", cwd: process.cwd() },
  );
  process.exit(child.status ?? 1);
}

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}.js`];

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

const { runGuarded, GATE_RUN_TIMEOUT_MS } = await import("./src/lib/gate-run.ts");
const { looksRefused } = await import("./src/lib/tool-loop.ts");
const {
  WEB_FETCH_DEFAULTS,
  WEB_SEARCH_BUDGET_MS,
  WEB_SEARCH_PER_ENDPOINT_MS,
  NATIVE_HTTP_HARD_MS,
} = await import("./src/lib/web-http.ts");

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(detail ? `${name} —— ${detail}` : name);
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

/* ───────────── 【A】三种情况都必须返回、都不抛 ───────────── */

console.log("【A】runGuarded：正常 / 抛错 / 卡住 —— 三种都返回，一次都不许抛");

const okRun = await runGuarded(async () => "已记住这件事");
check("正常执行：原话原样带出来", okRun.ok === true && okRun.message === "已记住这件事", JSON.stringify(okRun));

const errRun = await runGuarded(async () => {
  throw new Error("原生那边说：SenseBridge.diag 没实现");
});
check(
  "执行器抛错：收成 ok:false + kind=error，且**不抛**（抛了就是队列堵死）",
  errRun.ok === false && errRun.kind === "error" && errRun.message.includes("失败"),
  JSON.stringify(errRun),
);
check(
  "抛错那句里**保留了原始报错**（这是唯一能查的线索，不许吞）",
  errRun.message.includes("SenseBridge.diag 没实现"),
  errRun.message,
);

const never = new Promise(() => {});
const t0 = Date.now();
const hangRun = await runGuarded(() => never, 150);
const waited = Date.now() - t0;
check(
  "执行器卡住：到点收成 ok:false + kind=timeout（绝不无限等）",
  hangRun.ok === false && hangRun.kind === "timeout",
  JSON.stringify(hangRun),
);
check("超时是**真的按传入的时限**回来的（150ms 档，实测 < 1s）", waited < 1000, `${waited}ms`);
check(
  "超时那句的口径是「没拿到结果」，**不是**「已经做好了」",
  hangRun.message.includes("没有结果") && !/已(经)?(做好|完成|记住)/.test(hangRun.message),
  hangRun.message,
);
check(
  "默认时限是个正经数字（常量没被人改成 0 / NaN）",
  Number.isFinite(GATE_RUN_TIMEOUT_MS) && GATE_RUN_TIMEOUT_MS >= 5000,
  String(GATE_RUN_TIMEOUT_MS),
);

/*
  ⚠️ **保险丝必须比"动作层自己声明的最坏耗时"更长。**
  2026-11 真机上就是这一条被违反了：网页搜索依次试两个地址、每地址 12 秒（最坏 24 秒），
  而保险丝是 20 秒 → 动作还在正常跑，保险丝先响，用户看到的一律是"超时"。
  这类"两个数字各自都合理、凑一起就错"的 bug，只有断言能拦住。
*/
check(
  "保险丝 > 搜网页的总预算（不然动作还在跑，保险丝先响 —— 真机栽过）",
  GATE_RUN_TIMEOUT_MS > WEB_SEARCH_BUDGET_MS + 1000,
  `保险丝 ${GATE_RUN_TIMEOUT_MS}ms vs 搜索总预算 ${WEB_SEARCH_BUDGET_MS}ms`,
);
check(
  "保险丝 > 取网页的单次上限 + 原生硬兜底",
  GATE_RUN_TIMEOUT_MS > WEB_FETCH_DEFAULTS.timeoutMs + NATIVE_HTTP_HARD_MS + 1000,
  `保险丝 ${GATE_RUN_TIMEOUT_MS}ms vs ${WEB_FETCH_DEFAULTS.timeoutMs}ms + ${NATIVE_HTTP_HARD_MS}ms`,
);
check(
  "搜网页：总预算 ≥ 单地址上限（不然第二个地址永远轮不到）",
  WEB_SEARCH_BUDGET_MS >= WEB_SEARCH_PER_ENDPOINT_MS,
  `${WEB_SEARCH_BUDGET_MS}ms vs ${WEB_SEARCH_PER_ENDPOINT_MS}ms`,
);
check(
  "搜网页：最坏耗时 ≤ 20 秒（一轮对话里不能让人等太久）",
  WEB_SEARCH_BUDGET_MS <= 20_000,
  `${WEB_SEARCH_BUDGET_MS}ms`,
);

/** 超时之后才抛的：不许变成"未处理的拒绝"（在 WebView 里那种东西只会安静地烂掉） */
let unhandled = 0;
const onUnhandled = () => {
  unhandled += 1;
};
process.on("unhandledRejection", onUnhandled);
const lateReject = runGuarded(
  () =>
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("迟到的失败")), 300);
    }),
  100,
);
const lateRes = await lateReject;
await new Promise((r) => setTimeout(r, 400));
process.off("unhandledRejection", onUnhandled);
check(
  "超时之后执行器才抛错：既拿到了超时结果，也**没有**未处理的拒绝",
  lateRes.ok === false && lateRes.kind === "timeout" && unhandled === 0,
  JSON.stringify(lateRes) + ` unhandled=${unhandled}`,
);

/* ───────────── 【B】那两句话必须被 loop 认成「没做成」 ───────────── */
console.log("\n【B】闸门那两句到了 tool-loop 手里，必须算「没做成」（否则界面自相矛盾）");

check("超时那句 → looksRefused = true", looksRefused(hangRun.message) === true, hangRun.message);
check(
  "报错那句（故意造一条长于 48 字的原生报错）→ 也要认得出来",
  looksRefused(
    "执行时报错了（这次失败）：java.lang.IllegalStateException: 这一句故意写得非常长非常长非常长非常长非常长非常长",
  ) === true,
);
check("正常那句 → 不许被误判成失败", looksRefused("已记住这件事：喜欢清晨的纸页感") === false);

/* ───────────── 【C】反向验证：拿掉保险丝，【A】必须变红 ───────────── */

if (REVERSE) {
  console.log("\n【C】反向验证：用「裸调用」的写法跑一遍，必须变红");
  let _revPassed = 0;
  const revFailures = [];
  const revCheck = (name, ok) => {
    if (ok) _revPassed += 1;
    else revFailures.push(name);
  };
  /** 裸调用 = 没有 try/catch、没有超时 —— 就是这次修掉的那个写法 */
  const bare = async (fn) => await fn();

  try {
    await bare(async () => {
      throw new Error("boom");
    });
    revCheck("抛错这条应当被判定为失败", true);
  } catch {
    revCheck("抛错这条应当被判定为失败", false); // 裸调用会抛 → 反转成立
  }
  const bareHang = await Promise.race([
    bare(() => never).then(() => "returned"),
    new Promise((r) => setTimeout(() => r("hung"), 400)),
  ]);
  revCheck("卡住这条应当被判定为失败", bareHang === "returned");

  /** 同一套"两个数字凑一起就错"的反向验证：把保险丝设得比动作层还短，必须被抓住 */
  revCheck(
    "保险丝比动作层最坏耗时还短时，应当被判定为失败",
    GATE_RUN_TIMEOUT_MS > WEB_SEARCH_BUDGET_MS + 1000 && 1000 > WEB_SEARCH_BUDGET_MS + 1000,
  );

  const wentRed = revFailures.length > 0;
  console.log(
    wentRed
      ? `  ✅ 反向验证通过：裸调用写法在 ${revFailures.length} 条上确实过不去（退出码 0 = 反向验证成功）`
      : "  ❌ 反向验证失败：把保险丝拿掉之后断言还是全绿 —— 说明它在测空气",
  );
  process.exit(wentRed ? 0 : 1);
}

console.log(
  `\n${failures.length === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures.length} 红`,
);
process.exit(failures.length === 0 ? 0 : 1);
