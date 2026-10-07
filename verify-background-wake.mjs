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

/**
 * 把注释剥掉再看代码。
 *
 * ⚠️ 这是**必须的**，不是洁癖：这份仓库里到处是"解释为什么不要这么写"的中文注释，
 * 直接拿正则扫原文会把说明文字当成代码 —— 我已经因此误报过两次：
 *   ① 后台文件注释里写了"原来是 window.setInterval"，被判成"代码里用了 window"
 *   ② 说明里写了"不要调 dispatchEvent"，被判成"调了 dispatchEvent"
 * 所以：**判断"代码有没有干某事"，先剥注释。**
 */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 块注释
    .replace(/(^|[^:])\/\/.*$/gm, "$1 "); // 行注释（避开 http:// 那种）

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
const code = stripComments(runner);

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
check("用到了 CapacitorNotifications（要弹通知）", /CapacitorNotifications/.test(code));
check("用到了 CapacitorKV（要能跨唤醒记东西）", /CapacitorKV/.test(code));
check(
  "没有 fetch 之外的网络依赖 —— 这一版还不联网（联网是下一步）",
  !/fetch\s*\(/.test(code) || /以后|下一步/.test(runner),
);

/**
 * ⚠️ **后台里 API 用错是无声失败**（不报错、不弹通知、什么都没有），
 * 所以形状也对一遍 —— 这三条是照插件 README 的示例和它自己的 Kotlin 实现核过的：
 *   · `CapacitorKV.get(key)` 返回 `{ value: string }`（不是直接返回字符串！）
 *   · `CapacitorKV.set(key, value)` 两个参数
 *   · `CapacitorNotifications.schedule([...])` 收的是**数组**
 */
check(
  "KV 取值用的是 `.value`（插件返回的是 { value } 而不是字符串）",
  /CapacitorKV\.get\([^)]*\)[^;]*\.value/.test(code) || /\.value\s*\|\|/.test(code),
);
check("KV 写入是 set(key, value) 两个参数", /CapacitorKV\.set\(\s*"[^"]+"\s*,/.test(code));
check(
  "通知用的是 schedule([...])（数组！）",
  /CapacitorNotifications\.schedule\(\s*\[/.test(code),
);
/**
 * ⚠️ 这里必须是**真的解析那个常量**。第一版我写的是去匹配 `id: NOTIFY_ID_BASE ...`
 * 后面的数字，结果一个数字都抓不到、默认成 0 → 断言**假绿**（等于没考）。
 * 假绿比没有还糟：它会让人以为查过了。
 */
const notifyId = Number((code.match(/NOTIFY_ID_BASE\s*=\s*(\d+)/) ?? [])[1] ?? "NaN");
check(
  "通知 id 是正的、且在 32 位整数范围内（安卓限制）",
  Number.isFinite(notifyId) && notifyId > 0 && notifyId < 2_000_000_000,
  `base=${notifyId}`,
);

/**
 * ⚠️ **顺序**：先弹通知、再记账。
 * 这一版的通知是"我醒过"的唯一证据；反过来的话，万一记账出错，
 * 用户就什么都看不到，而我们连"它到底醒没醒"都不知道。
 */
const iNotify = code.indexOf("CapacitorNotifications.schedule");
const iKvSet = code.indexOf('CapacitorKV.set("wake_count"');
check(
  "先弹通知、后记账（记账出错也不能影响通知）",
  iNotify > -1 && iKvSet > -1 && iNotify < iKvSet,
  `通知@${iNotify} / 记账@${iKvSet}`,
);

/* ───────── ①-b 死锁规矩：App 侧永远不要调 dispatchEvent ───────── */

console.log("\n【一·b】死锁规矩：App 侧不许调 dispatchEvent");
/**
 * 这是**踩过的坑，不是理论**（用户真机反馈：点一下之后"一直写着正在叫他"、
 * **整个 App 卡住不动**、通知也没有）。
 *
 * 原因在插件安卓实现里：
 *   `BackgroundRunnerPlugin.dispatchEvent` → `runBlocking(Dispatchers.IO) { impl.execute(...) }`
 *   而插件方法跑在**主线程**上 → 主线程被挡住；`impl.execute` 里
 *   `future.conditionalAwait { it != null }` **无限期等** JS 回调，没有超时；
 *   而 JS 引擎要跑又得用主线程 → 主线程等 JS、JS 等主线程 → 死锁。
 *
 * 所以：**手动触发这条路整条封掉**。要验只能等系统到点叫它（15 分钟起）。
 */
const helperSrc = read(join(process.cwd(), "src", "lib", "background-wake.ts"));
check(
  "lib/background-wake.ts 里没有 dispatchEvent（剥掉注释后）",
  !/dispatchEvent/.test(stripComments(helperSrc)),
);
const meSections = read(join(process.cwd(), "src", "components", "me-sections.tsx"));
check(
  "界面里也没直接调 dispatchEvent（剥掉注释后）",
  !/dispatchEvent/.test(stripComments(meSections)),
);
check(
  "后台唤醒的注释里记了这条坑（免得下一个人又加回来）",
  /死锁|主线程/.test(helperSrc),
);

/* ───────── ② 配置与常量的对账 ───────── */

console.log("\n【二】capacitor.config.ts ↔ lib/background-wake.ts（对不上就点不动）");
const cap = read(join(process.cwd(), "capacitor.config.ts"));
const helper = read(join(process.cwd(), "src", "lib", "background-wake.ts"));

/**
 * ⚠️ **配置也要剥注释再解析** —— 这是同一个坑的第三次：
 * `capacitor.config.ts` 的大段注释里写了"验通之后改成 `repeat: true` + `interval: 15`"，
 * 直接扫原文就会把**注释里的示例**当成真配置（上面那版就误报成 repeat=true）。
 * 结论：凡是"从源码里读一个值"，先剥注释。
 */
const capCode = stripComments(cap);

const labelInCap = (capCode.match(/label:\s*"([^"]+)"/) ?? [])[1] ?? "";
const eventInCap = (capCode.match(/event:\s*"([^"]+)"/) ?? [])[1] ?? "";
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
check("src 指向那个后台文件", /src:\s*"runners\/wake\.js"/.test(capCode));
check("autoStart 打开（切后台那一刻才排得上队）", /autoStart:\s*true/.test(capCode));

/**
 * `interval` 的合法性**取决于 repeat**（这是安卓的规矩，不是我们的偏好）：
 *   · **周期**任务（`repeat: true`）→ WorkManager 硬性要求 **≥ 15 分钟**
 *     （写 1 分钟不会更勤，只会报错/被忽略）
 *   · **一次性**任务（`repeat: false`）→ 延迟没有这个下限，可以 1 分钟
 *     （当前就是这种：为了把验证时间从 15 分钟压到 1 分钟）
 */
const repeats = /repeat:\s*true/.test(capCode);
const interval = Number((capCode.match(/interval:\s*(\d+)/) ?? [])[1] ?? 0);
check(
  repeats ? "周期任务：interval ≥ 15（安卓硬限制）" : "一次性任务：interval ≥ 1（没有 15 分钟下限）",
  interval >= (repeats ? 15 : 1),
  `repeat=${repeats} interval=${interval}`,
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
