#!/usr/bin/env node
/**
 * 验收：**背景铺到状态栏/导航栏（B 方案）**——三件事都在，且配对正确。
 *
 * 用户原话（2026-11）：
 *   "我想铺背景图的话，它能自然地延伸到导航栏和上面电量时间那块 —— 能不能把它铺满，
 *    而不是说想上花纹。"
 *   "万一我换一个浅色背景图呢，那深色不就暴露了吗？"
 *
 * ⚠️ 教训：第一次**只做了 ①** → 内容被顶进状态栏、顶栏被压住、界面看着短了一截。
 * 所以这里钉的是"**三件都在，且互相接得上**"：
 *   ① 原生：edge-to-edge（内容进系统栏区域）
 *   ② 原生 → 网页：安全区高度推成 CSS 变量（安卓 WebView 的 env() 是 0，不能只靠它）
 *   ③ 图标颜色：背景亮 → 深色图标（这条专门防"换浅色背景后图标看不见"）
 *
 * 跑法：node verify-shell-insets.mjs
 * 反向：QIDAO_MUTATE_REVERSE=1 node verify-shell-insets.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
const ROOT = process.cwd();
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** shell.ts 用的是 `@/…` 别名，node 里要注册 resolve 钩子（只在内存里） */
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

const main = src("android/app/src/main/java/com/yanping/qidao/MainActivity.java");
const plugin = src("android/app/src/main/java/com/yanping/qidao/ShellBridgePlugin.java");
const css = src("src/styles.css");
const shell = src("src/lib/shell.ts");
const appShell = src("src/components/app-shell.tsx");
const bgLayer = src("src/components/background-layer.tsx");
const composerSrc = src("src/components/chat/composer.tsx");

/* ── ① 原生：edge-to-edge ── */
check(
  "① 原生把内容放进系统栏区域（setDecorFitsSystemWindows(false)）",
  plugin.includes("WindowCompat.setDecorFitsSystemWindows(window, false)"),
);
check(
  "① 系统栏都设成透明（不然背景透不上来）",
  plugin.includes("setStatusBarColor(Color.TRANSPARENT)") &&
    plugin.includes("setNavigationBarColor(Color.TRANSPARENT)"),
);
check("① 插件在 MainActivity 注册了", main.includes("registerPlugin(ShellBridgePlugin.class)"));

/* ── ② 安全区交给网页 ── */
check(
  "② 原生把安全区推成 CSS 变量（--q-inset-top / --q-inset-bottom）",
  plugin.includes("--q-inset-top") && plugin.includes("--q-inset-bottom"),
);
check(
  "② 网页也能**主动问一次**（万一 load 时推得太早）",
  plugin.includes("public void getInsets") && shell.includes("getInsets"),
);
/**
 * ⚠️ 这两条 2026-10 对齐过：以前钉的是 `.app-inset-top`（外壳统一加内边距）。
 * 推⑪/⑫ 之后口径变了 —— **外壳不再加内边距**（否则页面自己的背景会被挤下去、
 * 插件页/五子棋会露一条底），改成"**每一页自己的顶栏**吃 `--q-inset-top`"
 * （就是 `.inset-top-25/50/60/75/100/175` 那一组）。
 * 老期望留在脚本里 = 天天报假红，所以按代码现在的样子改。
 */
check(
  "② 网页外壳真的用了那个变量给状态栏让位（initShell + 各页顶栏 `.inset-top-*` 一组）",
  appShell.includes("initShell") && css.includes("var(--q-inset-top") && css.includes(".inset-top-50"),
);
check(
  "② 底部（输入框/导航）也用上了变量，且 env() 只当兜底",
  css.includes("var(--q-inset-bottom, env(safe-area-inset-bottom, 0px))"),
);
check(
  "② 外壳挂载时真的调了 initShell（不是写了不用）",
  appShell.includes("void initShell()"),
);

/* ── ③ 图标颜色跟着背景明暗 ── */
check(
  "③ 原生有图标颜色接口（setBarIcons → setAppearanceLightStatusBars）",
  plugin.includes("public void setBarIcons") && plugin.includes("setAppearanceLightStatusBars"),
);
check(
  "③ 网页在背景变化时重算（background-layer 里调 syncBarIcons）",
  bgLayer.includes("syncBarIcons"),
);
const { luminance, parseColor } = await import("./src/lib/shell.ts");
check(
  "③ 亮度用的是**相对亮度**（0.2126R+0.7152G+0.0722B），不是 (r+g+b)/3",
  Math.abs(luminance(0, 255, 0) - 0.7152) < 0.02,
);
check(
  "③ 纯绿要判成「亮」（→ 深色图标）—— 朴素平均法会判反，这条专抓它",
  luminance(0, 255, 0) > 0.5,
);
check(
  "③ 白背景 → 亮（深图标）；黑背景 → 暗（浅图标）",
  luminance(255, 255, 255) > 0.9 && luminance(10, 10, 12) < 0.1,
);
check(
  "③ 颜色解析：rgb() 和 #hex 都认",
  (parseColor("rgb(255, 255, 255)")?.r ?? 0) === 255 &&
    (parseColor("#000000")?.r ?? 1) === 0 &&
    parseColor("不是颜色") === null,
);

/* ── ④ 键盘让位（2026-10 真机："键盘打字时对话框被盖住，看不到打的字"）──
 *
 * 根因（已核实）：原生开了 edge-to-edge（`setDecorFitsSystemWindows(window,false)`），
 * 安卓 11+ 起 **`adjustResize` 就不再顶小窗口了**；而原生只推了**系统栏**高度、
 * 从来没推过键盘 —— 页面完全不知道键盘弹了，输入框就被盖在键盘后面。
 * 修法：网页端用 `visualViewport` 自己算（见 `src/lib/keyboard.ts`）。
 */
const keyboardSrc = src("src/lib/keyboard.ts");
const { imeInsetOf } = await import("./src/lib/keyboard.ts");
check(
  "④ 键盘高度 = 布局视口 − 可视视口（键盘弹起时 innerHeight 不变、visualViewport 变小）",
  imeInsetOf({ innerHeight: 844, vvHeight: 544, vvTop: 0 }) === 300,
);
check(
  "④ 系统自己把窗口缩了（老安卓 adjustResize 生效）→ 算出 0，**不重复让位**",
  imeInsetOf({ innerHeight: 544, vvHeight: 544, vvTop: 0 }) === 0,
);
check(
  "④ iOS 上页面被顶起来那一段（offsetTop）要减掉",
  imeInsetOf({ innerHeight: 844, vvHeight: 544, vvTop: 120 }) === 180,
);
check(
  "④ 负数 / NaN 一律归 0（宁可不让位，也不许把输入框顶出屏幕）",
  imeInsetOf({ innerHeight: 500, vvHeight: 600, vvTop: 0 }) === 0 &&
    imeInsetOf({ innerHeight: Number.NaN, vvHeight: 100, vvTop: 0 }) === 0,
);
check("④ 小于门槛（80px）的抖动不算键盘（地址栏/手势条会抖几像素）", /IME_MIN_PX\s*=\s*80/.test(keyboardSrc));
check(
  "④ 网页那份兜底只写 `--q-ime-bottom-web`（不跟原生那个变量抢）",
  keyboardSrc.includes("--q-ime-bottom-web") && !keyboardSrc.includes("setProperty('--q-ime-bottom',"),
);
check("④ 外壳挂载时真的挂上了监听、卸载时拆掉", appShell.includes("return installKeyboardInset()"));
check(
  "④ **对话框**自己让位（外壳下内边距 = max(原生, 网页)）",
  appShell.includes('paddingBottom: "max(var(--q-ime-bottom-native, 0px), var(--q-ime-bottom-web, 0px))"'),
);
/**
 * ⚠️ 用户第二次纠正（2026-10）：**导航栏打字时不抬**，只让对话框起 ——
 *   "导航栏不弹起，对话框弹起来就行了……他和导航栏做切割，不放在一起。"
 * 上一版让它跟着抬，用户装上去说"填 API 的时候导航也跟着起来，很怪"。
 */
check(
  "④ 底部导航打字时**不抬**（只让对话框起 —— 用户口径）",
  appShell.includes("pointer-events-none fixed inset-x-0 bottom-0 z-[60]") &&
    !/bottom:\s*"max\(var\(--q-ime-bottom/.test(appShell),
);
check(
  "④ 打字时输入框不再给导航留那 4.5rem（CSS 里那条 data-keyboard 规则）",
  css.includes('html[data-keyboard="up"] .pb-composer'),
);
check(
  "④ 键盘弹没弹会写成 `<html data-keyboard>`（原生推的值 + 网页兜底两路都看）",
  keyboardSrc.includes("root.dataset.keyboard") && keyboardSrc.includes("nativeIme"),
);
check(
  "④ 对话框用**现成玻璃** `.glass-menu`（不自己造底色 —— 上一版浅底浅字看不见）",
  composerSrc.includes('className="glass-menu') && !/className="[^"]*composer-panel/.test(composerSrc),
);
/**
 * ⚠️ **键盘高度必须原生读**（2026-10 第二次修）：
 * 第一版用网页 `visualViewport` 自己算 —— 真机上没生效，因为 edge-to-edge 之后
 * 可视视口根本不跟着变小（安卓官方口径：IME 内衬得 App 自己处理）。
 * 这几条盯的就是"原生真的在读 IME 内衬，而且只写自己那个变量"。
 */
check(
  "④ 原生读键盘内衬（WindowInsetsCompat.Type.ime + isVisible）",
  plugin.includes("WindowInsetsCompat.Type.ime()") && plugin.includes("isVisible(WindowInsetsCompat.Type.ime())"),
);
check("④ 原生把键盘高度写成 `--q-ime-bottom-native`", plugin.includes("--q-ime-bottom-native"));
check("④ 网页启动时问一次也带键盘（getInsets 里的 ime）", plugin.includes('out.put("ime"') && shell.includes("r?.ime"));
check(
  "④ 网页开局就把原生那个变量写上（含 0 —— 旧值不许留着）",
  shell.includes("--q-ime-bottom-native"),
);

/* ── ⑤ 插件页顶部那条安全区缝（2026-10："时感那块直接顶到最上面了"）── */
const pluginFrame = src("src/components/play/plugin-frame.tsx");
check(
  "⑤ 插件页也吃 `--q-inset-top`（跟全 App 其它页面同一个口径）",
  pluginFrame.includes("--q-inset-top") && pluginFrame.includes("paddingTop: topInset"),
);
check(
  "⑤ 缝的颜色取插件自己的背景色（背景仍然铺到最上面）",
  pluginFrame.includes("frameBg") && pluginFrame.includes("backgroundColor"),
);

if (REVERSE) {
  /** 反向：换成"朴素平均亮度"—— 纯绿那条必须变红（说明断言真的在挑算法） */
  const naive = (r, g, b) => (r + g + b) / 3 / 255;
  passed = 0;
  failures = 0;
  check(
    "反向：朴素平均法把纯绿判成「暗」（= 会选错图标），所以上面那条断言是有意义的",
    naive(0, 255, 0) < 0.5,
  );
  const ok = failures === 0;
  console.log("");
  console.log(ok ? "✅ 反向验证通过（退出码 0 = 反向成功）" : "❌ 反向验证失败");
  process.exit(ok ? 0 : 1);
}

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
console.log("（Java 本地编不了 —— 这几条只能证明「三件都写着且接得上」，真机效果仍要装机看）");
process.exit(failures === 0 ? 0 : 1);
