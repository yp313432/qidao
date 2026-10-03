import { chromium, devices } from "playwright";

/** 对话页：底部导航和输入框到底有没有重叠？ */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "commit", timeout: 30000 });
await page.waitForTimeout(2500);

const probe = () =>
  page.evaluate(() => {
    const R = (e) => (e ? e.getBoundingClientRect() : null);
    const nav = document.querySelector('nav[aria-label="主导航"]');
    const wrap = nav?.parentElement;
    const comp = document.querySelector(".pb-composer");
    const card = comp?.firstElementChild;
    const input = comp?.querySelector("textarea, input");
    // 卡片最底下那排工具栏（+ / 模型 / 表情 / 发送）
    const toolbar = card?.lastElementChild;
    const send = [...(toolbar?.querySelectorAll("button") ?? [])].pop();
    const nr = R(nav);
    const cr = R(card);
    const ir = R(input);
    const tr = R(toolbar);
    const sr = R(send);
    const cs = wrap ? getComputedStyle(wrap) : null;
    // 真正要紧的是：工具栏和发送按钮有没有被导航盖住
    const overlapsNav = (r) => (r && nr ? Math.min(r.bottom, nr.bottom) - Math.max(r.top, nr.top) : null);
    const topAt = (r) => {
      if (!r) return null;
      const el = document.elementFromPoint(
        Math.round(r.left + r.width / 2),
        Math.round(r.top + r.height / 2),
      );
      return el ? `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""}` : null;
    };
    return {
      navTop: nr ? Math.round(nr.top) : null,
      navBottom: nr ? Math.round(nr.bottom) : null,
      navH: nr ? Math.round(nr.height) : null,
      navOpacity: cs?.opacity ?? null,
      navTransform: cs?.transform ?? null,
      composerTop: cr ? Math.round(cr.top) : null,
      composerBottom: cr ? Math.round(cr.bottom) : null,
      inputBottom: ir ? Math.round(ir.bottom) : null,
      toolbar: tr ? { top: Math.round(tr.top), bottom: Math.round(tr.bottom) } : null,
      toolbarOverlap: overlapsNav(tr),
      sendOverlap: overlapsNav(sr),
      sendTopElement: topAt(sr),
      composerPadBottom: comp ? getComputedStyle(comp).paddingBottom : null,
    };
  });

console.log("=== 不聚焦输入框（没打字）===");
let r = await probe();
console.log(JSON.stringify(r, null, 2));
const bad = (r.toolbarOverlap ?? 0) > 1 || (r.sendOverlap ?? 0) > 1;
console.log(
  bad
    ? `  ❌ 工具栏/发送键被导航盖住（工具栏 ${r.toolbarOverlap}px、发送 ${r.sendOverlap}px）`
    : `  ✅ 工具栏和发送键都在导航上方（工具栏 ${r.toolbarOverlap}px、发送 ${r.sendOverlap}px）`,
);
console.log(`  发送键位置最上层元素: ${r.sendTopElement}`);

console.log("\n=== 聚焦输入框（打字中）===");
await page.locator(".pb-composer textarea, .pb-composer input").first().click();
await page.waitForTimeout(700);
r = await probe();
console.log(`  导航 opacity=${r.navOpacity} translateY=${r.navTransform} pointerEvents=${r.navPointerEvents}`);
console.log(
  r.navOpacity === "0" || r.navTransform?.includes("135")
    ? "  ✅ 打字时导航收下去了"
    : "  ❌ 打字时导航没收",
);
await page.screenshot({ path: "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots\\nav-typing.png" });

console.log("\n=== 失焦（打完字）===");
await page.locator("header").first().click().catch(() => page.keyboard.press("Escape"));
await page.waitForTimeout(900);
r = await probe();
console.log(`  导航 opacity=${r.navOpacity} → ${r.navOpacity === "1" ? "✅ 导航回来了" : "❌ 没回来"}`);
console.log(`  此时工具栏被盖: ${(r.toolbarOverlap ?? 0) > 1 ? `❌ ${r.toolbarOverlap}px` : "✅ 没有"}`);
await browser.close();
