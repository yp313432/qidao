import { chromium, devices } from "playwright";

/**
 * 验收（用户 m03996）：
 *
 *   "能不能把对话框的的彩色渐变效果改成可选择的啊，就是我任选几种颜色组成渐变，
 *    这样我换背景时，他能搭起来咋样"
 *
 * 三件事：
 *   ① 没设置过 → 还是原来那套粉青蓝（老存档不能变样）；
 *   ② 设置里存了三种颜色 → 输入框那层渐变真的变成那三种（读设置 → CSS 变量 → 计算样式）；
 *   ③ 在「我的 → 个性化」点一个预设 → 不用重启就变（`--q-tint-1` 立刻变）。
 *
 * 跑法：node verify-composer-tint.mjs（要先有 dev server：npm run dev）
 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";

let bad = 0;
const check = (name, pass, extra = "") => {
  if (!pass) bad++;
  console.log(`  ${pass ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`);
};

const now = Date.now();
const conversation = {
  state: {
    conversations: [
      {
        id: "conv-tint",
        title: "配色验收",
        messages: [
          {
            id: "u1",
            role: "user",
            content: "你好",
            thinking: "",
            thinkingDurationMs: 0,
            createdAt: now - 2000,
          },
          {
            id: "a1",
            role: "assistant",
            content: "在。",
            thinking: "",
            thinkingDurationMs: 0,
            createdAt: now - 1000,
          },
        ],
        createdAt: now - 600000,
        updatedAt: now,
        pinned: false,
        incognito: false,
      },
    ],
    activeId: "conv-tint",
    settings: { displayName: "yan", aiName: "星芒", showThinking: false, chatFontSize: "normal" },
  },
  version: 1,
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

/** 造一个上下文：可选地把 settings.composerTint 预置进存档（模拟"上次挑好的颜色"） */
const makePage = async (tint) => {
  const snap = tint
    ? {
        ...conversation,
        state: {
          ...conversation.state,
          settings: { ...conversation.state.settings, composerTint: tint },
        },
      }
    : conversation;
  const ctx = await browser.newContext({
    ...devices["Pixel 7"],
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  await page.addInitScript((s) => {
    const req = indexedDB.open("qidao-store", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
    };
    req.onsuccess = () => {
      /* ⚠️ 只在**还没有存档**时写入：addInitScript 每次导航都会跑一遍，
         无条件 write 会在第 3 段"点预设后重载"时把刚存的颜色覆盖回初始快照。 */
      const st = req.result.transaction("kv", "readwrite").objectStore("kv");
      const got = st.get("aster-app");
      got.onsuccess = () => {
        if (!got.result) st.put(JSON.stringify(s), "aster-app");
      };
    };
  }, snap);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined, {
    timeout: 60000,
  });
  await page.waitForTimeout(1200);
  return { ctx, page };
};

/** 输入框那张卡（.glass-float）实际生效的 background-image + 三个 CSS 变量 */
const readTint = (page) =>
  page.evaluate(() => {
    const ta = document.querySelector("textarea");
    let card = ta;
    while (card && !/glass-float/.test((card.className ?? "").toString())) card = card.parentElement;
    const cs = getComputedStyle(document.documentElement);
    return {
      image: card ? getComputedStyle(card).backgroundImage : null,
      vars: ["--q-tint-1", "--q-tint-2", "--q-tint-3"].map((n) => cs.getPropertyValue(n).trim()),
    };
  });

/* ═══════════════ 1. 没设置过 = 默认粉青蓝 ═══════════════ */
console.log("=== 1. 没设置过：还是原来那套粉青蓝 ===");
{
  const { ctx, page } = await makePage(null);
  const t = await readTint(page);
  check(
    "默认渐变里是粉/青/蓝三色",
    Boolean(
      t.image &&
        /243,\s*164,\s*197/.test(t.image) &&
        /167,\s*219,\s*228/.test(t.image) &&
        /168,\s*186,\s*240/.test(t.image),
    ),
    (t.image ?? "").slice(0, 80),
  );
  await ctx.close();
}

/* ═══════════════ 2. 存档里挑了三种颜色 → 渐变跟着变 ═══════════════ */
console.log("=== 2. 存档里挑的三种颜色（#ff6b6b / #5ee7c1 / #7c9bff）===");
{
  const { ctx, page } = await makePage(["#ff6b6b", "#5ee7c1", "#7c9bff"]);
  const t = await readTint(page);
  check("三段变量都写进去了", t.vars.every((v) => v.startsWith("rgba(")), t.vars.join(" | "));
  check(
    "渐变第一段 = #ff6b6b @0.34",
    Boolean(t.image && /255,\s*107,\s*107,\s*0\.34/.test(t.image)),
    t.vars[0],
  );
  check(
    "渐变第二段 = #5ee7c1 @0.28",
    Boolean(t.image && /94,\s*231,\s*193,\s*0\.28/.test(t.image)),
    t.vars[1],
  );
  check(
    "渐变第三段 = #7c9bff @0.34",
    Boolean(t.image && /124,\s*155,\s*255,\s*0\.34/.test(t.image)),
    t.vars[2],
  );
  await ctx.close();
}

/* ═══════════════ 3. 在「我的 → 个性化」点预设 → 立刻生效 ═══════════════ */
console.log("=== 3. 设置页点「薄荷海」预设，不重启就生效 ===");
{
  const { ctx, page } = await makePage(null);
  /* 「个性化」在 /space（我的空间）里，不是 /me（那是入口列表） */
  await page.goto(`${BASE}/space`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  const preset = page.getByRole("button", { name: /薄荷海/ }).first();
  check("设置页里有「对话框玻璃配色」的预设按钮", (await preset.count()) > 0);
  if ((await preset.count()) > 0) {
    await preset.click();
    /* 等 zustand persist 落盘（实测 ~1s 内写进 IDB；写盘前就整页重载会读回旧值） */
    await page.waitForTimeout(1800);
    /* /space 上没有 textarea，回对话页再量输入框那张卡的渐变（同一个 document 的 CSS 变量跟着走） */
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const t = await readTint(page);
    check(
      "点完以后 --q-tint-1 变成薄荷绿 #9be3c8",
      /155,\s*227,\s*200/.test(t.vars[0]),
      t.vars[0],
    );
    check(
      "输入框渐变也跟着变了（不用重启）",
      Boolean(t.image && /155,\s*227,\s*200/.test(t.image)),
      (t.image ?? "").slice(0, 80),
    );
  }
  await page.screenshot({ path: "shots/composer-tint.png" });
  await ctx.close();
}

await browser.close();
console.log("-".repeat(74));
if (bad === 0) console.log("全部通过（0 个失败）");
else console.log(`${bad} 个失败`);
process.exit(bad === 0 ? 0 : 1);
