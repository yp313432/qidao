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
    const pad = document.querySelector(".pb-above-nav");
    const active = nav?.querySelector('a[aria-current="page"]');
    // 激活项里那个"圆"
    const circle = active?.querySelector("span");
    const cs = circle ? getComputedStyle(circle) : null;
    const nr = r(nav);
    return {
      navCount: document.querySelectorAll("nav").length,
      navLabels: [...document.querySelectorAll("nav")].map((n) => n.getAttribute("aria-label")),
      navW: nr ? Math.round(nr.width) : null,
      navH: nr ? Math.round(nr.height) : null,
      navTop: nr ? Math.round(nr.top) : null,
      navBottom: nr ? Math.round(nr.bottom) : null,
      navLeft: nr ? Math.round(nr.left) : null,
      navRight: nr ? Math.round(nr.right) : null,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      tabW: tab ? Math.round(r(tab).width) : null,
      icon: tab?.querySelector("svg") ? Math.round(r(tab.querySelector("svg")).width) : null,
      // 圆：宽高相等 + 圆角半径等于一半 → 真圆
      circle: circle
        ? {
            w: Math.round(r(circle).width),
            h: Math.round(r(circle).height),
            radius: cs?.borderRadius,
            bg: cs?.backgroundColor,
          }
        : null,
      reserved: pad ? getComputedStyle(pad).paddingBottom : null,
    };
  });

console.log("=== /me（有导航的普通页）===");
await page.goto(BASE + "/me", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2200);
let m = await measure();
console.log(JSON.stringify(m, null, 2));

const fullWidth = m.navW === m.viewportW && m.navLeft === 0;
const flush = m.navBottom === m.viewportH;
const isRound =
  m.circle && m.circle.w === m.circle.h && parseFloat(m.circle.radius) >= m.circle.w / 2 - 0.5;
console.log(`  撑满左右（宽 ${m.navW} = 屏宽 ${m.viewportW}）: ${fullWidth ? "✅" : "❌"}`);
console.log(`  贴着底边（底 ${m.navBottom} = 屏高 ${m.viewportH}）: ${flush ? "✅" : "❌"}`);
console.log(
  `  激活态是圆（${m.circle?.w}x${m.circle?.h}，圆角 ${m.circle?.radius}）: ${isRound ? "✅" : "❌"}`,
);
console.log(`  玻璃高亮底（非透明）: ${m.circle?.bg && m.circle.bg !== "rgba(0, 0, 0, 0)" ? "✅ " + m.circle.bg : "❌ 没有玻璃底"}`);

console.log("\n=== /（对话页）—— 以前这页没有底部导航 ===");
await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2500);
m = await measure();
console.log(`  nav 数量: ${m.navCount}  标签: ${JSON.stringify(m.navLabels)}`);
console.log(
  `  底部导航: ${m.navH ? `高 ${m.navH}px、宽 ${m.navW}px、底边 ${m.navBottom}` : "❌ 没显示"}`,
);

// 输入框与导航之间的呼吸缝（用户要的"留白、不局促"）
const gap = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const card = document.querySelector(".pb-composer")?.firstElementChild;
  if (!nav || !card) return null;
  const nr = nav.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  return { gap: Math.round(nr.top - cr.bottom), cardBottom: Math.round(cr.bottom), navTop: Math.round(nr.top) };
});
if (gap) {
  console.log(`  输入框 ↔ 导航的呼吸缝: ${gap.gap}px  → ${gap.gap >= 8 ? "✅ 分开了" : "❌ 贴在一起"}`);
}
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

// 关键：抽屉开着的时候，底部导航是不是**真的看得见、点得到**
const overDrawer = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  if (!nav) return { visible: false, reason: "没有导航" };
  const r = nav.getBoundingClientRect();
  // 取右侧那一项（抽屉只占左边 84%，右边这项应该露在外面）
  const item = [...nav.querySelectorAll("a")].pop();
  const ir = item?.getBoundingClientRect();
  const top = ir
    ? document.elementFromPoint(Math.round(ir.left + ir.width / 2), Math.round(ir.top + ir.height / 2))
    : null;
  return {
    visible: r.height > 0,
    rect: { top: Math.round(r.top), h: Math.round(r.height) },
    zIndex: getComputedStyle(nav.parentElement).zIndex,
    topElementIsNav: Boolean(top && (top === nav || nav.contains(top))),
    topElement: top ? `${top.tagName.toLowerCase()}${top.getAttribute("aria-label") ? `[${top.getAttribute("aria-label")}]` : ""}` : null,
  };
});
console.log(`  抽屉开着时胶囊可见: ${overDrawer.visible ? "✅" : "❌"}  层级 z=${overDrawer.zIndex}`);
console.log(`  胶囊中点最上层元素: ${overDrawer.topElement}  → ${overDrawer.topElementIsNav ? "✅ 没被抽屉/遮罩盖住" : "❌ 被盖住了，点不到"}`);
await page.screenshot({ path: "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots\\nav-drawer-open.png" });

console.log("\n控制台错误:", errors.length ? [...new Set(errors)].join(" | ") : "(none)");
await browser.close();
