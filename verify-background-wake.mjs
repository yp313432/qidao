/**
 * 验收脚本：**后台唤醒的接线对不对**（纯 node，不用浏览器、不用真机）。
 *
 * 为什么需要它：这套东西的失败方式**特别安静** —— 配置写错一个字，
 * 后台任务就是个哑的（不报错、不弹通知、什么都不发生），而那要看真机等 15 分钟才知道。
 * 所以把所有"能在本地对账的东西"都用脚本钉住：
 *
 *   ① `public/runners/wake.js` 存在、语法对、**没有 import / require / DOM**
 *      （它跑在 webview 外面，一旦引用了这些就必崩）
 *   ② 它**必须**调用 `resolve()` 或 `reject()`（官方要求；否则系统当它卡死）
 *   ③ `capacitor.config.ts` 里的 `label` / `event` 跟 `src/lib/background-wake.ts`
 *      导出的常量**逐字一致** —— 这两处对不上，手动触发就石沉大海
 *   ④ `interval` 不小于 **15**（安卓硬限制，写小了系统也不会更勤）
 *   ⑤ 安卓工程里那两处接线：`app/build.gradle` 的 flatDir（AAR 靠它）
 *      和 `capacitor.build.gradle` 的插件依赖
 *
 * 跑法：`node verify-background-wake.mjs`
 * 退出码非 0 = 有一处接线断了。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/* ───────── ① 后台小文件本身 ───────── */

console.log("【一】后台小文件（public/runners/wake.js）");
const runnerPath = join(process.cwd(), "public", "runners", "wake.js");
const runner = read(runnerPath);
check("文件存在", runner.length > 0, runnerPath);

/**
 * ⚠️ 这些一出现就必崩：它跑在一个**没有 DOM、没有模块系统**的环境里。
 * 这条是这套东西最容易犯的错（照网页的习惯写 import / document 就完了）。
 *
 * ⚠️ 检查前**先把注释剥掉** —— 否则说明文字里写一句"原来是 window.setInterval"
 * 就会被误判成"代码里用了 window"（第一版真这么误报了一次）。
 */
const code = runner
  .replace(/\/\*[\s\S]*?\*\//g, " ") // 块注释
  .replace(/(^|[^:])\/\/.*$/gm, "$1 "); // 行注释（避开 http:// 那种）

const forbidden = [
  [/\bimport\s+/, "import"],
  [/\brequire\s*\(/, "require"],
  [/\bdocument\b/, "document"],
  [/\bwindow\b/, "window"],
  [/\blocalStorage\b/, "localStorage"],
  [/:\s*(string|number|boolean)\b/, "TypeScript 类型标注"],
];
for (const [re, label] of forbidden) {
  check(`代码里没有用到「${label}」（跑在网页外面，用不了）`, !re.test(code));
}

check("注册了事件监听（addEventListener）", /addEventListener\s*\(/.test(runner));
check(
  "调用了 resolve()（官方要求，否则系统当它卡死）",
  /resolve\s*\(/.test(runner),
);
check("有 reject() 兜底（出错也要收尾）", /reject\s*\(/.test(runner));
check("用到了 CapacitorNotifications（要弹通知）", /CapacitorNotifications/.test(runner));
check("用到了 CapacitorKV（要能跨唤醒记东西）", /CapacitorKV/.test(runner));
check(
  "没有 fetch 之外的网络依赖 —— 这一版还不联网（联网是下一步）",
  !/fetch\s*\(/.test(runner) || /以后|下一步/.test(runner),
);

/* ───────── ② 配置与常量的对账 ───────── */

console.log("\n【二】capacitor.config.ts ↔ lib/background-wake.ts（对不上就点不动）");
const cap = read(join(process.cwd(), "capacitor.config.ts"));
const helper = read(join(process.cwd(), "src", "lib", "background-wake.ts"));

const labelInCap = (cap.match(/label:\s*"([^"]+)"/) ?? [])[1] ?? "";
const eventInCap = (cap.match(/event:\s*"([^"]+)"/) ?? [])[1] ?? "";
const labelInHelper = (helper.match(/WAKE_LABEL\s*=\s*"([^"]+)"/) ?? [])[1] ?? "";
const eventInHelper = (helper.match(/WAKE_EVENT\s*=\s*"([^"]+)"/) ?? [])[1] ?? "";

check(
  "label 两处逐字一致",
  Boolean(labelInCap) && labelInCap === labelInHelper,
  `config=${labelInCap} / helper=${labelInHelper}`,
);
check(
  "event 两处逐字一致",
  Boolean(eventInCap) && eventInCap === eventInHelper,
  `config=${eventInCap} / helper=${eventInHelper}`,
);
check("src 指向那个后台文件", /src:\s*"runners\/wake\.js"/.test(cap));
check("autoStart 打开（装完就自动排上）", /autoStart:\s*true/.test(cap));
check("repeat 打开（要反复醒，不是只醒一次）", /repeat:\s*true/.test(cap));

const interval = Number((cap.match(/interval:\s*(\d+)/) ?? [])[1] ?? 0);
check(
  "interval ≥ 15（安卓硬限制，写小了也不会更勤）",
  interval >= 15,
  `interval=${interval}`,
);

/* ───────── ③ 安卓工程那两处接线 ───────── */

console.log("\n【三】安卓工程的接线");
const appGradle = read(join(process.cwd(), "android", "app", "build.gradle"));
check(
  "app/build.gradle 里有 flatDir 指向插件的 AAR（少了它 Gradle 找不到那个 js 引擎）",
  /background-runner\/android\/src\/main\/libs/.test(appGradle),
);
const builtGradle = read(join(process.cwd(), "android", "app", "capacitor.build.gradle"));
if (builtGradle) {
  check(
    "capacitor.build.gradle 里有 :capacitor-background-runner",
    /capacitor-background-runner/.test(builtGradle),
  );
} else {
  console.log("ℹ️  capacitor.build.gradle 还没生成（CI 上 `cap sync` 会生成）—— 这项跳过");
}
const settingsGradle = read(join(process.cwd(), "android", "settings.gradle"));
check(
  "settings.gradle 会 apply capacitor.settings.gradle（插件工程才进得来）",
  /apply from:\s*'capacitor\.settings\.gradle'/.test(settingsGradle),
);

/* ───────── ④ 产物里真的带上了 ───────── */

console.log("\n【四】产物里带上了吗");
if (existsSync(join(process.cwd(), "dist"))) {
  check(
    "dist/runners/wake.js 在（Vite 把 public 拷进产物）",
    existsSync(join(process.cwd(), "dist", "runners", "wake.js")),
  );
} else {
  console.log("ℹ️  还没构建过（没有 dist/）—— 这项跳过");
}
const assetRunner = join(
  process.cwd(),
  "android",
  "app",
  "src",
  "main",
  "assets",
  "public",
  "runners",
  "wake.js",
);
if (existsSync(join(process.cwd(), "android", "app", "src", "main", "assets"))) {
  check("安卓 assets 里也有（cap sync 拷进去的）", existsSync(assetRunner), assetRunner);
} else {
  console.log("ℹ️  安卓 assets 还没同步（CI 上会同步）—— 这项跳过");
}

console.log("-".repeat(64));
console.log(`后台唤醒接线验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
