import { chromium, devices } from "playwright";

/** 验收新的底部导航：尺寸是否收到示例图那个量级，以及抽屉里是否只剩一套。 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.split("\n")[0].slice(0, 130)));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE " + m.text().slice(0, 130)); });

const measure = () =>
  page.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const nav = document.querySelector('nav[aria-label="主导航"]');
    const items = nav ? [...nav.querySelectorAll("a")] : [];
    const tab = items[0];
    const label = tab?.querySelector("span");
    const pad = document.querySelector(".pb-above-nav");
    return {
      navCount: document.querySelectorAll("nav").length,
      navLabels: [...document.querySelectorAll("nav")].map((n) => n.getAttribute("aria-label")),
      pillH: nav ? Math.round(r(nav).height) : null,
      pillW: nav ? Math.round(r(nav).width) : null,
      tabH: tab ? Math.round(r(tab).height) : null,
      icon: tab?.querySelector("svg") ? Math.round(r(tab.querySelector("svg")).width) : null,
      labelFont: label ? getComputedStyle(label).fontSize : null,
      reserved: pad ? getComputedStyle(pad).paddingBottom : null,
    };
  });

console.log("=== /me（有导航的普通页）===");
await page.goto(BASE + "/me", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2200);
let m = await measure();
console.log(JSON.stringify(m, null, 2));
console.log(`  目标（示例图换算）：胶囊高约 48px、宽约 251px`);
console.log(`  实测：高 ${m.pillH}px、宽 ${m.pillW}px  → ${Math.abs(m.pillH - 48) <= 6 ? "✅ 跟图一个量级" : "⚠️ 差得多"}`);

console.log("\n=== /（对话页）—— 以前这页没有底部导航 ===");
await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2500);
m = await measure();
console.log(`  nav 数量: ${m.navCount}  标签: ${JSON.stringify(m.navLabels)}`);
console.log(`  悬浮胶囊: ${m.pillH ? `高 ${m.pillH}px` : "❌ 没显示"}  → ${m.pillH ? "✅ 现在对话页也有底部导航了" : "❌"}`);
await page.screenshot({ path: "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots\\nav-chat-page.png" });

console.log("\n=== 打开抽屉，看还有没有第二套导航 ===");
await page.getByRole("button", { name: /对话列表|菜单/ }).first().click().catch(async () => {
  await page.locator("header button").first().click();
});
await page.waitForTimeout(900);
m = await measure();
console.log(`  nav 数量: ${m.navCount}  标签: ${JSON.stringify(m.navLabels)}`);
const onlyOne = m.navCount === 1;
console.log(`  ${onlyOne ? "✅ 全 App 只剩一个导航（抽屉那套已撤）" : "❌ 还有多套导航"}`);

// 关键：抽屉开着的时候，底部胶囊是不是**真的看得见、点得到**
const overDrawer = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  if (!nav) return { visible: false, reason: "没有导航" };
  const r = nav.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const top = document.elementFromPoint(cx, cy);
  return {
    visible: r.height > 0,
    rect: { top: Math.round(r.top), h: Math.round(r.height) },
    zIndex: getComputedStyle(nav.parentElement).zIndex,
    // 胶囊正中间那一点，最上层到底是谁？是导航本身就说明没被遮住
    topElementIsNav: Boolean(top && (top === nav || nav.contains(top))),
    topElement: top ? `${top.tagName.toLowerCase()}${top.getAttribute("aria-label") ? `[${top.getAttribute("aria-label")}]` : ""}` : null,
  };
});
console.log(`  抽屉开着时胶囊可见: ${overDrawer.visible ? "✅" : "❌"}  层级 z=${overDrawer.zIndex}`);
console.log(`  胶囊中点最上层元素: ${overDrawer.topElement}  → ${overDrawer.topElementIsNav ? "✅ 没被抽屉/遮罩盖住" : "❌ 被盖住了，点不到"}`);
await page.screenshot({ path: "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots\\nav-drawer-open.png" });

console.log("\n控制台错误:", errors.length ? [...new Set(errors)].join(" | ") : "(none)");
await browser.close();
