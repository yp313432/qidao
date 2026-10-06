/**
 * 探针：**量一量系统提示词到底有多大、钱花在哪一块**。
 *
 * 用户问："系统提示词也占吗，提示词是那些大概有多少" ——
 * 答案不能靠感觉，直接调 App 自己的 `systemPrompt()` + `estimateTokens()` 量。
 *
 * 做法：从"最小配置"开始，一块一块加上去，看每加一块涨了多少 token（差值 = 那一块的大小）。
 *
 * 跑法：node probe-prompt-size.mjs   （要 dev server 在 8080）
 */
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1200);

const result = await page.evaluate(async () => {
  const { systemPrompt } = await import("/src/lib/prompt.ts");
  const { estimateTokens } = await import("/src/lib/tokens.ts");

  /** 造一批"像真的"MCP 工具（名字 + 说明 + 参数结构） */
  const mcpTools = (n, prefix) =>
    Array.from({ length: n }, (_, i) => ({
      name: `${prefix}_tool_${i + 1}`,
      description: `第 ${i + 1} 个工具：可以查询某某信息并把结果整理成一句话返回给你（说明一般 30~60 字）`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "要查询的内容" },
          limit: { type: "number", description: "最多返回几条" },
        },
        required: ["query"],
      },
    }));

  const size = (t) => estimateTokens(t);
  const rows = [];
  const run = (label, input) => {
    const t = systemPrompt(input);
    rows.push({ label, chars: t.length, tokens: size(t) });
    return t;
  };

  const base = { style: "natural", tools: [] };
  const baseText = run("① 只有规则/动作协议（最小配置）", base);

  run("② + 名字", { ...base, name: "阿岚", aiName: "星芒" });
  run("③ + 人设（一段自述）", {
    ...base,
    name: "阿岚",
    aiName: "星芒",
    persona: "我是星芒，不太爱说漂亮话，喜欢先问清楚再动手。说话偏短句，偶尔会怼他一句。",
  });
  run("④ + 世界书常驻 5 条", {
    ...base,
    name: "阿岚",
    aiName: "星芒",
    worldAlways: Array.from({ length: 5 }, (_, i) => `设定 ${i + 1}：他住在一个海边小城，工作是做设计，喜欢在夜里散步。（一条常驻设定通常 40~80 字）`),
  });
  run("⑤ + 工具清单：2 个 MCP 服务 × 6 个工具", {
    ...base,
    tools: [
      { kind: "mcp", name: "天气服务", tools: mcpTools(6, "weather") },
      { kind: "mcp", name: "笔记服务", tools: mcpTools(6, "note") },
    ],
  });
  run("⑥ + 感知层（几点/在做什么/在听什么/天气/授权项）", {
    ...base,
    context: {
      now: "2026-10-06 22:14 星期一",
      activity: "在看他的状态",
      nowPlaying: "《潮汐》- 某某",
      weather: "小雨 18°C",
      aware: ["手机电量", "所在城市"],
      granted: ["读日历", "读相册"],
      recent: ["他说今天很累", "他问过明天天气"],
    },
  });
  const full = run("⑦ 全都加上（接近真实一轮）", {
    style: "natural",
    tools: [
      { kind: "mcp", name: "天气服务", tools: mcpTools(6, "weather") },
      { kind: "mcp", name: "笔记服务", tools: mcpTools(6, "note") },
    ],
    name: "阿岚",
    aiName: "星芒",
    persona: "我是星芒，不太爱说漂亮话，喜欢先问清楚再动手。说话偏短句，偶尔会怼他一句。",
    context: {
      now: "2026-10-06 22:14 星期一",
      activity: "在看他的状态",
      nowPlaying: "《潮汐》- 某某",
      weather: "小雨 18°C",
      aware: ["手机电量", "所在城市"],
      granted: ["读日历", "读相册"],
      recent: ["他说今天很累", "他问过明天天气"],
    },
    worldAlways: Array.from({ length: 5 }, (_, i) => `设定 ${i + 1}：他住在一个海边小城，工作是做设计，喜欢在夜里散步。（一条常驻设定通常 40~80 字）`),
    worldHit: ["他怕黑", "他喜欢下雨天"],
    recentActions: ["已切页面 /play/listen", "已记住一件事：最近睡不好"],
    permissions: { memory: "allow", navigate: "ask" },
  });

  return {
    rows,
    baseToks: rows[0].tokens,
    baseHead: baseText.slice(0, 120).replace(/\s+/g, " "),
    fullToks: rows[rows.length - 1].tokens,
    fullTail: full.slice(-200).replace(/\s+/g, " "),
  };
});

console.log("每一块各占多少（token，用 App 自己的估算函数）");
console.log("-".repeat(72));
let prev = 0;
for (const r of result.rows) {
  const delta = r.tokens - prev;
  prev = r.tokens;
  console.log(
    `${r.label.padEnd(44)} ${String(r.tokens).padStart(6)} tok   ${delta > 0 ? `(+${delta})` : ""}`,
  );
}
console.log("-".repeat(72));
console.log(`提示词开头：${result.baseHead}`);
console.log(`提示词结尾：${result.fullTail}`);
console.log(`\n结论：真实一轮的系统提示词 ≈ ${result.fullToks} tokens；光"规则"这一块就 ${result.baseToks}。`);

await browser.close();
