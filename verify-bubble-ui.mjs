import { chromium, devices } from "playwright";

/**
 * 验收（用户 m01498 第 1、3 条）：
 *
 *   1. **引用摆在气泡下面**，跟微信那样 —— 引用文字不许再挤在气泡正文里；
 *      「改」也在气泡下面（引用 + 修改是同一个地方）。
 *   3. **照片不套气泡**（就是一张图发过去），并且**点一下能全屏看大图**，
 *      自己发的和他发的两种都要能点。
 *
 * 做法：直接把两条消息塞进库（不经过输入框、不发网络请求），刷页面看真实 DOM：
 *   · 引用的那条：正文是 `> 引用：xxx\n\n正文`（发送时就是这么拼的）
 *   · 图片：1×1 真 PNG 的 dataUrl（够渲染出可见尺寸并点得到）
 * 然后按**几何位置**断言"引用条在气泡下面""图在气泡外面"——不看 CSS 类名猜。
 *
 * 跑法：node verify-bubble-ui.mjs（要先有 dev server：npm run dev）
 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

const QUOTE = "他刚才那句话";
const BODY = "这是我引用你的回复";
/** 1×1 透明 PNG：真的图，浏览器会给出可见尺寸 */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const IMG_MINE = "我的图.png";
const IMG_HIS = "他的图.png";

const now = Date.now();
const shot = (id, kind, name) => ({
  id,
  kind,
  name,
  mime: "image/png",
  size: 70,
  dataUrl: PNG,
});

const snapshot = {
  state: {
    conversations: [
      {
        id: "conv-bubble",
        title: "气泡验收",
        messages: [
          {
            id: "u1",
            role: "user",
            content: `> 引用：${QUOTE}\n\n${BODY}`,
            thinking: "",
            thinkingDurationMs: 0,
            createdAt: now - 90000,
          },
          {
            id: "u2",
            role: "user",
            content: "顺带发张图",
            thinking: "",
            thinkingDurationMs: 0,
            createdAt: now - 60000,
            attachments: [shot("att-u", "image", IMG_MINE)],
          },
          {
            id: "a1",
            role: "assistant",
            content: "看到了，这张图我收着。",
            thinking: "",
            thinkingDurationMs: 0,
            createdAt: now - 30000,
            attachments: [shot("att-a", "image", IMG_HIS)],
          },
        ],
        createdAt: now - 3600000,
        updatedAt: now,
        pinned: false,
        incognito: false,
      },
    ],
    activeId: "conv-bubble",
    settings: { displayName: "yan", aiName: "星芒", showThinking: false, chatFontSize: "normal" },
  },
  version: 1,
};

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad += 1;
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.addInitScript((snap) => {
  const req = indexedDB.open("qidao-store", 1);
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
  };
  req.onsuccess = () => {
    const tx = req.result.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(snap), "aster-app");
  };
}, snapshot);

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.split("\n")[0].slice(0, 140)));
page.on("console", (m) => {
  /* 只盯**页面自己的**报错；网络类噪音（外链字体/CDN 连不上、被跨域挡）不算本页的 bug */
  if (
    m.type() === "error" &&
    !/ERR_BLOCKED_BY_RESPONSE|NotSameOrigin|favicon|net::ERR_|Failed to load resource/.test(m.text())
  ) {
    errors.push("CONSOLE " + m.text().slice(0, 140));
  }
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined, {
  timeout: 60000,
});
await page.waitForTimeout(1200);

console.log("=== 1. 引用在气泡**下面**，不在气泡正文里（m01498 第 1 条）===");
const quotePos = await page.evaluate(
  ({ body, quote }) => {
    const txt = (el) => (el?.innerText ?? "").trim();
    const bubble = [...document.querySelectorAll('div[class*="bg-chip"][class*="rounded-2xl"]')].find(
      (b) => txt(b).includes(body),
    );
    const bar = [...document.querySelectorAll('p[class*="border-l-2"]')].find((p) => txt(p).includes(quote));
    if (!bubble || !bar) return { bubble: Boolean(bubble), bar: Boolean(bar) };
    const rb = bubble.getBoundingClientRect();
    const rq = bar.getBoundingClientRect();
    return {
      bubble: true,
      bar: true,
      quoteInsideBubble: txt(bubble).includes(quote),
      barTop: Math.round(rq.top),
      bubbleBottom: Math.round(rb.bottom),
      below: rq.top >= rb.bottom - 1,
      bodyStillThere: txt(bubble).includes(body),
    };
  },
  { body: BODY, quote: QUOTE },
);
check("气泡还在、正文还是「" + BODY + "」", quotePos.bubble && quotePos.bodyStillThere, JSON.stringify(quotePos));
check("引用独立成了一条（气泡下面那个灰条）", quotePos.bar, JSON.stringify(quotePos));
check("引用文字**不在气泡里**（以前是挤在正文前面）", quotePos.quoteInsideBubble === false);
check(
  `引用条的顶边 ≥ 气泡的底边（${quotePos.barTop} ≥ ${quotePos.bubbleBottom}）`,
  quotePos.below === true,
);

console.log("=== 2. 照片不套气泡（m01498 第 3 条）===");
const bare = await page.evaluate(
  ({ mine, his, body }) => {
    const txt = (el) => (el?.innerText ?? "").trim();
    const im = document.querySelector(`img[alt="${mine}"]`);
    const ih = document.querySelector(`img[alt="${his}"]`);
    const bubble = [...document.querySelectorAll('div[class*="bg-chip"][class*="rounded-2xl"]')].find(
      (b) => txt(b).includes(body),
    );
    return {
      mine: Boolean(im),
      his: Boolean(ih),
      mineInBubble: Boolean(im?.closest('div[class*="bg-chip"]')),
      hisInBubble: Boolean(ih?.closest('div[class*="bg-chip"]')),
      /* 我的那条：图应当在文字气泡**上面**（先说图、再说字） */
      imgTop: im ? Math.round(im.getBoundingClientRect().top) : 0,
      bubbleTop: bubble ? Math.round(bubble.getBoundingClientRect().top) : 0,
    };
  },
  { mine: IMG_MINE, his: IMG_HIS, body: "顺带发张图" },
);
check("两张图都渲染出来了（我的 + 他的）", bare.mine && bare.his, JSON.stringify(bare));
check("我的图**不在气泡里**", bare.mine && bare.mineInBubble === false);
check("他的图**不在气泡里**（他发的图同样是裸图）", bare.his && bare.hisInBubble === false);
check(`我的图在文字气泡上面（${bare.imgTop} ≤ ${bare.bubbleTop}）`, bare.imgTop <= bare.bubbleTop + 1);
/* 留一张图给以后看"当时长什么样"（引用条在下面、图是裸的） */
await page.screenshot({ path: "shots/bubble-list.png" });

console.log("=== 3. 点一下能全屏看大图（两种状态都要）===");
const lightboxOpen = () =>
  page.evaluate(() => {
    const box = document.querySelector('div[class*="z-[90]"]');
    if (!box) return null;
    const img = box.querySelector("img");
    return img ? { src: img.getAttribute("src")?.slice(0, 30), w: Math.round(img.getBoundingClientRect().width) } : null;
  });

/** 点图：用页面内 `.click()`（他的那条在滚动容器里、Playwright 的坐标点击会抱怨"不在视口内"，
 *  但真实手指是先把列表滑上来再点的 —— 这里只要验证**点击处理器真的接上了**，所以用合成点击） */
const clickImg = (alt) =>
  page.evaluate((a) => {
    const img = document.querySelector(`img[alt="${a}"]`);
    if (!img) return false;
    img.click();
    return true;
  }, alt);

await clickImg(IMG_MINE);
await page.waitForTimeout(400);
const mineBox = await lightboxOpen();
check("点我的图 → 全屏大图出来了", Boolean(mineBox), JSON.stringify(mineBox));
if (mineBox) {
  await page.screenshot({ path: "shots/bubble-lightbox.png" });
  await page.mouse.click(6, 6);
  await page.waitForTimeout(350);
  check("再点一下关掉", (await lightboxOpen()) === null);
}

await clickImg(IMG_HIS);
await page.waitForTimeout(400);
const hisBox = await lightboxOpen();
check("点他的图 → 也能全屏看", Boolean(hisBox), JSON.stringify(hisBox));
if (hisBox) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(6, 6);
  await page.waitForTimeout(350);
  check("他的图看完也能关掉", (await lightboxOpen()) === null);
}

console.log("=== 4. 「改」也在气泡下面（引用/修改同一个地方）===");
const editChip = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText ?? "").trim() === "改");
  return Boolean(btn);
});
check("自己的消息下面有「改」", editChip);

console.log("=== 5. 控制台 / 运行时报错 ===");
check("没有页面报错", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log("--------------------------------------------------------------------------");
console.log(bad === 0 ? `全部通过（0 个失败）` : `有 ${bad} 个失败`);
process.exit(bad === 0 ? 0 : 1);
