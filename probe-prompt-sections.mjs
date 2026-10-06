/**
 * 探针：**系统提示词现在是哪几块、每块多少、哪块已经过期**。
 *
 * 为什么单独一个（`probe-prompt-size.mjs` 是"一块块加"的看法，这个按**段落**看）：
 * 用户问"系统提示词怎么改"时，答案不能靠感觉 —— 得先知道钱花在哪一段、
 * 哪一段的内容**和代码对不上**（过期的说明书比长了更糟：它会让模型否认自己已经会的能力）。
 *
 * 跑法（要完整权限；dev server 要在 8080）：
 *   node probe-prompt-sections.mjs
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

  const base = {
    style: "default",
    tools: [],
    name: "yan",
    aiName: "星芒",
    persona: "",
    worldAlways: [],
    permissions: {},
  };
  const text = systemPrompt({ ...base, nativeTools: true, selectiveTools: true });
  /** 按【】标题切块（第一块是标题前的引子） */
  const parts = text.split(/(?=【)/g).map((s) => s.trim()).filter(Boolean);
  return {
    total: { chars: text.length, tokens: estimateTokens(text) },
    parts: parts.map((p) => {
      const title = (p.match(/^【[^】]*】/) ?? ["（引子）"])[0];
      return { title, chars: p.length, tokens: estimateTokens(p), body: p.slice(0, 260) };
    }),
  };
});

console.log(`系统提示词合计：${out.total.chars} 字符 ≈ ${out.total.tokens} token\n`);
console.log("段".padEnd(40) + "字符".padEnd(8) + "token");
console.log("-".repeat(60));
for (const p of out.parts) {
  console.log(p.title.slice(0, 38).padEnd(40) + String(p.chars).padEnd(8) + p.tokens);
}

await browser.close();
