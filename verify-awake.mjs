/**
 * 「前台醒着」的验收脚本（纯 node，不跑浏览器）。
 *
 * 为什么要这一份：这个功能**只在真机上才看得出问题**（定时器、打盹、花钱频率），
 * 而它最容易出的错不是崩溃，是"看起来在跑、其实每 4 分钟烧一次钱"或者
 * "他说话了但没走那条消息路径、界面上出现一条来路不明的气泡"。
 * 所以这里盯三件事：
 *
 *   ① 省电省钱的两道闸门（打盹 / 有料才问 / 同一条料 30 分钟内不重复）
 *   ② 说话没有另造一条写入路径（必须 beginScheduledReply + finalizeAssistant）
 *   ③ 动作白名单没有放"会打扰用户"的东西（navigate / 提醒 / 删除）
 *
 * 跑：node verify-awake.mjs
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
let pass = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) {
    pass += 1;
    console.log(`✓ ${name}${extra ? `  ${extra}` : ""}`);
  } else {
    fails.push(name);
    console.log(`✗ ${name}${extra ? `  ${extra}` : ""}`);
  }
}

const awake = read("./src/lib/awake.ts");
const shell = read("./src/components/app-shell.tsx");

/* ── ① 常量与闸门 ───────────────────────────────────────────── */
ok("打盹阈值是 2 分钟", /export const AWAKE_IDLE_MS = 2 \* 60 \* 1000/.test(awake));
ok("心跳间隔是 4 分钟", /export const AWAKE_BEAT_MS = 4 \* 60 \* 1000/.test(awake));
ok("检查节拍 30 秒", /export const AWAKE_TICK_MS = 30 \* 1000/.test(awake));
ok("每天最多 8 条", /export const AWAKE_DAILY_MAX = 8/.test(awake));
ok("两次说话至少隔 12 分钟", /export const AWAKE_MIN_GAP_MS = 12 \* 60 \* 1000/.test(awake));
ok(
  "「有料才问」：没料直接返回，不进请求",
  /const found = clues\(now\);\s*\n\s*if \(found\.length === 0\) return "quiet";/.test(awake),
);
ok("同一条料 30 分钟内不重复", /const CLUE_COOLDOWN_MS = 30 \* 60 \* 1000/.test(awake));
ok("料会被节流过滤", /clueSeenAt\.get\(c\.kind\)/.test(awake));

/* ── ② 说话走既有路径，不另造一套 ───────────────────────────── */
ok("说话用 beginScheduledReply", awake.includes("beginScheduledReply(text)"));
ok("说话用 finalizeAssistant", awake.includes("finalizeAssistant(started.conversationId"));
ok("没有直接往 store 里塞消息", !/setState\(.*messages/.test(awake));

/* ── ③ 动作白名单：只放不打扰人的 ───────────────────────────── */
const kinds = awake.match(/const AWAKE_KINDS = \[([\s\S]*?)\] as const;/);
ok("AWAKE_KINDS 存在", Boolean(kinds));
if (kinds) {
  const list = [...kinds[1].matchAll(/"([a-z.]+)"/g)].map((m) => m[1]);
  ok("白名单里有钓鱼", list.includes("garden.fish.cast") && list.includes("garden.fish.reel"));
  ok("白名单里有走动 / 花圃", list.includes("garden.walk") && list.includes("garden.flower.water"));
  ok("白名单里有日记 / 动态", list.includes("diary.add") && list.includes("moment.post"));
  ok("白名单里**没有** navigate（不许把用户的页面切走）", !list.some((k) => k.startsWith("ui.")));
  ok("白名单里**没有**提醒/闹钟", !list.some((k) => k.includes("reminder") || k.includes("alarm")));
  ok("白名单里**没有**删除类", !list.some((k) => k.includes("remove") || k.includes("delete")));
  ok("白名单里**没有** chat.*（说话只能走正文）", !list.some((k) => k.startsWith("chat.")));
}

/* ── ④ 顺序：先做动作，再决定说不说 ────────────────────────── */
const beatBody = awake.slice(awake.indexOf("export async function awakeBeat"));
ok(
  "先 runActions 再 beginScheduledReply",
  beatBody.indexOf("await runActions(calls)") > 0 &&
    beatBody.indexOf("await runActions(calls)") < beatBody.indexOf("beginScheduledReply"),
);
ok("动作执行失败被吞掉（不影响下一拍）", /catch \{\s*\n\s*\/\* 动作执行失败/.test(beatBody));

/* ── ⑤ 接线：App 启动时真的开始，并且挂了全局用户动作打点 ──── */
ok("app-shell 引了 startAwakeLoop", /import \{ startAwakeLoop \} from "@\/lib\/awake"/.test(shell));
ok("app-shell 调了 startAwakeLoop", /const stopAwake = startAwakeLoop\(\)/.test(shell));
ok("卸载时清理", /stopAwake\(\);/.test(shell));
ok("全局 pointerdown 打点", awake.includes('window.addEventListener("pointerdown", mark'));
ok("全局 keydown 打点", awake.includes('window.addEventListener("keydown", mark'));
ok("滚动也打点", awake.includes('window.addEventListener("scroll", mark, true)'));
ok("清理时移除监听", awake.includes('window.removeEventListener("pointerdown", mark)'));

/* ── ⑥ 醒着的前提：可见 + 最近有动作 ───────────────────────── */
ok("页面隐藏时不算醒着", /visibilityState === "hidden"\) return false/.test(awake));
ok("最近没动作时不算醒着", /now - lastUserActAt <= AWAKE_IDLE_MS/.test(awake));

console.log(`\n${fails.length === 0 ? "✅ 全部通过" : "❌ 有失败"}：${pass} 项通过 / ${fails.length} 项失败`);
if (fails.length > 0) {
  console.log(`失败项：${fails.join("、")}`);
  process.exit(1);
}
