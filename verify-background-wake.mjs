/**
 * 验收脚本：**「他主动找你」的接线对不对**（纯 node，不用浏览器、不用真机）。
 *
 * 为什么需要它：这套东西的失败方式**特别安静** —— 配置写错一个字、后台那段 JS 少调一次
 * `resolve()`，结果就是"什么都不发生"（不报错、不弹通知），而那要等真机 15 分钟才知道。
 * 所以把所有能在本地对账的东西都钉住：
 *
 *   【一】后台那段 JS（`public/runners/wake.js`）
 *     · 跑在 webview 外面 → 不许有 import / require / DOM / TS 类型
 *     · 必须调 `resolve()` / `reject()`（插件那边是**没有超时**的无限等待）
 *     · 必须有地址占位符（CI 从 GitHub 密钥注入；仓库是公开的，真值不能进来）
 *     · 时间**必须是本地时间**（`toISOString()` 给的是 UTC，会差 8 小时）
 *     · 接口那几样要对上：`action === "speak"` / `data.text` / `urge` → 记 `last_ask_at`
 *     · 没配地址时要**退回调试通知**，而不是去请求一个假地址
 *     · 出错要有**冷却**，别每 15 分钟吵一次
 *   【二】配置与常量的对账（`capacitor.config.ts` ↔ 后台 JS ↔ `lib/wake-sync.ts`）
 *   【三】死锁规矩：**App 侧永远不许调 `dispatchEvent`**（真机踩过：整个 App 卡死）
 *   【四】安卓工程的接线（flatDir / 插件依赖 / settings）
 *   【五】产物里带上了吗
 *
 * 跑法：`node verify-background-wake.mjs`
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
 * ⚠️ 这是**必须的**，不是洁癖：这个仓库到处是"解释为什么不要这么写"的中文注释，
 * 直接拿正则扫原文会把说明文字当成代码 —— 同一个坑踩过四次：
 *   ① 注释里写"原来是 window.setInterval" → 判成"代码里用了 window"
 *   ② 注释里写"不要调 dispatchEvent" → 判成"调了 dispatchEvent"
 *   ③ 注释里写"验通后改成 repeat: true" → 判成"配置就是 repeat: true"
 *   ④ 注释里写"不许用 toISOString" → 判成"用了 toISOString"
 * 结论：**判断"代码有没有干某事"，先剥注释；判断"注释里有没有记着某事"，才用原文。**
 */
const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

/* ───────── 【一】后台那段 JS ───────── */

console.log("【一】后台那段 JS（public/runners/wake.js）");
const runnerPath = join(process.cwd(), "public", "runners", "wake.js");
const runner = read(runnerPath);
const code = strip(runner);
check("文件存在", runner.length > 0, runnerPath);

for (const [re, label] of [
  [/\bimport\s+/, "import"],
  [/\brequire\s*\(/, "require"],
  [/\bdocument\b/, "document"],
  [/\bwindow\b/, "window"],
  [/\blocalStorage\b/, "localStorage"],
  [/:\s*(string|number|boolean)\b/, "TypeScript 类型标注"],
]) {
  check(`代码里没有「${label}」（跑在网页外面，用不了）`, !re.test(code));
}

check("注册了事件监听（addEventListener）", /addEventListener\s*\(/.test(code));
check("调用了 resolve()（不回调它就永远挂着 —— 插件那边没有超时）", /resolve\s*\(/.test(code));
check("有 reject() 兜底", /reject\s*\(/.test(code));

check("留着地址占位符（CI 从 GitHub 密钥注入）", runner.includes("__QIDAO_WAKE_URL__"));
/**
 * ⚠️ **占位符必须只出现一次**（就在变量赋值那一行）。
 *
 * 为什么这条要卡死：CI 是**整串全替换**的。如果文件里还有第二处拿它做判断的代码，
 * 替换之后那句判断就变成"判断自己是不是包含自己"——恒为假 → 永远以为地址没配、
 * 永远不请求 Worker。**这种错不报错，只是安静地不工作。**
 * （真踩过：第一版就是 `WAKE_URL.indexOf("__…__") === -1` 那种写法。）
 * 现在运行时判断用 `/^https?:\/\//` 而不是字面占位符，所以这里可以要求"只有一处"。
 */
const placeholderCount = (runner.match(/__QIDAO_WAKE_URL__/g) ?? []).length;
check(
  "占位符只出现一次（第二处会被全替换成自比较，静默失效）",
  placeholderCount === 1,
  `出现 ${placeholderCount} 次`,
);
check("运行时判断用的是「像个网址吗」而不是字面占位符", /\^https\?:\\\/\\\//.test(runner));

check("去问 Worker（用了 fetch）", /fetch\s*\(/.test(code));
check("带上了 since（Worker 靠它算最短间隔）", /since=/.test(code));
check("认 `action === \"speak\"`", /action\s*===\s*"speak"/.test(code));
check("说的话取自 data.text", /data\.text/.test(code));
check("通知的标题用他的名字（像微信那样显示发件人）", /data\.aiName/.test(code));
check(
  "报的是「距他上次开口多久」（程度由它算出来）",
  /last_spoke_at/.test(code) && /since=/.test(code),
);
check(
  "说了才更新 last_spoke_at（没说就不动 → 程度继续往上爬）",
  /kvSet\("last_spoke_at", now\)/.test(code),
);
check("认「总开关关掉」的静音标记（muted_at）", /muted_at/.test(code));
check("静音期内不再发请求（省电）", /MUTED_RECHECK_MIN/.test(code));
check("通知的标题用他的名字（像微信那样显示发件人）", /data\.aiName/.test(code));
check(
  "没配地址时退回调试通知（绝不请求假地址）",
  /__QIDAO_WAKE_URL__/.test(code) && /第\s*"\s*\+\s*count\s*\+\s*"\s*次醒来/.test(code),
);
check("出错通知有冷却（别每 25 分钟吵一次）", /last_err_at/.test(code) && /COOLDOWN/.test(code));

check("没用 toISOString（它给的是 UTC，会差 8 小时）", !/toISOString/.test(code));
check("用的是本地时间（getFullYear / getHours）", /getFullYear\(\)/.test(code) && /getHours\(\)/.test(code));

/**
 * ⚠️ 后台里 API 用错是**无声失败**，所以形状也对一遍（照插件 README 与它自己的 Kotlin 实现核过）：
 *   · `CapacitorKV.get(key)` 返回 `{ value }`（不是字符串！）
 *   · `CapacitorNotifications.schedule([...])` 收的是**数组**
 */
check("KV 取值用的是 `.value`", /\.value/.test(code));
check("KV 写入是 set(key, value)", /CapacitorKV\.set\(/.test(code));
check("通知用的是 schedule([...])（数组）", /CapacitorNotifications\.schedule\(\s*\[/.test(code));
const notifyBase = Number((code.match(/NOTIFY_ID_BASE\s*=\s*(\d+)/) ?? [])[1] ?? "NaN");
check(
  "通知 id 是正的、在 32 位整数内",
  Number.isFinite(notifyBase) && notifyBase > 0 && notifyBase < 2_000_000_000,
  `base=${notifyBase}`,
);

/* ───────── 【二】配置与常量的对账 ───────── */

console.log("\n【二】capacitor.config.ts ↔ 后台 JS ↔ lib/wake-sync.ts");
const cap = read(join(process.cwd(), "capacitor.config.ts"));
const helper = read(join(process.cwd(), "src", "lib", "wake-sync.ts"));
const capCode = strip(cap);

check("src 指向那个后台文件", /src:\s*"runners\/wake\.js"/.test(capCode));
check("autoStart 打开（切后台那一刻才排得上队）", /autoStart:\s*true/.test(capCode));
check("event 与后台 JS 里注册的事件名一致", capCode.includes(`"${(runner.match(/addEventListener\("([^"]+)"/) ?? [])[1] ?? "\u0000"}"`));

/**
 * `interval` 的合法性**取决于 repeat**（安卓的规矩，不是我们的偏好）：
 *   · **周期**任务（`repeat: true`）→ WorkManager 硬性要求 **≥ 15 分钟**
 *   · **一次性**任务（`repeat: false`）→ 没有这个下限
 * 正式形态是 `repeat: true` + 15（叫醒 ≠ 打扰：醒来只问一句，闸门在 Worker 那边）。
 */
const repeats = /repeat:\s*true/.test(capCode);
const interval = Number((capCode.match(/interval:\s*(\d+)/) ?? [])[1] ?? 0);
check(
  repeats ? "周期任务：interval ≥ 15（安卓硬限制）" : "一次性任务：interval ≥ 1",
  interval >= (repeats ? 15 : 1),
  `repeat=${repeats} interval=${interval}`,
);
check(
  "App 侧读的是同一个地址（打包注入的 VITE_QIDAO_WAKE_URL）",
  /VITE_QIDAO_WAKE_URL/.test(helper),
);

/* ───────── 【二·b】甲那条路的关键手：抽屉名字两端必须一致 ───────── */

console.log("\n【二·b】「配置抽屉」两端必须对得上（写错一个字母就谁也见不到谁，还不报错）");
{
  const labelInConfig = (capCode.match(/label:\s*"([^"]+)"/) ?? [])[1] ?? "";
  const java = read(
    join(
      process.cwd(),
      "android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "yanping",
      "qidao",
      "WakeBridgePlugin.java",
    ),
  );
  const prefsInJava = (java.match(/PREFS\s*=\s*"([^"]+)"/) ?? [])[1] ?? "";
  check(
    "Java 抽屉名 == BackgroundRunner.label",
    Boolean(prefsInJava) && prefsInJava === labelInConfig,
    `java=${prefsInJava} / config=${labelInConfig}`,
  );

  const mainActivity = read(
    join(process.cwd(), "android", "app", "src", "main", "java", "com", "yanping", "qidao", "MainActivity.java"),
  );
  check("插件在 MainActivity 里注册了（不注册等于没写）", /registerPlugin\(WakeBridgePlugin\.class\)/.test(mainActivity));

  const bridgeJs = read(join(process.cwd(), "src", "lib", "wake-bridge.ts"));
  check("JS 侧插件名一致（WakeBridge）", /registerPlugin<WakeBridgeApi>\("WakeBridge"\)/.test(bridgeJs));
  check(
    "JS 侧用的键跟后台读的键一致（cfg_ 开头那批）",
    /cfg_base_url/.test(bridgeJs) && /cfg_base_url/.test(runner),
  );

  /** 档位间隔两端也要一致：App 生成五段、后台按 25 分钟一档挑 */
  const promptTs = read(join(process.cwd(), "src", "lib", "wake-prompt.ts"));
  check("App 生成的是五段指令（0/25/50/75/100）", /URGE_LEVELS\s*=\s*\[0,\s*25,\s*50,\s*75,\s*100\]/.test(promptTs));
  check("后台按 25 分钟一档挑（LADDER_STEP_MIN = 25）", /LADDER_STEP_MIN\s*=\s*25/.test(code));
  /**
   * ⚠️ 别断言"代码里有裸的 `{{TIME}}`" —— 它是写在正则里的（`/\{\{TIME\}\}/`），
   * 裸串根本不会出现。要断言的是"它在 replace 里处理了这两个占位符"。
   */
  check(
    "后台会替换两个时间占位符（TIME / ELAPSED）",
    /\.replace\([^)]*TIME/.test(code) && /\.replace\([^)]*ELAPSED/.test(code),
  );
}

/* ───────── 【三】死锁规矩 ───────── */

console.log("\n【三】死锁规矩：App 侧永远不许调 dispatchEvent");
/**
 * 这是**踩过的坑，不是理论**：用户真机反馈"一直写着正在叫他，然后整个 App 卡住不动"。
 * 原因在插件安卓实现里：
 *   `dispatchEvent` → `runBlocking(Dispatchers.IO) { impl.execute(...) }`
 *   而插件方法跑在**主线程** → 主线程被挡住；`impl.execute` 里
 *   `future.conditionalAwait { it != null }` **无限期等** JS 回调（没有超时）；
 *   而 JS 引擎要跑又得用主线程 → 主线程等 JS、JS 等主线程 = **死锁**。
 * 所以：要验通道就老老实实 fetch Worker（见 `lib/wake-sync.ts` 的 pingWake）。
 */
for (const rel of ["src/lib/background-wake.ts", "src/lib/wake-sync.ts", "src/lib/wake-bridge.ts", "src/components/wake-daemon.tsx"]) {
  const src = read(join(process.cwd(), rel));
  check(`${rel} 里没有 dispatchEvent（剥掉注释后）`, !/dispatchEvent/.test(strip(src)));
}
check(
  "「不许调 dispatchEvent」这条坑记在注释里了（免得下一个人又加回来）",
  /死锁|主线程/.test(helper) || /死锁|主线程/.test(read(join(process.cwd(), "src/lib/background-wake.ts"))),
);

/* ───────── 【四】安卓工程的接线 ───────── */

console.log("\n【四】安卓工程的接线");
const appGradle = read(join(process.cwd(), "android", "app", "build.gradle"));
check(
  "app/build.gradle 里有 flatDir 指向插件的 AAR（少了它 Gradle 找不到那个 js 引擎）",
  /background-runner\/android\/src\/main\/libs/.test(appGradle),
);
const builtGradle = read(join(process.cwd(), "android", "app", "capacitor.build.gradle"));
if (builtGradle) {
  check("capacitor.build.gradle 里有 :capacitor-background-runner", /capacitor-background-runner/.test(builtGradle));
} else {
  console.log("ℹ️  capacitor.build.gradle 还没生成（CI 上 `cap sync` 会生成）—— 跳过");
}
const settingsGradle = read(join(process.cwd(), "android", "settings.gradle"));
check(
  "settings.gradle 会 apply capacitor.settings.gradle（插件工程才进得来）",
  /apply from:\s*'capacitor\.settings\.gradle'/.test(settingsGradle),
);

/* ───────── 【五】产物 ───────── */

console.log("\n【五】产物里带上了吗");
if (existsSync(join(process.cwd(), "dist"))) {
  check("dist/runners/wake.js 在（Vite 把 public 拷进产物）", existsSync(join(process.cwd(), "dist", "runners", "wake.js")));
} else {
  console.log("ℹ️  还没构建过（没有 dist/）—— 跳过");
}
const assetRunner = join(process.cwd(), "android", "app", "src", "main", "assets", "public", "runners", "wake.js");
if (existsSync(join(process.cwd(), "android", "app", "src", "main", "assets"))) {
  check("安卓 assets 里也有（cap sync 拷进去的）", existsSync(assetRunner), assetRunner);
} else {
  console.log("ℹ️  安卓 assets 还没同步 —— 跳过");
}

/** CI 里那个注入步骤必须在（不然地址永远烘不进去） */
const ci = read(join(process.cwd(), ".github", "workflows", "android.yml"));
check("CI 里有注入步骤（从 QIDAO_WAKE_URL 密钥）", /QIDAO_WAKE_URL/.test(ci));
check("CI 里把注入的值也给了 App 侧（VITE_QIDAO_WAKE_URL）", /VITE_QIDAO_WAKE_URL/.test(ci));
check("没配密钥时**不会**让打包失败（只警告）", /没配 QIDAO_WAKE_URL/.test(ci) && !/exit 1[\s\S]{0,80}没配/.test(ci));
/** ⚠️ 必须是"整串全替换"（见上面那条注释：用 replace 只换第一处会静默失效） */
check(
  "CI 的注入是整串全替换（split…join 或 replaceAll，不是 replace）",
  /split\(MARK\)\.join\(url\)/.test(ci) || /replaceAll\(/.test(ci),
);

console.log("-".repeat(64));
console.log(`「他主动找你」接线验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
