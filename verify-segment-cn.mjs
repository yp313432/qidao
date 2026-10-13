#!/usr/bin/env node
/**
 * 验收：**按标点分句**（2026-10 用户提的改法）
 *
 * 用户原话："要不改成一句话一行那种，你们 ai 应该会用标点吧，按标点分句。"
 *
 * 背景（用户报的 5 号"分段回复时好时坏"）：
 *   老办法只认他打的 `|||` —— 他不打就不分段，所以表现"时好时坏"。
 *   现在三级：① 他打的 `|||`（仍认）② 空行分段 ③ **标点分句**（每 N 句合成一条）。
 *
 * 三条硬纪律（都要断言）：
 *   · 一句话的短回复**不许**被乱切成多条
 *   · **代码块整块不切**（切了排版就散）
 *   · **一个字都不许丢**（超上限并进最后一段）
 *
 * 跑法：node verify-segment-cn.mjs
 * 反向：QIDAO_MUTATE_REVERSE=1 node verify-segment-cn.mjs
 */
import { splitSegments } from "./src/lib/segment.ts";

const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";
let passed = 0;
let failures = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}
const cn = (s, o) => splitSegments(s, o);

check("一句话 → 一个气泡（短回复不乱切）", cn("嗯，不急。").length === 1);
check(
  "三句话 + 每条最多 2 句 → 2 条（第一条两句、第二条一句）",
  (() => {
    const r = cn("一。二。三。", { maxParts: 3, maxSentences: 2 });
    return r.length === 2 && r[0] === "一。二。" && r[1] === "三。";
  })(),
);
check(
  "每条最多 1 句 → 一句一个气泡",
  (() => {
    const r = cn("一。二。三。", { maxParts: 6, maxSentences: 1 });
    return r.length === 3 && r[2] === "三。";
  })(),
);
check(
  "**代码块整块不切**（含句号也不许切）",
  (() => {
    const raw = "先说一句。\n\n```js\nconst a = 1。\nconst b = 2。\n```\n\n再说一句。";
    const r = cn(raw, { maxParts: 6, maxSentences: 1 });
    return (
      r.some((x) => x.includes("```js") && x.includes("const b = 2。")) &&
      !r.some((x) => x.trim() === "const a = 1。")
    );
  })(),
);
check(
  "**一个字都不许丢**：超上限时多出来的并进最后一段",
  (() => {
    const raw = "一。二。三。四。五。";
    const r = cn(raw, { maxParts: 2, maxSentences: 1 });
    return r.length === 2 && r.join("").replace(/\s/g, "") === raw.replace(/\s/g, "");
  })(),
);
check(
  "他自己打的 `|||` 仍然认（次要优先级）",
  (() => {
    const r = cn("甲|||乙", { maxParts: 3 });
    return r.length === 2 && r[0].includes("甲") && r[1].includes("乙");
  })(),
);
check(
  "英文问号/感叹号也能断，但**不切小数点与网址**",
  (() => {
    const r = cn("Hi! 版本 1.5 已发布? 见 a.com 页。", { maxParts: 6, maxSentences: 1 });
    return r.length >= 2 && r.some((x) => x.includes("1.5")) && r.some((x) => x.includes("a.com"));
  })(),
);
check(
  "空行分段也认（他本来就分了段）",
  cn("第一段的话。\n\n第二段的话。", { maxParts: 6, maxSentences: 1 }).length === 2,
);
check("关掉分段（只留 1 条）→ 原样返回", cn("一。二。三。", { maxParts: 1 }).length === 1);

if (REVERSE) {
  passed = 0;
  failures = 0;
  /** 反向：老逻辑（只认 `|||`）遇到"没打记号的三句话" → 只有 1 条（= 用户看到的"没分段"） */
  const oldLogic = (raw) => (raw.includes("|||") ? raw.split("|||") : [raw]);
  check(
    "反向：老逻辑对「没打记号的三句话」只给 1 条 —— 这正是用户说的「时好时坏」",
    oldLogic("一。二。三。").length === 1 && cn("一。二。三。", { maxParts: 3, maxSentences: 1 }).length === 3,
  );
  const ok = failures === 0;
  console.log("");
  console.log(ok ? "✅ 反向验证通过（退出码 0 = 反向成功）" : "❌ 反向验证失败");
  process.exit(ok ? 0 : 1);
}

console.log("");
console.log(`${failures === 0 ? "✅ 全过" : "❌ 有失败"}：${passed} 绿 / ${failures} 红`);
process.exit(failures === 0 ? 0 : 1);
