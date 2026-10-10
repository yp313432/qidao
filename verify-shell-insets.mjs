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
check(
  "② 网页外壳真的用了那个变量给状态栏让位",
  appShell.includes("app-inset-top") && shell.includes("initShell"),
);
check(
  "② 底部（输入框/导航）也用上了变量，且 env() 只当兜底",
  css.includes("var(--q-inset-bottom, env(safe-area-inset-bottom, 0px))") &&
    css.includes(".app-inset-top"),
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
