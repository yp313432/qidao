/**
 * 探针：**走原生 `tools` 之后，系统提示词到底省了多少**。
 *
 * 为什么要单独量：P2 的主要收益是"动作清单不用在提示词里再写一遍"
 * （定义改由上游的 `tools` 参数结构化携带）。但"省了多少"不能靠感觉 ——
 * 这里直接调 App 自己的 `systemPrompt()` + `estimateTokens()` 量出来。
 *
 * 量三份：
 *   ① 老协议（带工具清单）：nativeTools=false
 *   ② 原生 tools：nativeTools=true
 *   ③ 两者之差 = 这一次改动的真实收益
 *
 * 顺带量一下 61 个动作的 tools JSON 有多大 —— 它**每一轮都要发**，
 * 所以"省了提示词"不等于"整体省了"，两个数都要看（别拿一个数当结论）。
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
  const { actionTools } = await import("/src/lib/action-schema.ts");

  const base = {
    style: "default",
    tools: [],
    name: "yan",
    aiName: "星芒",
    persona: "",
    worldAlways: [],
    permissions: {},
  };
  const legacy = systemPrompt({ ...base, nativeTools: false });
  const native = systemPrompt({ ...base, nativeTools: true });
  const tools = actionTools();
  const toolsJson = JSON.stringify(tools);
  return {
    legacy: { chars: legacy.length, tokens: estimateTokens(legacy) },
    native: { chars: native.length, tokens: estimateTokens(native) },
    toolsCount: tools.length,
    toolsJson: { chars: toolsJson.length, tokens: estimateTokens(toolsJson) },
  };
});

const pad = (s, n) => String(s).padEnd(n, " ");
console.log("块".padEnd(28) + pad("字符", 8) + pad("token", 10));
console.log("-".repeat(48));
console.log("老协议（提示词带动作清单）".padEnd(24) + pad(out.legacy.chars, 8) + pad(out.legacy.tokens, 10));
console.log("原生 tools（提示词只留规则）".padEnd(23) + pad(out.native.chars, 8) + pad(out.native.tokens, 10));
console.log("-".repeat(48));
console.log(
  "提示词省下".padEnd(26) +
    pad(out.legacy.chars - out.native.chars, 8) +
    pad(out.legacy.tokens - out.native.tokens, 10),
);
console.log(
  `\n但 tools 这份定义每轮都要发：${out.toolsCount} 个动作 = ${out.toolsJson.chars} 字符 ≈ ${out.toolsJson.tokens} token`,
);
console.log("→ 所以「提示词省的那部分」和「tools 多花的那部分」要一起看，别只报一边。");

await browser.close();
