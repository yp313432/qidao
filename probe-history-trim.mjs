/**
 * 探针：**历史裁剪现在到底裁掉了多少**（"上下文与内存"那一页的数字是真的吗）。
 *
 * 为什么必须量：用户问"要不要做对话总结" —— 而答案取决于**现在到底丢了多少**。
 * 上一版的 `historyForApi` 是"从最新往回收，装不下就停"，所以：
 *   · 短对话：一条不丢
 *   · 长对话：**悄悄丢掉最早的那些**（界面上只体现成"折叠了 N 条"）
 * 这里把这三种长度的对话都摆出来，看真实数字。
 *
 * 跑法（要完整权限；dev server 要在 8080）：
 *   node probe-history-trim.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1000);

const out = await page.evaluate(async () => {
  const { historyForApi } = await import("/src/lib/chat-client.ts");
  const { estimateTokens } = await import("/src/lib/tokens.ts");
  const { systemPrompt } = await import("/src/lib/prompt.ts");
  const { ACTION_SCHEMA, actionToolsFor } = await import("/src/lib/action-schema.ts");
  const { selectActionKinds } = await import("/src/lib/tool-select.ts");
  const { ACTION_GROUP_OF } = await import("/src/lib/action-schema.ts");

  /** 很像真的：用户一句 40 字左右，助手回 150 字左右（带点思考链更真实） */
  const userText = (i) => `第 ${i} 轮我说的事：${"今天有点想聊聊工作上的烦心事，顺便问问你怎么办".slice(0, 24)}`;
  const aiText = (i) =>
    `嗯，我听着呢（第 ${i} 轮）。${"这件事你可以先把它拆成两半看：哪一部分是你能决定的，哪一部分不是。能决定的那半，先做最小的一步；不能决定的那半，就先放着，别拿它耗自己。".repeat(2)}`;

  const convo = (rounds) => {
    const msgs = [];
    for (let i = 1; i <= rounds; i += 1) {
      msgs.push({ id: `u${i}`, role: "user", content: userText(i), thinking: "", thinkingDurationMs: 0, createdAt: i * 2 });
      msgs.push({ id: `a${i}`, role: "assistant", content: aiText(i), thinking: "", thinkingDurationMs: 0, createdAt: i * 2 + 1 });
    }
    return msgs;
  };

  const settings = { contextBudget: 6000, keepRecent: 16, autoCompact: true, compactAt: 80 };
  const sys = systemPrompt({ style: "default", tools: [], name: "yan", aiName: "星芒", persona: "", worldAlways: [], permissions: {}, nativeTools: true, selectiveTools: true });
  const sysTokens = estimateTokens(sys);
  const allKinds = ACTION_SCHEMA.map((a) => a.kind);
  const sel = selectActionKinds({ text: "今天有点烦", allKinds, groupOf: ACTION_GROUP_OF, enabled: true });
  const toolsTokens = estimateTokens(JSON.stringify(actionToolsFor(sel.kinds)));

  const rows = [6, 15, 30, 60].map((rounds) => {
    const all = convo(rounds);
    const sent = historyForApi(all, settings);
    const histTokens = sent.reduce(
      (n, m) => n + estimateTokens(typeof m.content === "string" ? m.content : ""),
      0,
    );
    return {
      rounds,
      total: all.length,
      sent: sent.length,
      dropped: all.length - sent.length,
      histTokens,
      withSystem: sysTokens + toolsTokens + histTokens,
    };
  });
  return { sysTokens, toolsTokens, budget: settings.contextBudget, keepRecent: settings.keepRecent, rows };
});

const pad = (s, n) => String(s).padEnd(n, " ");
console.log(
  `系统提示词 ${out.sysTokens} + 这一轮工具定义 ${out.toolsTokens}（按需挑的）` +
    ` ＝ 固定开销 ${out.sysTokens + out.toolsTokens}\n` +
    `上下文预算 settings.contextBudget = ${out.budget}（keepRecent=${out.keepRecent}）\n`,
);
console.log(
  pad("对话长度", 12) + pad("总条数", 8) + pad("真发出去", 10) + pad("被丢掉", 8) + pad("历史 token", 12) + "整轮合计",
);
console.log("-".repeat(70));
for (const r of out.rows) {
  console.log(
    pad(`${r.rounds} 轮`, 12) +
      pad(r.total, 8) +
      pad(r.sent, 10) +
      pad(r.dropped, 8) +
      pad(r.histTokens, 12) +
      r.withSystem,
  );
}
console.log(
  "\n⚠️ 「被丢掉」= 悄悄不再发给模型（界面上只在「上下文与内存」里显示成折叠条数）。\n" +
    "   说明：老对话被整条丢掉之后，模型**再也想不起来**那部分 —— 这就是「总结」要解决的事。",
);

await browser.close();
