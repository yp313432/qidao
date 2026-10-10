/**
 * 验收脚本：**App 的返回语义**（系统返回键 / 侧边滑动手势）。
 *
 * 用户真机原话：
 *   "它的返回竟然还是按照网页版来做的 —— 我用手机自带的滑侧边栏返回，
 *    返回的不是我当前页面的上一级，而是我操作的上一级页面 …
 *    最后一步步返回我所有点过的页面，即使他们之间并没有层级关系。"
 *
 * 网页：返回 = 历史栈（你点过的顺序）。**App：返回 = 层级**（当前页的上一级）。
 * 这个脚本验两件事：
 *   ① **纯逻辑**：`systemBackTarget()` 对每个页面算出的目标
 *      —— 必须是它的上一级，而且**必须是真实存在的页面**；
 *      顶级页（四个 tab）返回 `"exit"`（App 的规矩是退出，不是回到上一个点过的页）
 *   ② **接线**：伪造一个原生桥（`CapacitorCustomPlatform`，跟 App 分支验收同一套做法），
 *      把 `backButton` 回调抓出来，**真的调一次**，看它跳到哪
 *
 * 跑法：node verify-app-back.mjs （要 dev server 在 8080）
 */
import { readdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* 真实的页面清单：**递归**扫路由文件推出来（"返回目标必须是真页面"这条要用）。
   ⚠️ 必须递归：`/tools/mcp` 在 `src/routes/_app/tools/mcp.tsx` 里，
   只 readdir 顶层会漏掉它，于是这条断言会假失败（第一版就是这么错的）。 */
function walk(dir, prefix = "") {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) out.push(...walk(`${dir}/${ent.name}`, `${prefix}${ent.name}.`));
    else if (ent.name.endsWith(".tsx")) out.push(prefix + ent.name.replace(/\.tsx$/, ""));
  }
  return out;
}
const realPages = new Set(
  walk("src/routes/_app").map((name) => {
    const clean = name.replace(/\.index$/, "").replace(/^index$/, "");
    return clean ? "/" + clean.replace(/\./g, "/") : "/";
  }),
);
realPages.add("/");
console.log(`真实页面 ${realPages.size} 个：${[...realPages].slice(0, 6).join(" ")} …`);

const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
/** 桩模块要用到的盒子（在页面里初始化，早于任何模块执行） */
await page.addInitScript(() => {
  window.__back = { cb: null, removed: false, exited: 0 };
  // 顺带让 isNativeApp() 也认为自己在 App 里（AppBack 的行为不依赖它，但保持环境一致）
  window.CapacitorCustomPlatform = { name: "android", plugins: {} };
});
const consoleErrors = [];
page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

/*
  把 `@capacitor/app` **整个换成桩模块**（拦 Vite 预打包出来的那个文件）。
  为什么不用真的 Capacitor + 伪造平台：平台探测那条路绕（web 实现会抢先），
  第一版就是这么没接上的。直接替换模块 → 接线完全可控，也能断言 exitApp。
*/
await page.route(/capacitor_app|@capacitor\/app/, async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `
      export const App = {
        addListener: async (event, cb) => {
          if (event === "backButton") window.__back.cb = cb;
          return { remove: async () => { window.__back.removed = true; } };
        },
        exitApp: async () => { window.__back.exited += 1; },
        getLaunchUrl: async () => ({ url: "" }),
      };
    `,
  });
});

/* ── ① 纯逻辑 ── */
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1200);

const logic = await page.evaluate(async () => {
  const { systemBackTarget, parentOf, ROOT_PATHS } = await import("/src/lib/nav-tree.ts");
  const cases = [
    "/voice",
    "/data",
    "/system",
    "/core",
    "/space",
    "/usage",
    "/memory",
    "/worldbook",
    "/tools/mcp",
    "/tools/http",
    "/play/todo",
    "/play/tools",
    "/play/learn",
    "/play/days",
    "/play/shigan",
  ];
  const out = {};
  for (const p of cases) out[p] = systemBackTarget(p);
  return {
    out,
    tabs: ROOT_PATHS,
    tabTargets: ROOT_PATHS.map((p) => systemBackTarget(p)),
    withQuery: systemBackTarget("/tools/mcp?id=abc"),
    withSlash: systemBackTarget("/voice/"),
    parentIsSame: cases.filter((p) => parentOf(p) === p),
  };
});

check(
  "① 顶层板块 → 回 /me",
  ["/voice", "/data", "/system", "/core", "/space", "/usage"].every((p) => logic.out[p] === "/me"),
  JSON.stringify(logic.out),
);
check(
  "① 三级页回它真正的上一级（层级比想象细：世界书在「AI 概览」下，记忆在「用量」下）",
  logic.out["/worldbook"] === "/core" && logic.out["/memory"] === "/usage",
  `worldbook→${logic.out["/worldbook"]} memory→${logic.out["/memory"]}`,
);
check("① 工具编辑器 → 回 /tools", logic.out["/tools/mcp"] === "/tools" && logic.out["/tools/http"] === "/tools");
check(
  "① 玩乐：一级回 /play，二级回它的上一级（待办/日子在「玩乐工具」下）",
  logic.out["/play/tools"] === "/play" &&
    logic.out["/play/learn"] === "/play" &&
    logic.out["/play/shigan"] === "/play" &&
    logic.out["/play/todo"] === "/play/tools" &&
    logic.out["/play/days"] === "/play/tools",
  JSON.stringify({ tools: logic.out["/play/tools"], todo: logic.out["/play/todo"], days: logic.out["/play/days"] }),
);
check(
  "① **只有「对话」首页返回 exit；其它三个 tab 先回对话首页**（真 App 的规矩）",
  JSON.stringify(logic.tabTargets) === JSON.stringify(["exit", "/", "/", "/"]),
  JSON.stringify({ tabs: logic.tabs, targets: logic.tabTargets }),
);
check("① 带查询串 / 末尾斜杠也算得对", logic.withQuery === "/tools" && logic.withSlash === "/me");
check("① 没有页面会「返回自己」", logic.parentIsSame.length === 0, logic.parentIsSame.join("、"));

const notReal = Object.entries(logic.out).filter(([, t]) => t !== "exit" && !realPages.has(t));
check(
  "① **返回目标都必须是真实存在的页面**（回一个不存在的页 = 白屏）",
  notReal.length === 0,
  notReal.map(([p, t]) => `${p}→${t}`).join("、") || "全部存在",
);

/* ── ② 接线：真的触发一次 backButton ── */
check("② 原生桥把 backButton 回调注册上了", (await page.evaluate(() => typeof window.__back.cb)) === "function");

// 先去一个二级页，再触发系统返回 → 应该回它的上一级
await page.goto(`${BASE}/tools/mcp`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__back.cb());
await page.waitForTimeout(600);
check("② 在 /tools/mcp 触发返回 → 回到 /tools（它的上一级）", new URL(page.url()).pathname === "/tools", page.url());

// 先在别的页面绕一圈（制造"历史里有无关页面"），再回二级页触发返回 —— 这正是用户踩的场景
await page.goto(`${BASE}/voice`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(600);
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(600);
await page.goto(`${BASE}/tools/mcp`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(900);
await page.evaluate(() => window.__back.cb());
await page.waitForTimeout(600);
check(
  "② **绕过一圈之后仍然回上一级**（不是回上一个点过的页面）",
  new URL(page.url()).pathname === "/tools",
  page.url(),
);

// 非首页 tab 触发返回 → 回对话首页（**不退出**）
await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(900);
await page.evaluate(() => window.__back.cb());
await page.waitForTimeout(500);
const exitedFromTab = await page.evaluate(() => window.__back.exited);
check(
  "② 在「我的」tab 触发返回 → 回对话首页，**不退出 App**",
  new URL(page.url()).pathname === "/" && exitedFromTab === 0,
  `${page.url()}（exitApp ${exitedFromTab} 次）`,
);

// 对话首页触发返回 → 退出 App（用户："对话页面我侧滑屏幕才会退出 app"）
await page.evaluate(() => window.__back.cb());
await page.waitForTimeout(400);
const exited = await page.evaluate(() => window.__back.exited);
check("② 在**对话首页**触发返回 → 退出 App", exited >= 1, `exitApp 调了 ${exited} 次`);

console.log("-".repeat(64));
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check("全程没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 110) ?? "");
console.log(`App 返回语义验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
process.exit(bad === 0 ? 0 : 1);
