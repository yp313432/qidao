import { chromium, devices } from "playwright";

/**
 * 验收（用户 m04097）：
 *
 *   "动手这个字体超出屏幕外了，优化一下，看看还有哪里会出现这种情况，一起优化了"
 *
 * 截图里溢出的是「动手 N 次」明细里那段**一整行 JSON**（`{"ok":true,"interactive":true,…}`）——
 * 中间没有空格，默认换行断不开，整段顶出屏幕。
 *
 * 这个脚本做两件事：
 *   ① 造一批"最坏形状"的内容（长 JSON / 长 URL / 超长英文 / base64 串 / 长中文），
 *      把「动手」明细点开，看还有没有**任何元素**越过屏幕右边缘；
 *   ② 顺手扫几个主页面（对话 / 我的 / 工具 / 玩乐），一起兜住。
 *
 * 判定不看类名，只看**真实几何**：`getBoundingClientRect().right > innerWidth + 1`。
 * 跑法：node verify-overflow.mjs（要先有 dev server：npm run dev）
 */
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";

let bad = 0;
const check = (name, pass, extra = "") => {
  if (!pass) bad++;
  console.log(`  ${pass ? "✅" : "❌"} ${name}${extra ? " · " + extra : ""}`);
};

const now = Date.now();
const longJson =
  '{"ok":true,"interactive":true,"locked":false,"summary":"屏幕亮着，已解锁","foreground":"com.yanping.qidao","detail":{"app":"栖岛","package":"com.yanping.qidao","self":true},"battery":68,"charging":false,"network":"cellular","extra":"' +
  "x".repeat(160) +
  '"}';
const longUrl = `https://example.com/${"a-very-long-path-segment/".repeat(12)}?q=${"z".repeat(80)}`;
const longWord = "Pneumonoultramicroscopicsilicovolcanoconiosis".repeat(2);
const base64ish = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const messages = [
  {
    id: "a-tool",
    role: "assistant",
    content: "我动手看了三样：屏幕、前台 App、电量与网络。",
    thinking: "",
    thinkingDurationMs: 0,
    createdAt: now - 4000,
    rounds: [
      {
        round: 1,
        calls: [
          {
            name: "sense_screen",
            args: '{}',
            ok: true,
            kind: "sense.screen",
            category: "sense",
            notice: `✅ sense.screen · 按你的授权直接执行：${longJson}`,
            result: longJson,
          },
          {
            name: "sense_foreground",
            args: '{"verbose":true}',
            ok: true,
            kind: "sense.foreground",
            category: "sense",
            notice: `✅ sense.foreground · 按你的授权直接执行：${longJson}`,
            result: longJson,
          },
          {
            name: "sense_device",
            args: "{}",
            ok: false,
            kind: "sense.device",
            category: "sense",
            notice: `❌ sense.device · ${longUrl}`,
            result: longUrl,
          },
          {
            name: "some_really_long_tool_name_that_does_not_exist_at_all_in_this_app",
            args: `{"blob":"${base64ish}"}`,
            ok: false,
            kind: "",
            category: "unknown",
            notice: "",
            result: "",
          },
        ],
      },
    ],
  },
  {
    id: "a-longtext",
    role: "assistant",
    content: `几条最坏形状的文本：\n\n1) 超长单词：${longWord}\n2) 长 URL：${longUrl}\n3) base64：${base64ish}\n4) 一串很长的数字：${"1234567890".repeat(20)}`,
    thinking: "",
    thinkingDurationMs: 0,
    createdAt: now - 2000,
  },
];

const snapshot = {
  state: {
    conversations: [
      {
        id: "conv-overflow",
        title: "溢出验收 " + longWord.slice(0, 20),
        messages,
        createdAt: now - 600000,
        updatedAt: now,
        pinned: false,
        incognito: false,
      },
    ],
    activeId: "conv-overflow",
    settings: { displayName: "yan", aiName: "星芒", showThinking: true, chatFontSize: "normal" },
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
    !/ERR_BLOCKED_BY_RESPONSE|NotSameOrigin|favicon|net::ERR_|Failed to load resource|extensions\.js/.test(
      m.text(),
    )
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

/**
 * 扫当前页面所有可见元素，返回越过屏幕右/左边缘的（去重）。
 *
 * 跳过：display:none / 透明 / 尺寸过小（视觉上不占位），以及
 * **故意放到屏幕外**的东西（外链播放器的 iframe 宿主就是这么藏的，`left` 是很大的负数）。
 */
const scan = () =>
  page.evaluate(() => {
    const w = window.innerWidth;
    const rows = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("body *")) {
      const tag = el.tagName;
      if (tag === "IFRAME" || tag === "VIDEO" || tag === "AUDIO") continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.left < -600 || r.right > w + 600) continue; // 故意藏在屏幕外的宿主
      if (r.right <= w + 1 && r.left >= -1) continue;
      const key = tag + "." + String(el.className ?? "").slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        key,
        right: Math.round(r.right),
        left: Math.round(r.left),
        text: (el.textContent ?? "").replace(/\s+/g, " ").slice(0, 50),
      });
    }
    return {
      scrollW: Math.round(document.documentElement.scrollWidth),
      innerW: w,
      rows,
    };
  });

const report = async (label) => {
  const { scrollW, innerW, rows } = await scan();
  console.log(`  · ${label}: scrollWidth=${scrollW} (屏宽 ${innerW})`);
  for (const r of rows) console.log(`      ↳ ${r.key} right=${r.right} left=${r.left} 「${r.text}」`);
  return rows;
};

/* ═══════════════ 1. 对话页 + 把「动手」明细点开 ═══════════════ */
console.log("=== 1. 对话页：长 JSON / 长 URL / 超长单词 ===");
await boot("/");
let rows = await report("初始");
check("对话页没有元素越过屏幕", rows.length === 0, rows.map((r) => r.key).join(", "));

const toolBtn = page.getByRole("button", { name: /动手/ }).first();
const hasTool = (await toolBtn.count()) > 0;
check("「动手 N 次」胶囊在", hasTool);
if (hasTool) {
  await toolBtn.click();
  await page.waitForTimeout(500);
  rows = await report("点开「动手」明细后");
  check(
    "点开明细后也没有元素越过屏幕（长 JSON 换行了）",
    rows.length === 0,
    rows.map((r) => `${r.key}(right=${r.right})`).join(", "),
  );
  const { scrollW } = await scan();
  check("页面没有横向滚动条（scrollWidth 没被撑大）", scrollW <= 391, `scrollWidth=${scrollW}`);
  await page.screenshot({ path: "shots/overflow-tool.png" });
}

/* ═══════════════ 2. 其余主页面 ═══════════════ */
console.log("=== 2. 我的 / 工具 / 玩乐 ===");
for (const [label, path] of [
  ["我的", "/me"],
  ["工具", "/tools"],
  ["工具·MCP", "/tools/mcp"],
  ["玩乐", "/play"],
  ["听歌列表", "/play/listen"],
  ["小日子", "/play/space"],
  ["记忆", "/memory"],
  ["世界书", "/worldbook"],
  ["权限", "/permissions"],
]) {
  await boot(path);
  const pageRows = await report(label);
  check(`${label}没有元素越过屏幕`, pageRows.length === 0, pageRows.map((r) => r.key).join(", "));
}

/* ═══════════════ 3. 运行时报错 ═══════════════ */
console.log("=== 3. 控制台 / 运行时报错 ===");
check("没有页面报错", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log("-".repeat(74));
if (bad === 0) console.log("全部通过（0 个失败）");
else console.log(`${bad} 个失败`);
process.exit(bad === 0 ? 0 : 1);
