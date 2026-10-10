#!/usr/bin/env node
/**
 * 验收：**通知图标真的接上了**（纯 node，不起浏览器、不连外网、不占端口）。
 *
 * 为什么要有这一条：图标这种东西的失败方式是**最阴的那一种** ——
 * 名字写错不报错、不崩、界面照常，只是显示成系统那个 ⓘ。
 * 上一版就是这么挂的：`notify.ts` 里写着 `ic_stat_icon_config_sample`
 * （插件 README 的示例名），仓库里根本没有这个资源，谁都没发现。
 *
 * 所以这里查的是**四件事**：
 *   【一】资源真的在、尺寸对：`res/drawable-<dpi>/ic_stat_qidao.png`
 *          尺寸必须是 24dp × 该 dpi 的倍数（mdpi 24 / hdpi 36 / xhdpi 48 / …），
 *          而且必须是 RGBA（带 alpha）—— 通知小图标靠 alpha 当遮罩。
 *          dpi 目录**从 res 里现读**，不写死清单（以后加一档不用改这里）。
 *   【二】大图标在（通知右边那张彩图）
 *   【三】代码里点名了：`notify.ts` 每一处 `schedule()` 都带上了 smallIcon + largeIcon，
 *          而且那个不存在的旧名字**一个都不剩**
 *   【四】后台那条（`public/runners/wake.js`）也带上了 —— 它走的是另一个插件
 *          （background-runner），漏了它就是"他主动说的那句话"没图标
 *
 * 反向验证（照 `verify-ai-text-consistency.mjs` 的做法，内存里改，不动磁盘文件）：
 *   QIDAO_MUTATE_REVERSE=1 node verify-notify-icon.mjs     # 必须变红，退出码 0 = 反向验证通过
 *
 * 跑法：node verify-notify-icon.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
const ROOT = process.cwd();
const RES = join(ROOT, "android", "app", "src", "main", "res");
const NOTIFY_TS = join(ROOT, "src", "lib", "notify.ts");
const WAKE_JS = join(ROOT, "public", "runners", "wake.js");

const SMALL_ICON = "ic_stat_qidao";
const LARGE_ICON = "ic_notif_large";
/** 24dp 基准 × dpi 倍率 —— 安卓的固定规格，不是会漂的业务数字 */
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

let passed = 0;
let failures = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}

/** 只读 PNG 头：宽、高、颜色类型（6 = RGBA）。够用，不用装解码库。 */
function pngInfo(path) {
  const buf = readFileSync(path);
  const sigOk =
    buf.length > 26 &&
    buf.toString("latin1", 1, 4) === "PNG" &&
    buf.readUInt32BE(16) > 0;
  if (!sigOk) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] };
}

function checkResources() {
  const dirs = existsSync(RES)
    ? readdirSync(RES).filter((n) => /^drawable-/.test(n))
    : [];
  const named = dirs.filter((n) => DENSITY[n.slice("drawable-".length)] !== undefined);
  check(
    "找得到 drawable-<dpi> 目录（小图标的落点）",
    named.length > 0,
    named.length ? named.join(" ") : "一个都没有",
  );

  for (const dir of named) {
    const dpi = dir.slice("drawable-".length);
    const expect = Math.round(24 * DENSITY[dpi]);
    const file = join(RES, dir, `${SMALL_ICON}.png`);
    if (!existsSync(file)) {
      check(`${dir}/${SMALL_ICON}.png 存在`, false, "缺这个 dpi");
      continue;
    }
    const info = pngInfo(file);
    check(
      `${dir}/${SMALL_ICON}.png 是 24dp 对应尺寸且带 alpha`,
      Boolean(info) && info.w === expect && info.h === expect && info.colorType === 6,
      info ? `${info.w}×${info.h} colorType=${info.colorType}（期望 ${expect}×${expect} colorType=6）` : "读不出 PNG 头",
    );
  }

  const large = join(RES, "drawable-xxhdpi", `${LARGE_ICON}.png`);
  const li = existsSync(large) ? pngInfo(large) : null;
  check(
    `大图标 drawable-xxhdpi/${LARGE_ICON}.png 存在且是正方形、够大`,
    Boolean(li) && li.w === li.h && li.w >= 96,
    li ? `${li.w}×${li.h}` : "没有这个文件",
  );
}

/** ③ notify.ts：每一处 schedule 都点了名，且旧名字一个不剩 */
function checkNotifyTs(src) {
  const scheduleCalls = src.split(/n\.api\.schedule\(\{/).length - 1;
  const smallCount = src.split("smallIcon: SMALL_ICON").length - 1;
  const largeCount = src.split("largeIcon: LARGE_ICON").length - 1;

  check("notify.ts 里能找到 schedule 调用", scheduleCalls > 0, `共 ${scheduleCalls} 处`);
  check(
    "每一处 schedule 都带 smallIcon（漏一处就是那条通知没图标）",
    scheduleCalls > 0 && smallCount === scheduleCalls,
    `smallIcon ${smallCount} / schedule ${scheduleCalls}`,
  );
  check(
    "每一处 schedule 都带 largeIcon（大图标 = App 图标）",
    scheduleCalls > 0 && largeCount === scheduleCalls,
    `largeIcon ${largeCount} / schedule ${scheduleCalls}`,
  );
  /* 旧名字：它指向一个不存在的资源，留在**代码里**就会静默退回系统图标。
     ⚠️ 但注释里的「原来写的是 `ic_stat_icon_config_sample`」**不算残留** ——
     那正是阻止下一个人改回去的东西（同 `verify-ai-text-consistency.mjs` 的
     `negatable` 口径：否定式提醒不算残留）。所以这里跳过注释行再查。 */
  const codeLines = src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*"));
    })
    .join("\n");
  check(
    "不存在的旧图标名 ic_stat_icon_config_sample 已从代码里清干净（注释里记历史不算）",
    !codeLines.includes("ic_stat_icon_config_sample"),
  );
}

/** ④ 后台那条通知（另一个插件，容易漏） */
function checkWakeJs(src) {
  check(
    `wake.js 的 notify() 带上了 smallIcon: "${SMALL_ICON}"`,
    new RegExp(`smallIcon\\s*:\\s*"${SMALL_ICON}"`).test(src),
  );
}

checkResources();
const notifySrc = existsSync(NOTIFY_TS) ? readFileSync(NOTIFY_TS, "utf8") : "";
const wakeSrc = existsSync(WAKE_JS) ? readFileSync(WAKE_JS, "utf8") : "";

if (REVERSE) {
  /* 反向验证：内存里把"某一处 schedule 忘了带 smallIcon"造出来，断言必须变红。
     只改内存字符串，**绝不写磁盘**。 */
  const broken = notifySrc.replace("smallIcon: SMALL_ICON,", "");
  passed = 0;
  failures = 0;
  checkNotifyTs(broken);
  const wentRed = failures > 0;
  console.log("");
  console.log(
    wentRed
      ? `✅ 反向验证通过：去掉一处 smallIcon 后确实变红（${failures} 条 ❌，退出码 0 = 反向验证成功）`
      : "❌ 反向验证失败：去掉一处 smallIcon 之后脚本还是全绿 —— 说明断言没在看真值",
  );
  process.exit(wentRed ? 0 : 1);
}

checkNotifyTs(notifySrc);
checkWakeJs(wakeSrc);

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
process.exit(failures === 0 ? 0 : 1);
