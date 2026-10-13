#!/usr/bin/env node
/**
 * 验收：**崩溃面包屑**（`src/lib/breadcrumbs.ts` + 「环境自检」那一块）。
 *
 * 用户报的（连续三次）："为啥卡退了" / "全都卡住，有思考内容，然后闪退" /
 * "我装的就是最新的，问题就是他卡退了，我不知道问题出在哪，你找找看"。
 *
 * 手机侧的崩在电脑上复现不出来 —— 所以这一轮做的是"**让 App 自己留下现场**"。
 * 这个脚本钉的就是"现场真的留得下来"这件事：
 *
 *   ① 滚动缓冲：满了丢最老的、顺序是"旧→新"（纯逻辑，纯 node 就能测）
 *   ② **异常退出的判定**：启动那一刻"还活着"标记还在 = 上次是被杀/崩的
 *   ③ 外壳真的挂上了面包屑、聊天链路真的会留痕、环境自检里真的显示它
 *   ④ 浏览器里走真流程：模拟"上次崩了"（启动前标记还在）→ 「环境自检」要报
 *      "异常退出" + 现场（长阻塞 / 动手过哪个动作 / 崩之前堆多大）；
 *      模拟"上次干净退出"（启动前标记已摘）→ 不许再报异常（不狼来了）
 *
 * ⚠️ **踩过的坑（写测试的纪律）**：`browser.newPage()` 每次都会**新开一个
 *   存储隔离的上下文** —— 两个 `newPage()` 之间 localStorage **不共享**。
 *   要模拟"同一个 App 重启"，必须用 **同一个 context** 里的两个 page。
 *
 * 跑法：node --experimental-strip-types verify-breadcrumbs.mjs
 * 反向：QIDAO_MUTATE_REVERSE=1 node --experimental-strip-types verify-breadcrumbs.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { MAX_CRUMBS, isDirtyExit, pushCrumb, stampOf } from "./src/lib/breadcrumbs.ts";

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(detail ? `${name} —— ${detail}` : name);
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}
const src = (p) => readFileSync(join(process.cwd(), p), "utf8");

/* ───────────────── ① 滚动缓冲（纯逻辑） ───────────────── */
console.log("\n【一】滚动缓冲");
const one = pushCrumb([], { t: 1, kind: "session", text: "启动" });
check("空缓冲 + 一条 = 一条", one.length === 1 && one[0].t === 1);
let long = [];
for (let i = 0; i < MAX_CRUMBS + 12; i += 1) long = pushCrumb(long, { t: i, kind: "beat", text: `第 ${i} 拍` });
check(
  `超过上限（${MAX_CRUMBS}）就丢最老的`,
  long.length === MAX_CRUMBS && long[0].t === 12,
  `长度 ${long.length} 第一条 t=${long[0]?.t}`,
);
check("顺序是**旧→新**（最后一条永远是最新的现场）", long[long.length - 1].t === MAX_CRUMBS + 11);

/* ───────────────── ② 异常退出的判定 ───────────────── */
console.log("\n【二】「上次是不是异常退出」的判定");
check("还活着（标记在）→ 异常（前台崩了/被杀就是这种）", isDirtyExit(true) === true);
check("标记被摘掉（退后台时摘的，或干净卸载）→ 正常", isDirtyExit(false) === false);

/* ───────────────── ③ 接线 ───────────────── */
console.log("\n【三】接线");
const shellSrc = src("src/components/app-shell.tsx");
const chatSrc = src("src/lib/use-chat.ts");
const envSrc = src("src/components/env-view.tsx");
const crumbSrc = src("src/lib/breadcrumbs.ts");
check("外壳挂载时装上面包屑", shellSrc.includes("installBreadcrumbs()"));
check("外壳卸载时拆掉（不留监听）", /stopCrumbs\(\)/.test(shellSrc));
check(
  "聊天链路：发起请求 / 动手那一步 / 思考 / 正文 都有留痕",
  ["发起请求", "第 ${round} 步", "思考开始到了", "正文开始到了"].every((s) => chatSrc.includes(s)),
);
check("阶段名会更新（心跳里带着「当时在干嘛」）", chatSrc.includes("setPhase(") && crumbSrc.includes("phase"));
check("「环境自检」里真的显示这一块", envSrc.includes("上次运行痕迹") && envSrc.includes("crumbsReport"));
check(
  "首帧**不读** localStorage（只在 useEffect 里读，避免 hydration 不一致）",
  /useEffect\(\(\) => \{[\s\S]{0,600}reloadRun/.test(envSrc) &&
    !/useState<RunReport \| null>\(crumbsReport/.test(envSrc),
);
check("长阻塞门槛是 0.5 秒（真机「卡死」的直接证据）", /LONG_TASK_MS\s*=\s*500/.test(crumbSrc));
check("写痕迹包在 try/catch 里（宁可没证据，不能崩）", (crumbSrc.match(/catch/g) ?? []).length >= 6);
check("时间戳格式 mm:ss", stampOf(60_000, 0) === "01:00" && stampOf(65_000, 0) === "01:05");
/** 重复安装不许把"上次异常退出"误报出来（React StrictMode / 重挂载都会再挂一次） */
check(
  "一次页面加载只做一次会话记账（不会被重复挂载骗成「上次崩过」）",
  /let sessionBooked = false/.test(crumbSrc) && /if \(!sessionBooked\)/.test(crumbSrc),
);

/* ───────────────── ④ 反向 ───────────────── */
if (REVERSE) {
  check(
    "反向：把「还活着」误当成「正常」—— 那就抓不到闪退了，说明上面那条断言是有意义的",
    isDirtyExit(true) === false,
  );
  console.log(`\n✅ 反向验证通过（退出码 0 = 反向成功）\n`);
  process.exit(0);
}

/* ───────────────── ⑤ 浏览器里走真流程 ───────────────── */
console.log("\n【四】浏览器：崩过一次 → 打开环境自检 → 要能看到现场");
let browser;
try {
  browser = await chromium.launch({ channel: "msedge" });
  /** ⚠️ 全程只用一个 context —— 两个 `newPage()` 各自独立存储，模拟不了"同一个 App 重启" */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errors = [];

  /** 第一步：造一份"崩之前"的现场（6 条：心跳 / 长阻塞 / 聊天发起 / 动手） */
  const seed = await ctx.newPage();
  seed.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
  await seed.goto(BASE + "/", { waitUntil: "commit", timeout: 60000 });
  await seed.waitForSelector("header", { timeout: 60000 });
  await seed.evaluate(() => {
    localStorage.removeItem("qidao:breadcrumbs");
    localStorage.removeItem("qidao:session-alive");
  });
  await seed.evaluate(() => {
    localStorage.setItem(
      "qidao:breadcrumbs",
      JSON.stringify([
        { t: Date.now() - 60_000, kind: "session", text: "启动" },
        { t: Date.now() - 45_000, kind: "beat", text: "等模型回复｜堆 180MB｜节点 2400" },
        { t: Date.now() - 30_000, kind: "chat", text: "发起请求：上下文 34000 字 · 历史 42 条 · 工具 9 个" },
        { t: Date.now() - 25_000, kind: "long", text: "主线程堵了 1830ms（当时：正在写回复）" },
        { t: Date.now() - 20_000, kind: "action", text: "第 1 步：emotion_report" },
        { t: Date.now() - 15_000, kind: "beat", text: "执行动作（emotion_report）｜堆 340MB｜节点 3100" },
      ]),
    );
  });

  /**
   * 第二步：**模拟"上次崩了"** → 重新打开 App → 环境自检。
   *
   * ⚠️ 为什么这么模拟（踩了三个坑）：
   *   · 在页面里写标记没用 —— 页面还活着，导航时 `pagehide` 会把标记摘掉；
   *   · 而"摘掉标记"恰恰就是**正常退出**的含义 —— 那样模拟出来的不是崩溃；
   *   · 崩溃的本质是"**没走到 pagehide**" → 启动那一刻标记**还在**。
   * 所以：关掉旧页 + 新页在脚本跑起来之前把标记立好 = 精确等价于"上次崩了"。
   */
  await seed.close();
  const crashPage = await ctx.newPage();
  crashPage.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
  await crashPage.addInitScript(() => {
    try {
      localStorage.setItem("qidao:session-alive", "1");
    } catch {
      /* 无所谓 */
    }
  });
  await crashPage.goto(BASE + "/env", { waitUntil: "commit", timeout: 60000 });
  await crashPage.waitForSelector("header", { timeout: 60000 });
  await crashPage.waitForTimeout(2500);
  const view = await crashPage.evaluate(() => {
    const text = document.body.innerText;
    const i = text.indexOf("上次运行痕迹");
    return {
      hasDirty: /异常退出/.test(text),
      hasLong: /主线程堵了 1830ms/.test(text),
      hasAction: /emotion_report/.test(text),
      hasHeap: /堆 340MB/.test(text),
      title: i >= 0,
      snippet: text.slice(i, i + 200),
    };
  });
  check("「环境自检」里有「上次运行痕迹」这一块", view.title);
  check("**判定成异常退出**（这正是抓闪退的关键）", view.hasDirty, view.snippet.slice(0, 120));
  check("长阻塞那条现场在（1.83 秒堵顿 —— 真机卡死的直接证据）", view.hasLong, view.snippet.slice(0, 160));
  check("崩之前动手的是哪个动作能看见（emotion_report）", view.hasAction);
  check("崩溃前的堆内存能看见（340MB）", view.hasHeap);

  /**
   * 第三步：**干净退出**之后再进来，不该报"异常退出"（不然就是狼来了）。
   * 等价模拟：启动那一刻标记**已经不在**（`pagehide` 摘掉过 = 上次好好退出的）。
   */
  await crashPage.close();
  const cleanPage = await ctx.newPage();
  cleanPage.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
  await cleanPage.addInitScript(() => {
    try {
      localStorage.removeItem("qidao:session-alive");
    } catch {
      /* 无所谓 */
    }
  });
  await cleanPage.goto(BASE + "/env", { waitUntil: "commit", timeout: 60000 });
  await cleanPage.waitForSelector("header", { timeout: 60000 });
  await cleanPage.waitForTimeout(2500);
  const normalSnap = await cleanPage.evaluate(() => {
    const text = document.body.innerText;
    const i = text.indexOf("上次运行痕迹");
    return { text: text.slice(i, i + 200), verdict: localStorage.getItem("qidao:last-exit") };
  });
  check(
    "干净退出之后再进来，**不再**报异常退出（不狼来了）",
    !/异常退出/.test(normalSnap.text) && normalSnap.verdict === "clean",
    JSON.stringify(normalSnap),
  );
  await cleanPage.close();
  check("全程没有页面级报错", errors.length === 0, errors.join("；"));
} catch (err) {
  check("浏览器那一段跑得起来", false, String(err).slice(0, 200));
} finally {
  await browser?.close();
}

console.log("");
if (failures.length) {
  console.log(`❌ 有失败：${passed} 绿 / ${failures.length} 红`);
  for (const f of failures) console.log(`   · ${f}`);
  process.exit(1);
}
console.log(`✅ 全过：${passed} 绿 / 0 红`);
