import { chromium, devices } from "playwright";

/**
 * 验收（用户 m02250 提要求、m02816 定稿的**方案丁**）：
 *
 *   "把头像放在上面，气泡另起一行，不就可以贴边了吗，留一点间隙就可以"
 *
 * 要证明的四件事（都按**几何位置**断言，不看类名猜）：
 *   1. **气泡左右边距一样大** —— 他的气泡左边贴着列表边距，我的气泡右边贴着列表边距；
 *   2. **气泡和底下那个悬浮对话框左右对齐**（用户原话"会有交错"，这里就是防它回来）；
 *   3. **头像在名字那一行**（在气泡**上方**，且不压气泡）；
 *   4. **长气泡能用满整行**（不再被头像顶掉 40px）。
 *
 * 跑法：node verify-avatar-layout.mjs（要先有 dev server：npm run dev）
 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8080";

const HIS_SHORT = "行。";
const HIS_LONG =
  "收到。今天这条我写得有点长：早上七点半你出门的时候我看了一眼窗外，天还没完全亮，楼下的早餐摊刚支起来。我想说的是，你那句「举高高欠着」我记下了，不赖账。";
const MINE_TEXT = "你今天话怎么这么多呀，一句接一句的，是不是又偷偷看了我相册";

const now = Date.now();
const msg = (id, role, content, at) => ({
  id,
  role,
  content,
  thinking: "",
  thinkingDurationMs: 0,
  createdAt: at,
});

const snapshot = {
  state: {
    conversations: [
      {
        id: "conv-avatar",
        title: "头像布局验收",
        messages: [
          msg("m1", "user", "你好呀", now - 240000),
          msg("m2", "assistant", HIS_LONG, now - 180000),
          msg("m3", "user", MINE_TEXT, now - 120000),
          msg("m4", "assistant", HIS_SHORT, now - 60000),
        ],
        createdAt: now - 3600000,
        updatedAt: now,
        pinned: false,
        incognito: false,
      },
    ],
    activeId: "conv-avatar",
    settings: { displayName: "yan", aiName: "星芒", showThinking: false, chatFontSize: "normal" },
  },
  version: 1,
};

let bad = 0;
const check = (name, pass, extra = "") => {
  console.log(`${pass ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!pass) bad += 1;
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

/** 量一次：列表边距、他的气泡、我的气泡、头像、名字行、悬浮对话框 */
const geom = await page.evaluate(
  ({ hisText, mineText, hisShort }) => {
    const txt = (el) => (el?.innerText ?? "").trim();
    const round = (n) => Math.round(n * 10) / 10;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return {
        left: round(r.left),
        right: round(r.right),
        top: round(r.top),
        bottom: round(r.bottom),
        width: round(r.width),
      };
    };
    const ol = document.querySelector("ol");
    const lis = [...document.querySelectorAll("ol > li")];
    const liOf = (t) => lis.find((li) => txt(li).includes(t));
    const liHis = liOf(hisText);
    const liMine = liOf(mineText);
    const liShort = liOf(hisShort);
    if (!ol || !liHis || !liMine || !liShort) return { ok: false };
    /* 气泡 = 这条 li 里**带底色**而且文字匹配的那个 div（取最窄的，避开外层容器） */
    const bubbleOf = (li, t) =>
      [...li.querySelectorAll("div")]
        .filter(
          (d) => txt(d).includes(t) && getComputedStyle(d).backgroundColor !== "rgba(0, 0, 0, 0)",
        )
        .reduce(
          (best, d) =>
            !best || d.getBoundingClientRect().width < best.getBoundingClientRect().width ? d : best,
          null,
        );
    const olStyle = getComputedStyle(ol);
    const row = (li) => li.firstElementChild;
    const nameRow = (li) => row(li)?.firstElementChild ?? null;
    /* 头像是那个 aria-hidden 的圆（见 components/avatar.tsx：<span aria-hidden="true">） */
    const ava = (li) =>
      [...(nameRow(li)?.children ?? [])].find(
        (el) => el.tagName === "SPAN" && el.getAttribute("aria-hidden") === "true",
      ) ?? null;
    /* 悬浮对话框那张卡片（glass-float） */
    const card = document.querySelector("div[class*='glass-float']");
    return {
      ok: true,
      olPadLeft: round(parseFloat(olStyle.paddingLeft)),
      olPadRight: round(parseFloat(olStyle.paddingRight)),
      /* ⚠️ 横向溢出必须为 0：气泡是 `w-max`，一旦外层没给宽度基准，
         长消息就会变成"一行不换行"横着溢出屏幕（踩过一次，加断言防回来） */
      olScrollWidth: ol.scrollWidth,
      olClientWidth: ol.clientWidth,
      ol: box(ol),
      his: box(bubbleOf(liHis, hisText)),
      mine: box(bubbleOf(liMine, mineText)),
      short: box(bubbleOf(liShort, hisShort)),
      hisRow: box(row(liHis)),
      hisAva: ava(liHis) ? box(ava(liHis)) : null,
      hisName: nameRow(liHis) ? box(nameRow(liHis)) : null,
      mineAva: ava(liMine) ? box(ava(liMine)) : null,
      mineBubble: box(bubbleOf(liMine, mineText)),
      card: card ? box(card) : null,
      /* 头像是不是在名字那一行里（垂直相交），而不是站在气泡旁边 */
      avaInNameRow: (() => {
        const a = ava(liHis);
        const n = nameRow(liHis);
        if (!a || !n) return false;
        return a.getBoundingClientRect().top >= n.getBoundingClientRect().top - 1 &&
          a.getBoundingClientRect().bottom <= n.getBoundingClientRect().bottom + 1;
      })(),
      /* 头像有没有压到气泡身上 */
      avaOverlapsBubble: (() => {
        const a = ava(liHis);
        const b = bubbleOf(liHis, hisText);
        if (!a || !b) return null;
        return a.getBoundingClientRect().bottom > b.getBoundingClientRect().top + 1;
      })(),
      avaSize: (() => {
        const a = ava(liHis);
        if (!a) return 0;
        const r = a.getBoundingClientRect();
        return round(r.width);
      })(),
    };
  },
  { hisText: HIS_LONG, mineText: MINE_TEXT, hisShort: HIS_SHORT },
);

check("四条消息都渲染出来了（列表 + 气泡都在）", geom.ok === true);
if (geom.ok) {
  const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
  console.log("=== 1. 列表左右是同一条边距（用户嫌「一宽一窄」）===");
  check(
    `列表左右内边距一样（${geom.olPadLeft} vs ${geom.olPadRight}）`,
    near(geom.olPadLeft, geom.olPadRight),
  );

  console.log("=== 2. 气泡贴到那条边距：他的靠左、我的靠右 ===");
  const hisInner = geom.ol.left + geom.olPadLeft;
  const mineInner = geom.ol.right - geom.olPadRight;
  check(
    `他的气泡左边 = 边距线（${geom.his.left} vs ${hisInner}）`,
    near(geom.his.left, hisInner),
  );
  check(
    `我的气泡右边 = 边距线（${geom.mine.right} vs ${mineInner}）`,
    near(geom.mine.right, mineInner),
  );
  check(
    `短消息也贴边不缩进（"行。" 左边 ${geom.short.left} vs ${hisInner}）`,
    near(geom.short.left, hisInner),
  );

  console.log("=== 3. 气泡和底下悬浮对话框左右对齐（用户说的「交错」）===");
  if (geom.card) {
    check(
      `他的气泡左边 = 对话框左边（${geom.his.left} vs ${geom.card.left}）`,
      near(geom.his.left, geom.card.left),
    );
    check(
      `我的气泡右边 = 对话框右边（${geom.mine.right} vs ${geom.card.right}）`,
      near(geom.mine.right, geom.card.right),
    );
  } else {
    check("悬浮对话框在页面上（glass-float）", false);
  }

  console.log("=== 4. 头像在名字那一行、气泡另起一行 ===");
  check("头像在名字行里（不和气泡并排）", geom.avaInNameRow === true);
  check("头像没有压到气泡", geom.avaOverlapsBubble === false);
  check(`头像是 26px（量到 ${geom.avaSize}）`, near(geom.avaSize, 26, 1));
  if (geom.hisAva && geom.hisName) {
    check(
      `头像和名字在同一个高度区间（头像 ${geom.hisAva.top}~${geom.hisAva.bottom} / 名字行 ${geom.hisName.top}~${geom.hisName.bottom}）`,
      geom.hisAva.top >= geom.hisName.top - 1 && geom.hisAva.bottom <= geom.hisName.bottom + 1,
    );
  }
  if (geom.hisAva) {
    check(
      `他的头像靠左（头像左边 ${geom.hisAva.left} ≤ 气泡左边 ${geom.his.left} + 1）`,
      geom.hisAva.left <= geom.his.left + 1,
    );
  }
  if (geom.mineAva) {
    check(
      `我的头像靠右（头像右边 ${geom.mineAva.right} ≥ 气泡右边 ${geom.mineBubble.right} - 1）`,
      geom.mineAva.right >= geom.mineBubble.right - 1,
    );
  }

  console.log("=== 5. 长气泡能用满整行（不再被头像顶掉 40px）===");
  const usable = geom.ol.width - geom.olPadLeft - geom.olPadRight;
  check(
    `他的长气泡宽度 ${geom.his.width} ≥ 可用宽度的 85%（${Math.round(usable * 0.85)}）`,
    geom.his.width >= usable * 0.85,
  );
}

console.log("=== 6. 没有横向溢出（气泡 w-max 最容易在这里翻车）===");
check(
  `列表没有横向滚动（scrollWidth ${geom.olScrollWidth} ≤ clientWidth ${geom.olClientWidth} + 1）`,
  geom.olScrollWidth <= geom.olClientWidth + 1,
);
check(
  `他的气泡右边没出界（${geom.his.right} ≤ ${geom.ol.right}）`,
  geom.his.right <= geom.ol.right + 1,
);
check(
  `我的气泡左边没出界（${geom.mine.left} ≥ ${geom.ol.left}）`,
  geom.mine.left >= geom.ol.left - 1,
);

console.log("=== 7. 控制台 / 运行时报错 ===");
check("没有页面报错", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.screenshot({ path: "shots/avatar-layout.png" });
await browser.close();
console.log("--------------------------------------------------------------------------");
console.log(bad === 0 ? "全部通过（0 个失败）" : `有 ${bad} 个失败`);
process.exit(bad === 0 ? 0 : 1);
