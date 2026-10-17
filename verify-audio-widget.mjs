import { chromium, devices } from "playwright";

/**
 * 验收（用户 m03024 第 5 条）：**全局音频悬浮窗**。
 *
 *   "把音乐播放器（本地 + 外链）改成一个全局的音频悬浮窗：离开主界面后音频后台播放，
 *    并自动最小化为一个悬浮球（旋转的唱片 icon）；点击悬浮球，以弹性动画展开成横向的
 *    胶囊迷你播放条；点击该播放条上的 ✕，需**销毁悬浮窗并彻底终止音频后台播放**
 *    （不是把 UI v-if 掉）……小球不能遮挡底部导航，允许拖拽贴边。"
 *
 * 这条最容易被"看起来做完了"骗过去的地方是**✕**：只把 DOM 藏起来，声音还在响。
 * 所以这里所有断言都咬在**真东西**上：
 *   · ✕ 之后 `<audio>` 的 `src` 是不是**真的空了**、`paused` 是不是 true、`dataset.track` 有没有清；
 *   · ✕ 之后外链那个 `<iframe>` 是不是**真的从 DOM 里卸载了**；
 *   · 小球位置是不是真的离导航有距离（几何，不看类名）。
 *
 * 跑法：node verify-audio-widget.mjs（要先有 dev server：npm run dev）
 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

let bad = 0;
const check = (name, pass, extra = "") => {
  if (!pass) bad++;
  console.log(`  ${pass ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`);
};

/* ───────── 造一段 0.8 秒的静音 WAV（8kHz / 8bit / 单声道）当"本地曲目" ─────────
   真去点一个不存在的文件会变成"播不了"的错误路径，测不到播放态。 */
function silentWav(seconds = 0.8, rate = 8000) {
  const samples = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + samples);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // fmt 块长度
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 单声道
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28); // 字节率（8bit 单声道 = rate）
  buf.writeUInt16LE(1, 32); // 块对齐
  buf.writeUInt16LE(8, 34); // 位深
  buf.write("data", 36);
  buf.writeUInt32LE(samples, 40);
  buf.fill(0x80, 44); // 8bit 无符号的静音是 0x80
  return buf.toString("base64");
}

/* ⚠️ 时长必须够长：一开始用 0.8 秒，点击后 3 秒再断言时它**已经播完了**
   （`currentTime === duration` → `paused === true`），看起来像"没播起来"，其实是测试自己太短。 */
const WAV_B64 = silentWav(30);
const TRACK_NAME = "验收测试曲";

const now = Date.now();
const snapshot = {
  state: {
    conversations: [
      {
        id: "conv-audio",
        title: "悬浮窗验收",
        messages: [
          {
            id: "m1",
            role: "user",
            content: "先把歌放上，我切页面看看会不会断。",
            thinking: "",
            thinkingDurationMs: 0,
            createdAt: now - 60000,
          },
          {
            id: "m2",
            role: "assistant",
            content: "播放器是全局的，切页面不会断。",
            thinking: "",
            thinkingDurationMs: 0,
            createdAt: now - 30000,
          },
        ],
        createdAt: now - 600000,
        updatedAt: now,
        pinned: false,
        incognito: false,
      },
    ],
    activeId: "conv-audio",
    settings: { displayName: "yan", aiName: "星芒", showThinking: false, chatFontSize: "normal" },
    /* 外链先挂上（外链只要"挂着"就该显示悬浮窗，声音在 iframe 里我们管不着） */
    musicEmbeds: [
      {
        id: "embed-test",
        service: "netease",
        serviceLabel: "网易云",
        kind: "song",
        sourceId: "1",
        embedUrl: "about:blank",
        height: 86,
        sourceUrl: "https://music.163.com/song?id=1",
        addedAt: now,
      },
    ],
    currentEmbedId: "embed-test",
  },
  version: 1,
};

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.addInitScript(
  ({ snap, wav, name }) => {
    /* ① App 状态（对话 + 设置 + 外链）*/
    const req = indexedDB.open("qidao-store", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
    };
    req.onsuccess = () => {
      const tx = req.result.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(snap), "aster-app");
    };
    /* ② 本地曲库（qidao-music/tracks，keyPath=id）*/
    const bin = atob(wav);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "audio/wav" });
    const mreq = indexedDB.open("qidao-music", 1);
    mreq.onupgradeneeded = () => {
      if (!mreq.result.objectStoreNames.contains("tracks"))
        mreq.result.createObjectStore("tracks", { keyPath: "id" });
    };
    mreq.onsuccess = () => {
      const tx = mreq.result.transaction("tracks", "readwrite");
      tx.objectStore("tracks").put({
        id: "t1",
        name,
        size: blob.size,
        type: "audio/wav",
        addedAt: Date.now(),
        blob,
        lyrics: "",
        lyricsSource: "none",
      });
    };
  },
  { snap: snapshot, wav: WAV_B64, name: TRACK_NAME },
);

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

const boot = async (path = "/") => {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.theme !== undefined, {
    timeout: 60000,
  });
  await page.waitForTimeout(1200);
};

/** 悬浮球 / 胶囊的几何 */
const geom = () =>
  page.evaluate(() => {
    const orb = document.querySelector('[aria-label="展开播放条"]');
    const close = document.querySelector('[aria-label="关闭并停止播放"]');
    const nav = document.querySelector("nav");
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    return {
      orb: box(orb),
      close: box(close),
      nav: box(nav),
      capsuleText: close ? (close.parentElement?.innerText ?? "") : "",
      iframes: document.querySelectorAll("iframe").length,
    };
  });

const audioState = () =>
  page.evaluate(() => {
    const el = document.querySelector("audio");
    if (!el) return null;
    return { src: el.getAttribute("src"), paused: el.paused, track: el.dataset.track ?? null };
  });

/* ═══════════════ 1. 外链在放着：离开音乐页就该有小球 ═══════════════ */
console.log("=== 1. 外链挂着 → 对话页上有悬浮球 ===");
await boot("/");
let g = await geom();
check("对话页上出现了悬浮球", Boolean(g.orb));
check(
  "小球是小的（46px）",
  Boolean(g.orb && Math.abs(g.orb.width - 46) < 2 && Math.abs(g.orb.height - 46) < 2),
  g.orb ? `${Math.round(g.orb.width)}x${Math.round(g.orb.height)}` : "",
);
check("一进来是**最小化**的（没有胶囊）", !g.close);
check("外链 iframe 挂着（声音在它里面）", g.iframes >= 1, `iframe=${g.iframes}`);
/* 不遮底部导航：球的下沿要**在导航上沿之上** */
check(
  "小球没压到底部导航",
  Boolean(g.orb && g.nav && g.orb.bottom <= g.nav.top + 1),
  g.orb && g.nav ? `球底 ${Math.round(g.orb.bottom)} ≤ 导航顶 ${Math.round(g.nav.top)}` : "",
);

/* ═══════════════ 2. 点小球 → 展开成胶囊 ═══════════════ */
console.log("=== 2. 点一下小球 → 横向胶囊播放条 ===");
await page.click('[aria-label="展开播放条"]');
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/audio-widget-capsule.png" });
g = await geom();
check("展开出了胶囊（有 ✕ 按钮）", Boolean(g.close));
check("胶囊里写着「外链」", /外链/.test(g.capsuleText), g.capsuleText.replace(/\s+/g, " ").slice(0, 40));
const cap = await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="关闭并停止播放"]');
  const card = btn?.parentElement?.getBoundingClientRect();
  const nav = document.querySelector("nav")?.getBoundingClientRect();
  return card ? { w: card.width, h: card.height, bottom: card.bottom, navTop: nav?.top ?? null } : null;
});
check(
  "胶囊形状（宽是高的 3~9 倍，横向的）",
  Boolean(cap && cap.w / cap.h > 3 && cap.w / cap.h < 9),
  cap ? `${Math.round(cap.w)}x${Math.round(cap.h)}` : "",
);
check(
  "胶囊也在导航上面",
  Boolean(cap && cap.navTop !== null && cap.bottom <= cap.navTop + 1),
  cap && cap.navTop !== null ? `胶囊底 ${Math.round(cap.bottom)} ≤ 导航顶 ${Math.round(cap.navTop)}` : "",
);

/* ═══════════════ 3. ✕ 之后：iframe 真的被卸载 ═══════════════ */
console.log("=== 3. ✕ = 真停（外链：iframe 整个卸载）===");
await page.click('[aria-label="关闭并停止播放"]');
await page.waitForTimeout(900);
g = await geom();
check("点 ✕ 之后悬浮窗整个消失", !g.orb && !g.close);
check("外链 iframe 已经卸载（0 个）", g.iframes === 0, `iframe=${g.iframes}`);
check("没有任何播放中的胶囊残留", !/播放中/.test(g.capsuleText));

/* ═══════════════ 4. 本地曲目：播放 → 离开音乐页 → 胶囊有播放控制 ═══════════════ */
console.log("=== 4. 本地曲目：音乐页上不显示，离开才出现 ===");
await boot("/play/listen");
await page.waitForTimeout(2000);
check("音乐库读到了本地曲目", await page.getByText(TRACK_NAME).first().isVisible());
await page.getByText(TRACK_NAME).first().click();
await page.waitForTimeout(2500);
console.log(`    现在在 ${new URL(page.url()).pathname}`);
g = await geom();
check("**正在音乐页上**：不显示悬浮球（不然挡歌词）", !g.orb && !g.close);
let a = await audioState();
check("音频真的在放（paused=false）", Boolean(a && a.paused === false), a ? `paused=${a.paused}` : "没有 <audio>");

/* ⚠️ **不能 `boot("/")`**（整页重载）：本地音频只活在当前这个 document 里，
   一重载 `<audio>` 就是全新的、`src` 空、`paused`，等于没在放。
   所以这里用**站内导航**：一路点返回钮退到有底部导航的那层（`/play` 保留导航），
   再点「对话」tab 回首页 —— 全程同一个 document，声音不断。 */
for (let i = 0; i < 3; i++) {
  if (await page.locator("nav").count()) break;
  const back = page.locator('header a[aria-label^="返回"]').first();
  if (!(await back.count())) break;
  await back.click();
  await page.waitForTimeout(1000);
}
await page.locator("nav").getByText("对话", { exact: true }).first().click();
await page.waitForTimeout(1600);
check("站内导航回到了对话页（没有整页重载）", new URL(page.url()).pathname === "/", page.url());
g = await geom();
check("回到对话页：小球又出现了（后台播放）", Boolean(g.orb));
await page.screenshot({ path: "shots/audio-widget-orb.png" });
await page.click('[aria-label="展开播放条"]');
await page.waitForTimeout(700);
g = await geom();
check("胶囊里是本地曲名", g.capsuleText.includes(TRACK_NAME), g.capsuleText.replace(/\s+/g, " ").slice(0, 40));
const hasPause = await page.locator('[aria-label="暂停"], [aria-label="播放"]').count();
const hasNext = await page.locator('[aria-label="下一首"]').count();
check("本地曲目才有的「暂停/播放」在", hasPause > 0);
check("本地曲目才有的「下一首」在", hasNext > 0);

/* ═══════════════ 5. 本地 ✕ = 真销毁（清 src，而不是只 pause）═══════════════ */
console.log("=== 5. ✕ = 真停（本地：清 src + load() + 清判重标记）===");
await page.click('[aria-label="关闭并停止播放"]');
await page.waitForTimeout(900);
a = await audioState();
g = await geom();
check("audio 的 src 被摘掉了（不是只 pause）", Boolean(a && !a.src), a ? `src=${JSON.stringify(a.src)}` : "没有 <audio>");
check("audio 处于 paused", Boolean(a && a.paused === true));
check("判重标记 dataset.track 清干净了", Boolean(a && !a.track), a ? `track=${a.track}` : "");
check("悬浮窗消失", !g.orb && !g.close);

/* ═══════════════ 6. 拖拽贴边（Edge Docking）═══════════════ */
console.log("=== 6. 小球能拖着走、松手吸到最近的边 ===");
/* 来源（本地/外链）无所谓，这一段只量位置和拖拽 */
await boot("/");
const before = (await geom()).orb;
check("起始贴在右边（12px）", Boolean(before && Math.abs(390 - before.right - 12) < 3), before ? `right=${Math.round(before.right)}` : "");
if (before) {
  const cx = before.left + before.width / 2;
  const cy = before.top + before.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  /* 要**拖过屏幕中线**才会吸到左边（第一次只挪了 120px，中线没过去 → 又吸回右边） */
  await page.mouse.move(30, cy - 160, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(800);
}
const after = (await geom()).orb;
check(
  "拖到了左半边 → 吸到左边 12px",
  Boolean(after && Math.abs(after.left - 12) < 3),
  after ? `left=${Math.round(after.left)}` : "",
);
check(
  "竖着的位置**跟手**（真的往上走了）",
  Boolean(after && before && after.top < before.top - 80),
  after && before ? `${Math.round(before.top)} → ${Math.round(after.top)}` : "",
);
check("拖完还是最小化的球（没被误当成点击展开）", !(await geom()).close);

/* ═══════════════ 7. 运行时报错 ═══════════════ */
console.log("=== 7. 控制台 / 运行时报错 ===");
check("没有页面报错", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log("-".repeat(74));
console.log(bad === 0 ? "全部通过（0 个失败）" : `有 ${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
