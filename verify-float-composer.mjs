import { chromium, devices } from "playwright";

/**
 * 验收（用户 m02002）：
 *
 *   "对话框独立，改成悬浮聊天浮层，然后消息是可滚动消息流，
 *    滑动时会一条条从对话框过去，而对话框保持不动"
 *
 * 也就是三件事，都要用**真实几何**证明（不看 CSS 类名猜）：
 *   1. 消息区**铺到最底下**（输入框是浮在它上面的，不是占掉一行）——
 *      所以滑动时消息能真的从输入框**下面**过去；
 *   2. 滚动消息时，输入框的坐标**一点不动**；
 *   3. 最后一条消息仍然**滑得出来**（不被浮层盖住 → ResizeObserver 补的底部留白是够的）。
 *
 * 跑法：node verify-float-composer.mjs（要先有 dev server：npm run dev）
 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

let bad = 0;
const check = (name, pass, extra = "") => {
  if (!pass) bad++;
  console.log(`  ${pass ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`);
};

/** 造 30 条消息：够长才能滚 */
const now = Date.now();
const messages = [];
for (let i = 0; i < 15; i++) {
  messages.push({
    id: `u${i}`,
    role: "user",
    content: `第 ${i + 1} 句：这是用来把列表撑长的测试消息，滚起来才有得看。`,
    thinking: "",
    thinkingDurationMs: 0,
    createdAt: now - (30 - i * 2) * 1000,
  });
  messages.push({
    id: `a${i}`,
    role: "assistant",
    content: `收到第 ${i + 1} 句。我也回一句，把这条消息撑到两行以上，好观察它从输入框下面滑过去。`,
    thinking: "",
    thinkingDurationMs: 0,
    createdAt: now - (29 - i * 2) * 1000,
  });
}
messages.push({
  id: "last",
  role: "assistant",
  content: "最后一条：我应该能完整滑到输入框上面。",
  thinking: "",
  thinkingDurationMs: 0,
  createdAt: now,
});

const snapshot = {
  state: {
    conversations: [
      {
        id: "conv-float",
        title: "悬浮对话验收",
        messages,
        createdAt: now - 600000,
        updatedAt: now,
        pinned: false,
        incognito: false,
      },
    ],
    activeId: "conv-float",
    settings: { displayName: "yan", aiName: "星芒", showThinking: false, chatFontSize: "normal" },
  },
  version: 1,
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
await page.waitForTimeout(1500);

/** 找消息滚动容器：里面装着消息列表（ol 的父元素），能滚的那个 */
const geom = () =>
  page.evaluate(() => {
    const ol = document.querySelector("ol");
    const scroller = ol?.parentElement;
    const ta = document.querySelector("textarea");
    /* 输入框所在的那张玻璃卡 = textarea 往上找最近的有 border 的卡片 */
    let card = ta;
    while (
      card &&
      !/glass-(float|panel)/.test((card.className ?? "").toString())
    )
      card = card.parentElement;
    if (!ol || !scroller || !ta || !card) return null;
    const rs = scroller.getBoundingClientRect();
    const rc = card.getBoundingClientRect();
    const olCs = getComputedStyle(ol);
    const last = ol.querySelector("li:last-child");
    return {
      scrollerBottom: Math.round(rs.bottom),
      scrollerTop: Math.round(rs.top),
      scrollerH: Math.round(rs.height),
      cardTop: Math.round(rc.top),
      cardBottom: Math.round(rc.bottom),
      cardH: Math.round(rc.height),
      padBottom: Math.round(parseFloat(olCs.paddingBottom)),
      scrollTop: Math.round(scroller.scrollTop),
      scrollH: Math.round(scroller.scrollHeight),
      clientH: Math.round(scroller.clientHeight),
      /* 最后一条消息的底边（视口坐标）——用来判断"能不能整条滑到输入框上面" */
      lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : 0,
      /* ⭐ 用户 m03024 第 1 条：玻璃改成"虹彩档"（粉→青→蓝渐变 + 更透）—— 钉住它 */
      glass: (() => {
        const cs = getComputedStyle(card);
        return {
          color: cs.backgroundColor,
          image: cs.backgroundImage,
        };
      })(),
    };
  });

const g0 = await geom();
if (!g0) {
  const dbg = await page.evaluate(() => ({
    ol: document.querySelectorAll("ol").length,
    ta: document.querySelectorAll("textarea").length,
    glass: document.querySelectorAll('[class*="glass-float"]').length,
    text: (document.body.innerText ?? "").replace(/\s+/g, " ").slice(0, 160),
  }));
  console.log("❌ 找不到消息区/输入框", JSON.stringify(dbg));
  await browser.close();
  process.exit(1);
}

console.log("=== 1. 输入框是**浮层**：消息区铺到它下面（不是被它占掉一行）===");
/* 输入框的底边应当在滚动容器底边附近（浮在上面），而不是容器底边之上还留一行 */
check(
  `滚动容器一直铺到输入框底下（容器底 ${g0.scrollerBottom} ≥ 卡片底 ${g0.cardBottom} - 4）`,
  g0.scrollerBottom >= g0.cardBottom - 4,
);
check(
  `输入框确实和消息区**叠着**（卡片顶 ${g0.cardTop} < 容器底 ${g0.scrollerBottom}）`,
  g0.cardTop < g0.scrollerBottom,
);
check(`消息列表底部留了白（${g0.padBottom}px ≥ 卡片高 ${g0.cardH}px）`, g0.padBottom >= g0.cardH);

console.log("=== 1b. 玻璃是「虹彩档」（用户 m03024 第 1 条：再透一点 + 粉青蓝渐变）===");
check(
  `自带一层渐变（不是纯色）`,
  /linear-gradient/.test(g0.glass.image),
);
check(
  `粉 / 青 / 蓝 三色都在（${g0.glass.image.slice(0, 60)}…）`,
  /243,\s*164,\s*197/.test(g0.glass.image) &&
    /167,\s*219,\s*228/.test(g0.glass.image) &&
    /168,\s*186,\s*240/.test(g0.glass.image),
);
/* color-mix(… 72%, transparent) 算出来是 rgba(..., 0.72) —— 比原来 82% 更透 */
check(
  `底色降到 72%（现在 ${g0.glass.color}）`,
  /0\.72\)/.test(g0.glass.color.replace(/\s/g, "")),
);

console.log("=== 2. 滚动消息：一条条从输入框**下面**过去，输入框不动 ===");
const mid = Math.round((g0.scrollH - g0.clientH) / 3);
await page.evaluate((top) => {
  const ol = document.querySelector("ol");
  ol.parentElement.scrollTop = top;
}, mid);
await page.waitForTimeout(400);
const g1 = await geom();
check(
  `滑动后输入框坐标没动（顶 ${g0.cardTop} → ${g1.cardTop}）`,
  Math.abs(g1.cardTop - g0.cardTop) <= 1,
);
check(
  `消息真的滚了（scrollTop ${g0.scrollTop} → ${g1.scrollTop}）`,
  Math.abs(g1.scrollTop - g0.scrollTop) > 20,
);

/* 有没有消息正处在"和输入框重叠"的位置（= 它从输入框下面过去） */
const overlapping = await page.evaluate(() => {
  const ol = document.querySelector("ol");
  const ta = document.querySelector("textarea");
  let card = ta;
  while (card && !/glass-(float|panel)/.test((card.className ?? "").toString()))
    card = card.parentElement;
  const rc = card.getBoundingClientRect();
  return [...ol.querySelectorAll("li")].some((li) => {
    const r = li.getBoundingClientRect();
    return r.top < rc.bottom && r.bottom > rc.top;
  });
});
check("此刻有消息正从输入框那一层经过（重叠）", overlapping);
/* 留一张"消息正从对话框下面过"的样子：看玻璃够不够实（字要看得清）
   先往下挪 70px，让一整行字**落在卡片中间**（不是压在卡片上沿），这样才看得出透不透 */
await page.evaluate(() => {
  const box = document.querySelector("[data-testid='composer-layer']") ?? null;
  void box;
  const el = document.querySelectorAll("ol")[0];
  if (el) el.scrollTop += 70;
});
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/float-composer-mid.png" });

console.log("=== 3. 最后一条仍然滑得出来（不被浮层盖住）===");
await page.evaluate(() => {
  const ol = document.querySelector("ol");
  const s = ol.parentElement;
  s.scrollTop = s.scrollHeight;
});
await page.waitForTimeout(500);
const g2 = await geom();
check(
  `滑到底后最后一条的底边在输入框顶边之上（${g2.lastBottom} ≤ ${g2.cardTop}）`,
  g2.lastBottom <= g2.cardTop + 1,
);
await page.screenshot({ path: "shots/float-composer.png" });

console.log("=== 4. 控制台 / 运行时报错 ===");
check("没有页面报错", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log("--------------------------------------------------------------------------");
console.log(bad === 0 ? "全部通过（0 个失败）" : `有 ${bad} 个失败`);
process.exit(bad === 0 ? 0 : 1);
