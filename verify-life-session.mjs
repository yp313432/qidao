/**
 * 「一段生活」的一致性校验（2026-10-21 批1+2+4）。
 *
 * 为什么要有这个脚本：这套东西**横跨两个世界** ——
 *   ① `public/runners/wake.js`（后台独立 JS，不能 import TS）
 *   ② `src/lib/wake-sync.ts`（前台按同一份白名单执行）
 * 两边靠"手工抄同一份白名单"对齐，最怕改一边忘了另一边：
 * 忘了会表现为"他在后台想钓鱼，前台不认这个动作，于是什么都不发生"——
 * 静默失败，最难查。
 *
 * 另外批4 的"世界心跳"也很容易接错（文件写了但 AppShell 没挂）。
 *
 * 用法：`node verify-life-session.mjs`（纯 node，不起浏览器、不连外网）
 */

import { readFileSync } from "node:fs";

let green = 0;
let red = 0;
const pass = (msg) => {
  green += 1;
  console.log(`✅ ${msg}`);
};
const fail = (msg) => {
  red += 1;
  console.log(`❌ ${msg}`);
};
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

const wake = readFileSync("public/runners/wake.js", "utf8");
const sync = readFileSync("src/lib/wake-sync.ts", "utf8");
const clock = readFileSync("src/lib/world-clock.ts", "utf8");
const shell = readFileSync("src/components/app-shell.tsx", "utf8");

/* ── ① 后台那段 JS 里有"一帧多步"的结构 ── */
check(/var LIFE_MAX_STEPS = \d+;/.test(wake), "wake.js 定义了 LIFE_MAX_STEPS（一段最多几步）");
check(/var LIFE_STEPS_PER_FRAME = \d+;/.test(wake), "wake.js 定义了 LIFE_STEPS_PER_FRAME（一帧最多几步）");
check(/function runLifeFrame\(/.test(wake), "wake.js 有 runLifeFrame（跑一帧）");
check(/function lifeSettle\(/.test(wake), "wake.js 有 lifeSettle（收尾：交给前台 + 一条通知）");
check(/function receiptOf\(/.test(wake), "wake.js 有 receiptOf（动作 → 回执，这是回执回灌的原料）");
check(/function lifeNote\(/.test(wake), "wake.js 有 lifeNote（把已做的步骤贴回提示词）");

/* ── ② 自主活动真的走 loop（而不是又退回"一次一个动作"）── */
check(
  /if \(actionMode === "free" \|\| actionMode === "life"\) \{\s*\n\s*kvSet\("wake_stage", "asking"\);\s*\n\s*runLifeFrame\(\);/.test(
    wake,
  ),
  'wake.js 里 free/life 模式进了 runLifeFrame()',
);
check(/saveLife\(session\);[\s\S]{0,220}?logLine\("#" \+ count \+ " " \+ stamp \+ " 这一帧做了/.test(wake), "wake.js 跨帧续跑：一帧做完把进度存下来");
check(/kvSet\("wake_pending_kind", "actions"\)/.test(wake), "wake.js 交下来的是 actions 批次（不是单个 action）");

/* ── ③ 两边白名单必须一致（集合相等）── */
const allowBlock = /var allow = \{([\s\S]*?)\n  \};/.exec(wake);
const wakeKinds = new Set(
  [...(allowBlock?.[1] ?? "").matchAll(/"([a-z][a-z0-9]*\.[a-zA-Z0-9._]+)"\s*:\s*1/g)].map((m) => m[1]),
);
const whiteBlock = /const PENDING_ACTION_WHITELIST = new Set<string>\(\[([\s\S]*?)\]\);/.exec(sync);
const syncKinds = new Set([...(whiteBlock?.[1] ?? "").matchAll(/"([a-z][a-z0-9]*\.[a-zA-Z0-9._]+)"/g)].map((m) => m[1]));

check(wakeKinds.size > 0, `wake.js 白名单读得出来（${wakeKinds.size} 个）`);
check(syncKinds.size > 0, `wake-sync.ts 白名单读得出来（${syncKinds.size} 个）`);
const onlyWake = [...wakeKinds].filter((k) => !syncKinds.has(k));
const onlySync = [...syncKinds].filter((k) => !wakeKinds.has(k));
check(
  onlyWake.length === 0 && onlySync.length === 0,
  `两边白名单一致${onlyWake.length || onlySync.length ? `（后台多：${onlyWake.join(",") || "无"}；前台多：${onlySync.join(",") || "无"}）` : ""}`,
);
for (const k of ["garden.walk", "garden.fish.cast", "garden.fish.reel", "garden.flower.plant"]) {
  check(syncKinds.has(k) && wakeKinds.has(k), `花园动作 ${k} 两边都放行了`);
}

/* ── ④ 前台真的会执行 actions 批次 ── */
check(/if \(pendingKind === "actions"\)/.test(sync), "wake-sync.ts 有 actions 批次分支");
check(/pack\.actions/.test(sync) && /for \(const item of list\)/.test(sync), "wake-sync.ts 逐条执行动作");
check(/beginScheduledReply\(say\)/.test(sync), "wake-sync.ts 把这段的一句话插进会话");

/* ── ⑤ 批4：世界心跳写了、也挂了 ── */
check(/export function tickWorld\(/.test(clock), "world-clock.ts 导出 tickWorld()");
check(/pond\.phase === "waiting" && pond\.biteAt > 0 && now >= pond\.biteAt/.test(clock), "世界心跳会推进咬钩");
check(/after\.phase === "bite" && after\.at > 0 && now - after\.at > BITE_GRACE_MS/.test(clock), "咬钩没人收 → 鱼跑了（竿不永远支着）");
check(/import \{ WORLD_TICK_MS, tickWorld \} from "@\/lib\/world-clock"/.test(shell), "app-shell 引入了世界心跳");
check(/window\.setInterval\(beat, WORLD_TICK_MS\)/.test(shell), "app-shell 真的挂上了 20 秒心跳");

/* ── ⑥ 通知策略：一个时段一条（不是每步一条）── */
const notifyCount = (wake.match(/notify\(NOTIFY_ID_BASE/g) ?? []).length;
check(notifyCount >= 2 && /lifeSettle[\s\S]{0,2400}?notify\(/.test(wake), "一段生活只在收尾时弹一条通知");

console.log(`\n${red === 0 ? "✅ 全部通过" : "❌ 有失败"}：${green} 项通过 / ${red} 项失败`);
process.exit(red === 0 ? 0 : 1);
