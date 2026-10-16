#!/usr/bin/env node
/**
 * 验收：**一次性任务（带 `at` 的定时任务）到点说完就该消失**。
 *
 * 用户 m01498 第 2 条："一次性任务做完自动删，别留着"。
 * 用户 m01494 的截图里就是那张卡：定时任务列表里挂着
 * 「一次性 · 2026/10/16 07:30:00 · **今天已经说过**」+ 开着/改时间/删除 三个按钮 ——
 * 说过一次的东西不该再占着列表。
 *
 * 同时钉一条护栏：**过期太久的不补发**。App 关着过了夜，第二天早上启动才轮到它，
 * 这时候把昨晚那句"该睡了"补出来，比不说更糟 —— 超过 `ONEOFF_STALE_MS`（12 小时）
 * 就只删、不开口。判断逻辑在 `src/lib/wake-schedule.ts`，
 * 用它的地方是 `src/components/task-daemon.tsx`。
 *
 * 跑法：node verify-oneoff-task.mjs
 */
import { register } from "node:module";

/** `wake-schedule.ts` 用的是 `@/…` 别名、还有没有后缀的相对 import（同 verify-history-images.mjs） */
const base = new URL("./src/", import.meta.url).href;
register(
  `data:text/javascript,${encodeURIComponent(
    [
      "export async function resolve(specifier, context, next) {",
      `  if (specifier.startsWith("@/")) return next(${JSON.stringify(base)} + specifier.slice(2) + ".ts", context);`,
      "  if (specifier.startsWith('.')) {",
      "    const seg = specifier.slice(specifier.lastIndexOf('/') + 1);",
      "    if (!/\\.[a-z]+$/i.test(seg)) {",
      "      return next(new URL(specifier + '.ts', context.parentURL).href, context);",
      "    }",
      "  }",
      "  return next(specifier, context);",
      "}",
    ].join("\n"),
  )}`,
  import.meta.url,
);

let passed = 0;
let failures = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}

/** ⚠️ 动态 import：钩子得先注册（静态 import 会在钩子生效前解析依赖） */
const { isStaleOneOff, ONEOFF_STALE_MS } = await import("./src/lib/wake-schedule.ts");

const HOUR = 60 * 60 * 1000;
const now = 1_700_000_000_000;

console.log("=== 一次性任务过期判定 ===");
check(
  `① 12 小时这个阈值就是 ${ONEOFF_STALE_MS / HOUR} 小时（改动它就得同时改这条断言）`,
  ONEOFF_STALE_MS === 12 * HOUR,
  `ONEOFF_STALE_MS=${ONEOFF_STALE_MS}`,
);
check(
  "② 刚过点 5 分钟 → **照常开口**（不算过期）",
  isStaleOneOff(now - 5 * 60 * 1000, now) === false,
);
check(
  "③ 过了 11 小时 59 分 → 仍然开口（差一分钟没过线）",
  isStaleOneOff(now - (12 * HOUR - 60 * 1000), now) === false,
);
check(
  "④ 过了 13 小时 → **过期，只删不补发**（昨晚那句不能第二天早上补出来）",
  isStaleOneOff(now - 13 * HOUR, now) === true,
);
check(
  "⑤ 没有 `at` 的日常任务（每天固定时间的）永远不算过期",
  isStaleOneOff(undefined, now) === false && isStaleOneOff(null, now) === false,
);
check("⑥ 还没到点（at 在未来）也绝不是过期", isStaleOneOff(now + 3 * HOUR, now) === false);

/** 反向：把"12 小时"改成"永远不过期"的旧行为，第 ④ 条必须变红 */
if (process.env.QIDAO_MUTATE_REVERSE === "1") {
  console.log("\n=== 反向用例（故意用错阈值，第 ④ 条应当变红）===");
  check("④' 阈值当 100 年 → 13 小时前那句会被当成没过期（错的行为）", isStaleOneOff(now - 13 * HOUR, now) === false);
}

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
process.exit(failures === 0 ? 0 : 1);
