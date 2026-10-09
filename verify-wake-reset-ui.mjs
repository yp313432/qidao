/**
 * 验收脚本：设置页（我的 → 系统 → 他主动找你）里那两样新东西，在**网页版**里的实际表现。
 *
 *  ① 「清空后台状态，重新来」按钮在不在、点了会不会出错、结果文案说不说实话
 *     ⚠️ 网页版**没有抽屉**（原生 `WakeBridgePlugin.clear()` 不存在）——
 *        所以实现必须优雅跳过，并如实说"这台上没有抽屉"，
 *        **不许**假装"已清空并重新交给他"。
 *  ② 「看后台最近几次醒来」（只读折叠区）：网页版也要有话说（"后台还没有记录"），不能白板
 *
 * 只读不改：它不点任何会改配置的东西（除了那个清空按钮本身，而网页版上它是空转）。
 * 跑法（dev server 要在 8080）：`node verify-wake-reset-ui.mjs`
 */
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";
mkdirSync(OUT, { recursive: true });

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

const browser = await chromium.launch(
  existsSync(EDGE) ? { executablePath: EDGE, headless: true } : { headless: true },
);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
const consoleNoise = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.split("\n")[0].slice(0, 160)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text().slice(0, 160);
  /**
   * ⚠️ 「Failed to load resource」是**环境噪声**（这台机器连不上 fonts.gstatic.com，
   * 字体请求超时），跟这段代码无关 —— 但它会拖到 30 秒才失败，顺便把页面布局推一下
   * （第一次跑就是这么把点击"挪"掉的）。所以：字体一律拦掉，噪声单独记，不算失败。
   */
  if (/Failed to load resource|fonts\.gstatic|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED/i.test(t)) consoleNoise.push(t);
  else errors.push("CONSOLE " + t);
});

/** 字体拦掉：布局才稳，点击才落在该落的地方 */
await page.route("**://fonts.gstatic.com/**", (route) => route.abort());
await page.route("**://fonts.googleapis.com/**", (route) => route.abort());

// 跟 shot-me.mjs 一样：waitUntil 只能 "commit"（Vite 的 HMR websocket 常驻，load 迟迟不结算）
await page.goto(`${BASE}/system`, { waitUntil: "commit", timeout: 30_000 });
await page.waitForTimeout(2000);

/** 等布局不再变（字体/图片都到位之后再点，免得点到旧坐标上） */
async function waitStable() {
  let last = -1;
  for (let i = 0; i < 15; i += 1) {
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === last) return;
    last = h;
    await page.waitForTimeout(300);
  }
}
await waitStable();

/** 等到按钮真的变成某个样子（比死等 400ms 稳） */
async function waitBtn(btn, want, tries = 12) {
  for (let i = 0; i < tries; i += 1) {
    const t = await btn.innerText();
    if (t.includes(want)) return t;
    await page.waitForTimeout(250);
  }
  return await btn.innerText();
}

const text = async () => page.locator("body").innerText();

/* ───────── ① 那一段在不在（通道自检 + 清空按钮挨着）───────── */

const card = page.getByText("他主动找你", { exact: true }).first();
await card.scrollIntoViewIfNeeded();
const cardText = await text();
check("找得到「他主动找你」那一段", (await card.count()) > 0);
check("老的「通道自检」还在（同一条通道上）", cardText.includes("通道自检"));

const resetBtn = page.locator("button", { hasText: "清空" }).first();
check("按钮在：清空后台状态，重新来", (await resetBtn.innerText()).includes("清空后台状态，重新来"), await resetBtn.innerText());

/* ───────── ② 二次确认：第一次只是装填，不许真清 ───────── */

await resetBtn.scrollIntoViewIfNeeded();
await resetBtn.click();
check(
  "第一次点击只是「装填」（按钮变成再点一下）",
  (await waitBtn(resetBtn, "再点一下")).includes("再点一下"),
  await resetBtn.innerText(),
);
const armedText = await text();
check("并且把「会清掉什么」说清楚", /会清掉醒来次数、后台日志、上次说话时间、静音标记/.test(armedText));
check("第一次点击没有真的清（还没出现任何结果文案）", !armedText.includes("已清空"));

/* ───────── ③ 第二次才真清：网页版必须如实说"这台上没有抽屉" ───────── */

await resetBtn.scrollIntoViewIfNeeded();
await resetBtn.click();
/** 等界面真的把结果说出来（🔴/🟢 那一句） */
let afterReset = "";
for (let i = 0; i < 16; i += 1) {
  await page.waitForTimeout(250);
  afterReset = await text();
  if (/这台上没有抽屉|已清空|重新交/.test(afterReset) && afterReset.includes("抽屉")) break;
}
check(
  "点了有结果文案，而且如实说：这台上没有抽屉（网页版没有后台任务）",
  afterReset.includes("这台上没有抽屉"),
  (afterReset.split("\n").find((l) => l.includes("抽屉")) ?? "(没有结果文案)").slice(0, 90),
);
check(
  "没有假装成功（网页版不许写「已清空并重新交给他」）",
  !afterReset.includes("已清空并重新交给他"),
);
check("按钮回到初始文案（可以再来一次）", (await resetBtn.innerText()).includes("清空后台状态，重新来"), await resetBtn.innerText());

await page.screenshot({ path: `${OUT}/wake-reset-web.png`, animations: "disabled", timeout: 60_000 });

/* ───────── ④ 后台记录：只读折叠区 ───────── */

const logBtn = page.getByRole("button", { name: "看后台最近几次醒来" });
await logBtn.scrollIntoViewIfNeeded();
await logBtn.click();
await page.waitForTimeout(900);
const afterLog = await text();
check("展开后有内容（网页版：后台还没有记录，不是白板）", /后台还没有记录/.test(afterLog));
check("展开后按钮变成「收起后台记录」", (await page.getByRole("button", { name: "收起后台记录" }).count()) > 0);

await page.setViewportSize({ width: 390, height: 1600 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/wake-log-web.png`, animations: "disabled", timeout: 60_000 });

/* ───────── ⑤ 全程不许有 pageerror（字体那类资源噪声单独报，不算失败）───────── */

check("全程没有 pageerror / 自己代码的 console error", errors.length === 0, errors.join(" | ").slice(0, 200));
console.log(
  `ℹ️  环境噪声（字体等资源加载失败，跟这段代码无关）：${consoleNoise.length ? [...new Set(consoleNoise)].length + " 类" : "无"}`,
);

await browser.close();

console.log("-".repeat(64));
console.log(`清空入口 + 后台记录的网页版验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
console.log(`截图：preview-shots/wake-reset-web.png · preview-shots/wake-log-web.png`);
process.exit(bad === 0 ? 0 : 1);
