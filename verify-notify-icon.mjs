#!/usr/bin/env node
/**
 * 验收：**通知图标的口径**（纯 node，不起浏览器、不连外网、不占端口）。
 *
 * ── 现在这个口径是什么（2026-11 用户定的）────────────────────────
 *
 * 用户原话："小图标那个你就复原形了，就跟其他通知一样，右边不单独画就行了。"
 * 起因：荣耀/华为会把**自定义的小图标**单独画在通知右边，而别的 App（不自定义、
 * 走系统默认）右边什么都没有 —— 他要"跟其他通知一样"。
 *
 * 所以现在**两处发通知的地方都不许传 `smallIcon` / `largeIcon`**。
 *
 * ⚠️ 这条断言是"反向"的（别的脚本多是"必须有"，这里是"必须没有"）——
 * 因为**留着一个自定义图标，界面上就多一块不该有的东西**，而那种错不报错、不崩，
 * 只有盯着手机看才发现。名字写错也一样（会静默退回系统那个 ⓘ）。
 *
 * 同时保留两件事：
 *   · 仓库里那两张图（`ic_stat_qidao` / `ic_notif_large`）**仍然合法可用** ——
 *     留着备用，将来要重新启用时不用重新画（`scripts/make-notification-icon.py` 生成的）
 *   · 那个不存在的旧名字 `ic_stat_icon_config_sample` 一个都不许留
 *
 * 跑法：node verify-notify-icon.mjs
 * 反向验证（内存里改文本，不动磁盘）：
 *   QIDAO_MUTATE_REVERSE=1 node verify-notify-icon.mjs     # 必须变红，退出码 0 = 通过
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
const ROOT = process.cwd();
const RES = join(ROOT, "android", "app", "src", "main", "res");
const NOTIFY_TS = join(ROOT, "src", "lib", "notify.ts");
const WAKE_JS = join(ROOT, "public", "runners", "wake.js");

/** 备用资源名（现在没被引用，但必须还画得出来、名字对得上） */
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
    buf.length > 26 && buf.toString("latin1", 1, 4) === "PNG" && buf.readUInt32BE(16) > 0;
  if (!sigOk) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] };
}

/* ── ① 备用资源：还画得出来、尺寸/alpha 合法（留着以后要用） ── */
function checkResources() {
  const dirs = existsSync(RES) ? readdirSync(RES).filter((n) => /^drawable-/.test(n)) : [];
  const named = dirs.filter((n) => DENSITY[n.slice("drawable-".length)] !== undefined);
  check("找得到 drawable-<dpi> 目录", named.length > 0, named.join(" ") || "一个都没有");

  for (const dir of named) {
    const dpi = dir.slice("drawable-".length);
    const expect = Math.round(24 * DENSITY[dpi]);
    const file = join(RES, dir, `${SMALL_ICON}.png`);
    if (!existsSync(file)) {
      // 备用资源不要求每个 dpi 都有（当前没被引用）—— 只列出来
      continue;
    }
    const info = pngInfo(file);
    check(
      `备用小图标 ${dir}/${SMALL_ICON}.png 仍是 24dp 尺寸且带 alpha`,
      Boolean(info) && info.w === expect && info.h === expect && info.colorType === 6,
      info ? `${info.w}×${info.h} colorType=${info.colorType}` : "读不出 PNG 头",
    );
  }

  const large = join(RES, "drawable-xxhdpi", `${LARGE_ICON}.png`);
  if (existsSync(large)) {
    const li = pngInfo(large);
    check(
      `备用大图标 drawable-xxhdpi/${LARGE_ICON}.png 仍是正方形、够大`,
      Boolean(li) && li.w === li.h && li.w >= 96,
      li ? `${li.w}×${li.h}` : "读不出 PNG 头",
    );
  } else {
    check("备用大图标还在（要启用时才需要）", false, "文件不在了 —— 那就只能用脚本重画");
  }
}

/* ── ② notify.ts：每处 schedule 都不许传图标 ── */
function checkNotifyTs(src) {
  const scheduleCalls = src.split(/n\.api\.schedule\(\{/).length - 1;
  const smallCount = src.split("smallIcon:").length - 1;
  const largeCount = src.split("largeIcon:").length - 1;

  check("notify.ts 里能找到 schedule 调用", scheduleCalls > 0, `共 ${scheduleCalls} 处`);
  check(
    "每处 schedule 都**没有**传 smallIcon（不自定义 = 跟其他通知一样）",
    scheduleCalls > 0 && smallCount === 0,
    `smallIcon 出现 ${smallCount} 次`,
  );
  check(
    "每处 schedule 都**没有**传 largeIcon（右边不再多画一张）",
    scheduleCalls > 0 && largeCount === 0,
    `largeIcon 出现 ${largeCount} 次`,
  );

  /* 旧名字：它指向一个不存在的资源，出现在**代码里**就会静默退回系统 ⓘ。
     ⚠️ 但注释里的「原来写的是 …」**不算残留** —— 那正是阻止下一个人改回去的东西
     （同 `verify-ai-text-consistency.mjs` 的 `negatable` 口径）。所以跳过注释行再查。 */
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

/* ── ③ 后台那条通知（另一个插件，容易漏） ── */
function checkWakeJs(src) {
  /**
   * ⚠️ 先剔掉**注释行**：wake.js 里那句「要恢复自定义图标就在这里加 `smallIcon: …`」
   * 是**故意留的说明**（免得下一个人翻半天不知道怎么改回来），不该算残留
   * —— 同 `verify-ai-text-consistency.mjs` 的 `negatable` 口径。
   */
  const code = src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*"));
    })
    .join("\n");
  check("wake.js 的 notify() 也**没有**传 smallIcon（口径一致）", !/smallIcon\s*:/.test(code));
}

checkResources();
const notifySrc = existsSync(NOTIFY_TS) ? readFileSync(NOTIFY_TS, "utf8") : "";
const wakeSrc = existsSync(WAKE_JS) ? readFileSync(WAKE_JS, "utf8") : "";

if (REVERSE) {
  /* 反向验证：内存里造一条"又把自定义图标加回去了"，断言必须变红。
     只改内存字符串，**绝不写磁盘**。 */
  const broken = notifySrc.replace("            title,\n", '            title,\n            smallIcon: "ic_stat_qidao",\n');
  passed = 0;
  failures = 0;
  checkNotifyTs(broken);
  const wentRed = failures > 0;
  console.log("");
  console.log(
    wentRed
      ? `✅ 反向验证通过：把自定义图标加回去之后确实变红（${failures} 条 ❌，退出码 0 = 反向验证成功）`
      : "❌ 反向验证失败：加回自定义图标之后脚本还是全绿 —— 说明断言没在看真值",
  );
  process.exit(wentRed ? 0 : 1);
}

checkNotifyTs(notifySrc);
checkWakeJs(wakeSrc);

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
process.exit(failures === 0 ? 0 : 1);
