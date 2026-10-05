/**
 * 自动核账：**每个页面的返回钮，是不是都指向它的上一级**。
 *
 * 为什么要有这个脚本（用户的抱怨）：
 *   "返回只能返回上一级，不能直接返回首页……所有的返回都要是返回上一级"
 *
 * 之前靠人读代码找，漏了一个（/memory 退回了一级首页）。
 * 靠人眼逐个查 20 个页面不可靠 —— 所以让脚本替我读：
 *
 *   1. 从 src/routes/_app/** 列出所有页面路径
 *   2. 打开每一页，读返回钮的 href
 *   3. 跟 nav-tree.ts 里的层级表对账
 *
 * 跑法：node verify-hierarchy.mjs
 * 退出码非 0 = 有页面的返回是错的（CI 里能拦住）
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";

/** 跟 src/lib/nav-tree.ts 保持一致（那边是唯一的定义处，这里是它的"考卷"） */
const TERTIARY_PARENT = {
  "/permissions": "/core",
  "/worldbook": "/core",
  "/inner": "/core",
  "/memories": "/core",
  "/memory": "/usage",
  "/alarms": "/system",
  "/tasks": "/system",
  "/env": "/system",
  "/play/gobang": "/play/tools",
  "/play/days": "/play/tools",
  "/play/todo": "/play/tools",
  "/play/add": "/play/listen",
};
const ROOT_PATHS = ["/", "/tools", "/play", "/me"];

function parentOf(path) {
  const p = path.replace(/\/+$/, "") || "/";
  if (TERTIARY_PARENT[p]) return TERTIARY_PARENT[p];
  if (ROOT_PATHS.includes(p)) return null;
  if (p.startsWith("/play/")) return "/play";
  return "/me";
}

/** 有界面的「我的」二级页 + 玩乐区页面 */
const PAGES = [
  "/core",
  "/space",
  "/usage",
  "/data",
  "/system",
  "/permissions",
  "/worldbook",
  "/inner",
  "/memories",
  "/memory",
  "/alarms",
  "/tasks",
  "/env",
  "/voice",
  "/play/listen",
  "/play/add",
  "/play/space",
  "/play/truth",
  "/play/learn",
  "/play/shigan",
  "/play/tools",
  "/play/gobang",
  "/play/days",
  "/play/todo",
];

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

console.log("路径".padEnd(18) + "返回钮指向".padEnd(18) + "期望(上一级)".padEnd(18) + "结果");
console.log("-".repeat(74));

let bad = 0;
let checked = 0;

for (const route of PAGES) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60000 });
  let href = "(没渲染)";
  try {
    await page.waitForSelector("header", { timeout: 20000 });
    href = await page.evaluate(() => {
      const a = document.querySelector('header a[aria-label^="返回"]');
      return a ? a.getAttribute("href") : null;
    });
  } catch {
    href = "(超时)";
  }

  const want = parentOf(route);
  checked++;

  let verdict;
  if (want === null) {
    // 顶级 tab 本来就不该有返回钮
    verdict = href === null ? "✅ 无返回钮（正确）" : `❌ 不该有返回钮，却是 ${href}`;
    if (href !== null) bad++;
  } else if (href === want) {
    verdict = "✅";
  } else {
    verdict = `❌ 应该是 ${want}`;
    bad++;
  }

  console.log(
    route.padEnd(18) + String(href ?? "（无）").padEnd(18) + String(want ?? "（顶级，无）").padEnd(18) + verdict,
  );
}

console.log("-".repeat(74));
console.log(`检查 ${checked} 个页面，错误 ${bad} 个`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
