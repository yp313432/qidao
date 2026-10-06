/**
 * 探针：**走原生 `tools` 之后，系统提示词和 tools 各占多少、按需注册省了多少**。
 *
 * 为什么必须量（不量就是自欺）：P2 结束时实测过一笔账 ——
 *   · 提示词省了 2023 token（动作清单不再写第二遍）
 *   · 但 61 个动作的 tools 定义**每轮要发 ≈ 4007** → 净多花
 * P3（按需注册）要治的就是后面那一半。这里量三样：
 *   ① 系统提示词：老协议 / 原生 / 原生+按需（多出来的那份"动作名清单"也要算进去）
 *   ② 一句句真句子下，tools 的 token 数（按需 vs 全发）
 *   ③ 净账：相对老协议，到底省没省
 *
 * 跑法（要完整权限；dev server 要在 8080）：
 *   node probe-native-savings.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1200);

const out = await page.evaluate(async () => {
  const { systemPrompt } = await import("/src/lib/prompt.ts");
  const { estimateTokens } = await import("/src/lib/tokens.ts");
  const { ACTION_SCHEMA, ACTION_GROUP_OF, actionToolsFor } = await import(
    "/src/lib/action-schema.ts"
  );
  const { selectActionKinds } = await import("/src/lib/tool-select.ts");

  const base = {
    style: "default",
    tools: [],
    name: "yan",
    aiName: "星芒",
    persona: "",
    worldAlways: [],
    permissions: {},
  };
  const legacyPrompt = systemPrompt({ ...base, nativeTools: false });
  const nativePrompt = systemPrompt({ ...base, nativeTools: true });
  const selectivePrompt = systemPrompt({
    ...base,
    nativeTools: true,
    selectiveTools: true,
  });

  const allKinds = ACTION_SCHEMA.map((a) => a.kind);
  const allTools = actionToolsFor(allKinds);
  const allJson = JSON.stringify(allTools);

  /** 拿几句"真句子"看按需挑出几个（挑的都是平时最常说的） */
  const cases = [
    "帮我写今天的日记，顺便放首歌",
    "七点半叫我起床",
    "陪我下一局五子棋",
    "把主题换成深色的",
    "查一下杭州天气",
    "嗯，就这样",
  ];
  const rows = cases.map((text) => {
    const r = selectActionKinds({
      text,
      allKinds,
      groupOf: ACTION_GROUP_OF,
      enabled: true,
    });
    const json = JSON.stringify(actionToolsFor(r.kinds));
    return {
      text,
      count: r.kinds.length,
      groups: r.groups,
      tokens: estimateTokens(json),
    };
  });

  const size = (s) => ({ chars: s.length, tokens: estimateTokens(s) });
  return {
    legacyPrompt: size(legacyPrompt),
    nativePrompt: size(nativePrompt),
    selectivePrompt: size(selectivePrompt),
    allTools: { count: allTools.length, ...size(allJson) },
    rows,
  };
});

const pad = (s, n) => String(s).padEnd(n, " ");
console.log("【一】系统提示词（每轮都发）");
console.log("块".padEnd(30) + pad("字符", 8) + pad("token", 10));
console.log("-".repeat(48));
console.log("老协议（提示词带动作清单）".padEnd(26) + pad(out.legacyPrompt.chars, 8) + pad(out.legacyPrompt.tokens, 10));
console.log("原生 tools（只留规则）".padEnd(25) + pad(out.nativePrompt.chars, 8) + pad(out.nativePrompt.tokens, 10));
console.log(
  "原生 + 按需（多一份动作名清单）".padEnd(26) +
    pad(out.selectivePrompt.chars, 8) +
    pad(out.selectivePrompt.tokens, 10),
);

console.log("\n【二】tools 定义（每轮都要发 —— P3 砍的是这一块）");
console.log("全发".padEnd(30) + pad(`${out.allTools.count} 个`, 10) + pad("", 8) + pad(out.allTools.tokens, 10));
console.log("-".repeat(48));
for (const r of out.rows) {
  console.log(
    `「${r.text}」`.padEnd(24) +
      pad(`${r.count} 个`, 10) +
      pad(`${r.tokens} token`, 12) +
      `命中：${r.groups.join("、") || "（全发）"}`,
  );
}

console.log("\n【三】净账（相对老协议，每轮多花/省下多少 token）");
const promptDelta = out.selectivePrompt.tokens - out.legacyPrompt.tokens;
console.log(`提示词：${promptDelta >= 0 ? "+" : ""}${promptDelta}`);
for (const r of out.rows) {
  const net = promptDelta + r.tokens - 0;
  console.log(`  「${r.text}」 → ${net >= 0 ? "+" : ""}${net}（tools ${r.tokens}）`);
}
console.log(
  "\n（老协议不发 tools。所以「净账」= 提示词变化 + tools token；负数 = 真的省了）",
);
console.log(
  `全发时的净账：${promptDelta + out.allTools.tokens >= 0 ? "+" : ""}${
    promptDelta + out.allTools.tokens
  } ← 这就是 P3 之前的状态（净多花）`,
);

await browser.close();
