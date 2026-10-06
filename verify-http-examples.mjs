/**
 * 验收脚本：HTTP 工具的**示例**能不能用、「加示例」按钮对不对。
 *
 * 用户的诉求（原话）："HTTP 工具一般是用来干嘛的？其实我对他不是很了解，
 * 你能帮我直接弄几个例子上去吗？"——所以:
 *   ① 示例得能一键加上（老用户装新版之后不用手抄地址）
 *   ② 加上之后要能看出"哪几个值可以被星芒改"
 *   ③ 示例本身**真的能调通**（不是摆设）
 *   ④ 点两次不会重复加
 *
 * ⚠️ 最后一项依赖外网（GitHub 公开接口）。没网时这项会失败 ——
 * 那是环境问题，不是代码问题（本地实测过能通、能返回 JSON）。
 *
 * 跑法：node verify-http-examples.mjs （要完整权限 + dev server 在 8080）
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8080";
const SHOTS = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleErrors = [];
page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/** 等页面真的能点（hydration 完成），见 verify-mcp.mjs 里的说明 */
async function waitInteractive(page) {
  await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined, null, {
    timeout: 30000,
  });
}

/* 1. 进 HTTP 标签，点「加几个能用的示例」 */
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("h1", { timeout: 20000 });
await waitInteractive(page);

// 先把已有的清掉，保证是"从零加示例"这条路径
await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open("qidao-store", 1);
    r.onsuccess = () => res(r.result);
  });
  const raw = await new Promise((res) => {
    const tx = db.transaction("kv", "readonly");
    const g = tx.objectStore("kv").get("aster-app");
    g.onsuccess = () => res(g.result);
  });
  const parsed = JSON.parse(raw);
  parsed.state.httpTools = [];
  await new Promise((res) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
    tx.oncomplete = res;
  });
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
await waitInteractive(page);

check("一开始是空的（还没加示例）", (await page.locator("body").innerText()).includes("还没有工具"));

await page.getByRole("button", { name: /加几个能用的示例/ }).click();
await page.locator("article").first().waitFor({ timeout: 20000 });

const text = await page.locator("body").innerText();
check("提示说加进来了几个", text.includes("加进来了 4 个示例"), text.match(/加进来了[^\n]*/)?.[0] ?? "");
for (const name of ["天气（可改经纬度）", "搜 GitHub 仓库", "人民币汇率", "随机一言"]) {
  check(`示例「${name}」在列表里`, text.includes(name));
}

/* 2. 能看出"哪几个值可以被星芒改" */
check("天气那条标出了经纬度可改", text.includes("可改参数：latitude、longitude、current"), "latitude、longitude、current");
check("搜 GitHub 那条标出了搜索词可改", text.includes("可改参数：q、per_page"), "q、per_page");
await page.screenshot({ caret: "initial", path: `${SHOTS}\\http-examples.png` });

/* 3. 点两次不会重复加 */
await page.getByRole("button", { name: /加几个能用的示例/ }).click();
await page.waitForTimeout(800);
const after = await page.locator("article").count();
check("再点一次不会重复加（按名字去重）", after === 4, `现在 ${after} 条`);
check("第二次点会说「都已经有了」", (await page.locator("body").innerText()).includes("都已经有了"));

/* 4. 示例真的能调通（外网依赖） */
const ghCard = page.locator("article").filter({ hasText: "搜 GitHub 仓库" });
await ghCard.getByRole("button", { name: "调用" }).click();
await ghCard.locator("pre").waitFor({ timeout: 40000 });
const ghText = await ghCard.innerText();
check(
  "示例「搜 GitHub 仓库」真的调通了（HTTP 200 且返回 JSON）",
  ghText.includes("HTTP 200") && ghText.includes("total_count"),
  ghText.replace(/\s+/g, " ").slice(-90),
);
await page.screenshot({ caret: "initial", path: `${SHOTS}\\http-examples-called.png` });

console.log("-".repeat(64));
const hydration = consoleErrors.filter((t) => /hydration/i.test(t));
check("整轮没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 110) ?? "");
console.log(`HTTP 示例验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
process.exit(bad === 0 ? 0 : 1);
