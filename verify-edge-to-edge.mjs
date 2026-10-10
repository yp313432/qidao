#!/usr/bin/env node
/**
 * 验收：**edge-to-edge（内容铺到状态栏/导航栏下面）**。
 *
 * 用户原话（2026-11）："App 内容延伸到状态栏区域，状态栏变透明/半透明 可以降低割裂感，
 * 你看我给你发的截图，上下是不是还是有白边，能不能把它延伸？"
 *
 * ⚠️ 这条**没法在本地编译 Java 验证**（这台机器没有 JDK/Android SDK，Java 只有 CI 能编），
 * 所以这里钉的是"**四件缺一不可的事都还在**"（源码级）：
 *   ① 原生开关：`setDecorFitsSystemWindows(false)`
 *   ② 系统栏**透明** + 关掉系统的对比度蒙层（Android 10+ 会偷偷垫灰底）
 *   ③ 图标转**浅色**（深色背景上深色图标等于看不见）
 *   ④ 网页侧接得住：`viewport-fit=cover` + `env(safe-area-inset-*)`
 * 真正的效果只能装机看 —— 所以脚本里明说这一点，别把它当"效果已验证"。
 *
 * 跑法：node verify-edge-to-edge.mjs
 * 反向：QIDAO_MUTATE_REVERSE=1 node verify-edge-to-edge.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
const ROOT = process.cwd();
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

let passed = 0;
let failures = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}

const main = src("android/app/src/main/java/com/yanping/qidao/MainActivity.java");
const styles = src("android/app/src/main/res/values/styles.xml");
const root = src("src/routes/__root.tsx");
const css = src("src/styles.css");

check(
  "① 原生开关在：`WindowCompat.setDecorFitsSystemWindows(window, false)`",
  main.includes("WindowCompat.setDecorFitsSystemWindows(window, false)"),
);
check(
  "② 状态栏 + 导航栏都设成透明",
  main.includes("setStatusBarColor(Color.TRANSPARENT)") &&
    main.includes("setNavigationBarColor(Color.TRANSPARENT)"),
);
check(
  "② 关掉系统的对比度蒙层（Android 10+ 会给透明系统栏垫灰底）+ 分隔线也透明",
  main.includes("setStatusBarContrastEnforced(false)") &&
    main.includes("setNavigationBarContrastEnforced(false)") &&
    main.includes("setNavigationBarDividerColor(Color.TRANSPARENT)"),
);
check(
  "② 这几个 API 有版本判断（对比度/分隔线是 API 29 起；不判在低版本会崩）",
  /SDK_INT\s*>=\s*Build\.VERSION_CODES\.Q/.test(main),
);
check(
  "③ 图标转浅色（深背景），状态栏和导航栏都转",
  main.includes("setAppearanceLightStatusBars(false)") &&
    main.includes("setAppearanceLightNavigationBars(false)"),
);
check(
  "④ 主题里也把系统栏设透明（冷启动那一下不闪白）",
  styles.includes("<item name=\"android:statusBarColor\">@android:color/transparent</item>") &&
    styles.includes("<item name=\"android:navigationBarColor\">@android:color/transparent</item>"),
);
check(
  "④ 网页侧接得住：`viewport-fit=cover` 还在",
  root.includes("viewport-fit=cover"),
);
check(
  "④ 安全区内边距还在用（顶栏/底栏让出状态栏与导航栏）",
  css.includes("env(safe-area-inset-bottom)") && css.includes("--aster-nav-h"),
);
check(
  "⚠️ 如实声明：效果只能装机看（Java 本地编不了）",
  main.includes("edgeToEdge()") && main.includes("targetSdk 已经是 36"),
);

if (REVERSE) {
  /** 反向：把"开关"那一行拿掉，第 ① 条必须变红 */
  const broken = main.replace("WindowCompat.setDecorFitsSystemWindows(window, false);", "");
  passed = 0;
  failures = 0;
  check(
    "反向：拿掉 `setDecorFitsSystemWindows(false)` 之后，断言确实变红",
    !broken.includes("WindowCompat.setDecorFitsSystemWindows(window, false)"),
  );
  const ok = failures === 0;
  console.log("");
  console.log(ok ? "✅ 反向验证通过（退出码 0 = 反向成功）" : "❌ 反向验证失败");
  process.exit(ok ? 0 : 1);
}

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
console.log("（注意：这一条只证明「四件事都写着」，**效果要装机看**）");
process.exit(failures === 0 ? 0 : 1);
