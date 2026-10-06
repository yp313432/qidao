/**
 * 把**系统提示词逐段拆开**，写成一份可读清单（每段多少 token + 全文）。
 *
 * 用户："那你把这些具体内容全都列出来，我看看有没有要缩减的"
 *
 * 做法：用 App 自己的 `systemPrompt()` 生成（**最小配置** —— 空人设/空世界书/无工具，
 * 这样出来的是"内置固定文案"，也就是他改不动、只能由我们砍的那部分），
 * 按 `【...】` 大标题切段，逐段量 token，全文写进 md。
 *
 * ⚠️ 输出写到**仓库外**的 qidao-docs/（里面可能有用户的人设/世界书，不能进公开仓库）。
 *
 * 跑法：node dump-prompt-sections.mjs  （要 dev server 在 8080）
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const OUT = "C:\\Users\\yanping\\Desktop\\ds-workspace\\qidao-docs\\系统提示词-清单.md";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1200);

const dump = await page.evaluate(async () => {
  const { systemPrompt } = await import("/src/lib/prompt.ts");
  const { estimateTokens } = await import("/src/lib/tokens.ts");

  // 最小配置 = 内置固定文案（用户改不动的那部分）
  const builtin = systemPrompt({ style: "natural", tools: [] });
  // 加上"用户可调"的三块，看看各自多大
  const withUser = systemPrompt({
    style: "natural",
    tools: [
      {
        kind: "mcp",
        name: "示例服务",
        tools: Array.from({ length: 6 }, (_, i) => ({
          name: `tool_${i + 1}`,
          description: `第 ${i + 1} 个工具的说明（30~60 字）`,
          inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        })),
      },
    ],
    name: "阿岚",
    aiName: "星芒",
    persona: "我是星芒，说话偏短句。（这一段是用户自己写的人设）",
    worldAlways: ["设定：他住海边小城。", "设定：他做设计。"],
    context: { now: "2026-10-06 22:14", activity: "在看他的状态" },
  });
  return { builtin, withUser, est: (t) => estimateTokens(t) };
});

/** 按【...】大标题切段；没有标题的开头也算一段 */
function sectionsOf(text) {
  const lines = text.split("\n");
  const out = [];
  let cur = { title: "（开头 · 无标题）", body: [] };
  for (const line of lines) {
    const m = line.match(/^\s*【(.+?)】/);
    if (m) {
      if (cur.body.join("\n").trim()) out.push(cur);
      cur = { title: `【${m[1]}】`, body: [line] };
    } else cur.body.push(line);
  }
  if (cur.body.join("\n").trim()) out.push(cur);
  return out;
}

const { builtin, withUser } = dump;
const est = (t) => Math.ceil([...t].reduce((n, ch) => n + (ch.charCodeAt(0) < 128 ? 0.25 : 1), 0));
const secs = sectionsOf(builtin).map((s) => {
  const body = s.body.join("\n").trim();
  return { title: s.title, tokens: est(body), chars: body.length, body };
});
secs.sort((a, b) => b.tokens - a.tokens);

const totalBuiltin = est(builtin);
const totalWithUser = est(withUser);

const md = [];
md.push("# 系统提示词 · 完整清单（逐段 + 每段多少 token）");
md.push("");
md.push("> 这份是**实测**出来的：用 App 自己的 `systemPrompt()` 生成，再用它自己的估算函数算 token。");
md.push("> 生成时用的是**最小配置**（空人设、空世界书、无工具）—— 也就是**内置固定文案**，");
md.push("> 这部分是你**改不动**的，要减只能让开发者（我）改代码。");
md.push("");
md.push("| | token |");
md.push("|---|---|");
md.push(`| **内置固定文案（下面这些段）** | **${totalBuiltin}** |`);
md.push(`| 用户可调部分（人设 + 世界书常驻 + 工具清单 + 名字） | +${totalWithUser - totalBuiltin}（示例值） |`);
md.push(`| 合计（示例配置） | ${totalWithUser} |`);
md.push("");
md.push("## 各段排序（token 从大到小）");
md.push("");
md.push("| 段 | token | 字数 |");
md.push("|---|---|---|");
for (const s of secs) md.push(`| ${s.title} | ${s.tokens} | ${s.chars} |`);
md.push("");
md.push("---");
md.push("");
md.push("## 全文（按原顺序）");
md.push("");
for (const s of sectionsOf(builtin)) {
  const body = s.body.join("\n").trim();
  md.push(`### ${s.title}　—　${est(body)} token / ${body.length} 字`);
  md.push("");
  md.push("```text");
  md.push(body);
  md.push("```");
  md.push("");
}
md.push("---");
md.push("");
md.push(`> 生成时间：${new Date().toISOString()}　·　脚本：grok-workspace-1/dump-prompt-sections.mjs`);

writeFileSync(OUT, md.join("\n"), "utf8");

/* 控制台只打"表"，不打全文 —— 免得把上下文撑爆 */
console.log(`内置固定文案合计 ${totalBuiltin} token；示例完整配置 ${totalWithUser} token`);
console.log("分段（token 从大到小）：");
for (const s of secs.slice(0, 14)) {
  const head = s.body.replace(/\s+/g, " ").slice(0, 46);
  console.log(`${String(s.tokens).padStart(5)} tok  ${s.title.padEnd(28)} ${head}`);
}
console.log(`\n全文已写入：${OUT}`);

await browser.close();
