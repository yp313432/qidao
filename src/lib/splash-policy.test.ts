import { SPLASH_GAP_MS, splashDue } from "./splash-policy.ts";

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

let pass = 0;
let fail = 0;

function check(name: string, got: boolean, want: boolean) {
  if (got === want) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} —— 期望 ${want}，实际 ${got}`);
  }
}

console.log("splash-policy: 什么时候该播开屏");
check("从没播过 → 播", splashDue(null, NOW, false), true);
check("1 小时差 1 毫秒 → 不播", splashDue(NOW - SPLASH_GAP_MS + 1, NOW, false), false);
check("正好 1 小时 → 播", splashDue(NOW - SPLASH_GAP_MS, NOW, false), true);
check("2 小时前 → 播", splashDue(NOW - 2 * HOUR, NOW, false), true);
check("刚刚播过 → 不播", splashDue(NOW - 60_000, NOW, false), false);
check("减少动态效果 → 一律不播", splashDue(null, NOW, true), false);
check("减少动态效果也不播（刚播过）", splashDue(NOW - 60_000, NOW, true), false);
check("时钟被往回拨（上次在未来）→ 照播一次别卡死", splashDue(NOW + HOUR, NOW, false), true);
check("时间戳是 NaN → 当作没播过", splashDue(Number.NaN, NOW, false), true);
check("间隔常量是 1 小时", SPLASH_GAP_MS === 1 * HOUR, true);

console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
