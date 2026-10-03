import { chromium, devices } from "playwright";

/** 量底部导航的实际占用：高度、胶囊内边距、图标/文字尺寸、屏占比。 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(BASE + "/me", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2500);

const m = await page.evaluate(() => {
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  const nav = document.querySelector('nav[aria-label="主导航"]');
  if (!nav) return { found: false };
  const pill = r(nav);
  const wrap = r(nav.parentElement) ?? pill;
  const tab = nav.querySelector("a");
  const tr = r(tab);
  const icon = tab?.querySelector("svg");
  const ir = r(icon);
  const label = tab?.querySelector("span");
  const lr = r(label);
  const cs = label ? getComputedStyle(label) : null;
  const view = document.querySelector(".view-enter");
  const vr = r(view);
  const padEl = document.querySelector(".pb-above-nav");
  return {
    found: true,
    viewportH: window.innerHeight,
    viewportW: window.innerWidth,
    pill: pill ? { w: Math.round(pill.width), h: Math.round(pill.height) } : null,
    pillPctW: pill ? Math.round((pill.width / window.innerWidth) * 100) : null,
    wrapBottomGap: Math.round(window.innerHeight - wrap.bottom),
    wrapH: Math.round(wrap.height),
    tab: tr ? { w: Math.round(tr.width), h: Math.round(tr.height) } : null,
    icon: ir ? Math.round(ir.width) : null,
    labelFontPx: cs?.fontSize ?? null,
    labelH: lr ? Math.round(lr.height) : null,
    pillPadding: getComputedStyle(nav).padding,
    gap: getComputedStyle(nav).gap,
    contentBottom: vr ? Math.round(vr.bottom) : null,
    contentPadBottom: padEl ? getComputedStyle(padEl).paddingBottom : null,
  };
});
console.log("=== 底部漂浮导航实测（390x844）===");
console.log(JSON.stringify(m, null, 2));

// 抽屉里的第二套导航（只在对话页出现）
await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2500);
const drawerNav = await page.evaluate(() => {
  const navs = [...document.querySelectorAll("nav")].map((n) => ({
    label: n.getAttribute("aria-label"),
    visible: n.getBoundingClientRect().height > 0,
    h: Math.round(n.getBoundingClientRect().height),
  }));
  const floating = document.querySelector('nav[aria-label="主导航"]');
  return {
    navs,
    floatingVisibleOnChatPage: floating ? floating.getBoundingClientRect().height > 0 : false,
    bottomPadComposer: getComputedStyle(document.querySelector(".pb-composer") ?? document.body).paddingBottom,
  };
});
console.log("\n=== 对话页 ===");
console.log(JSON.stringify(drawerNav, null, 2));

await page.screenshot({ path: "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots\\nav-current-chat.png" });
await browser.close();
