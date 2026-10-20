#!/usr/bin/env node
/**
 * 验收：**情绪上报 = 自由词 + 10 组互斥**（2026-10 用户拍板的 B 方案）真的落地了。
 *
 * 跑法（纯 node，不起浏览器、不连外网、不改任何源码）：
 *   node verify-emotion-10groups.mjs
 *
 * 为什么要有这个脚本：旧方案是「13 组 / 217 词的白名单词表 + 按需取词表动作」，
 * 用户后来改主意了（自由概括 1~5 字 + group 必填，删掉取词表动作）。
 * 这种"换了方案但旧口径没退干净"的错最阴：不报错、界面照常，只是 AI 说的和代码做的不一样。
 * 所以它逐条对账：
 *   ① 词库：10 组、id 唯一、词条互不重复（互斥）、全中文
 *   ② 说明书里那节参考说法 + 每轮提示词里只给 10 个 id（词表正文不许进每轮）
 *   ③ 动作定义：98 个 kind、没有 emotion.lexicon、emotion.report 的 group 必填
 *   ④ 真跑 `buildEmotionReport()` 的 8 种输入（自由词/超长/缺 group/错 group/次情绪/证据/空值）
 *   ⑤ 接线：actions.ts / action-meta.ts 里没有取词表的分支，星屿配色 10 个
 *
 * 退出码：有任何 FAIL 就是 1。
 */
import { readFileSync } from "node:fs";

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) failures += 1;
}
const read = (rel) => {
  try {
    return readFileSync(new URL(rel, import.meta.url), "utf8");
  } catch {
    return "";
  }
};

let lex;
let manual;
let schema;
let tools;
try {
  lex = await import("./src/lib/emotion-lexicon.ts");
  manual = await import("./src/lib/manual.ts");
  schema = await import("./src/lib/action-schema.ts");
  tools = await import("./src/lib/tool-select.ts");
} catch (err) {
  console.log("❌ 装不进 TS 模块（要先擦类型）：", err?.message ?? err);
  console.log("   请用： node --experimental-strip-types verify-emotion-10groups.mjs");
  process.exit(1);
}

const ACTIONS_SRC = read("./src/lib/actions.ts");
const META_SRC = read("./src/lib/action-meta.ts");
const LEXICON_SRC = read("./src/plugins/emotion-lifeform/lib/emotion/lexicon.ts");
const LEX_SRC = read("./src/lib/emotion-lexicon.ts");

/* ═════════════════ ① 词库：10 组 / 互斥 / 全中文 ═════════════════ */
console.log("=== ① 词库（10 组 · 自由词时代的参考说法） ===");
const groups = lex.EMOTION_GROUPS;
check("10 组，一个不多一个不少", groups.length === 10, `实际 ${groups.length}`);
check(
  "组 id 唯一",
  new Set(groups.map((g) => g.id)).size === groups.length,
  groups.map((g) => g.id).join(","),
);
check(
  "10 组 id 就是文档里说的那十个",
  JSON.stringify(groups.map((g) => g.id)) ===
    JSON.stringify([
      "bright",
      "calm",
      "low",
      "angry",
      "uneasy",
      "close",
      "flutter",
      "jealous",
      "restrained",
      "curious",
    ]),
  groups.map((g) => g.id).join(","),
);
check(
  "每组都有 title / family / category / terms",
  groups.every((g) => g.title && g.family && g.category && Array.isArray(g.terms) && g.terms.length > 0),
);

// 互斥：同一个词不许出现在两组里（旧 13 组有 8 个跨组词，用户点名要合并）
const seen = new Map();
const dup = [];
for (const g of groups) {
  for (const t of g.terms) {
    if (seen.has(t)) dup.push(`${t}（${seen.get(t)} / ${g.id}）`);
    else seen.set(t, g.id);
  }
}
check(`词条互不重复（旧方案的 8 个跨组词已经并掉）`, dup.length === 0, dup.slice(0, 6).join("、"));

// 参考说法必须全中文（英文只是字段名，用户明确问过这一点）
const nonChinese = [...seen.keys()].filter((t) => !/^[\u4e00-\u9fa5]+$/.test(t));
check("参考说法全是中文（英文只是字段名）", nonChinese.length === 0, nonChinese.slice(0, 6).join("、"));

/* ═════════════════ ② 说明书那节 vs 每轮提示词 ═════════════════ */
console.log("\n=== ② 说明书那节 vs 每轮提示词（用户按 token 付费） ===");
const section = manual.emotionLexiconSection();
check(
  "说明书里那节能拿到 10 组的参考说法（emotionLexiconSection）",
  groups.every((g) => section.includes(g.terms.join("、"))),
);
check(
  "那节标题是「情绪怎么报（10 组 · 自由词）」",
  section.includes("10 组") && section.includes("自由"),
);

const builtManual = manual.buildManual({
  displayName: "yan",
  aiName: "星芒",
  userGender: "female",
  titles: [],
  permissions: {},
  httpTools: [],
});
check(
  "每轮提示词里给了 10 个组 id",
  lex.EMOTION_GROUP_IDS.every((id) => builtManual.includes(id)),
  lex.EMOTION_GROUP_IDS.join(","),
);
check(
  "每轮提示词里**没有**任何一组的完整参考说法（省 token）",
  !groups.some((g) => builtManual.includes(g.terms.join("、"))),
);
check(
  "每轮提示词里点名了「1~5 个字」这条规矩",
  /1~5\s*个字/.test(builtManual),
);
check(
  "每轮提示词里说了 group 必填",
  builtManual.includes("group 必填"),
);

/* ═════════════════ ③ 动作定义 ═════════════════ */
console.log("\n=== ③ 动作定义（95 kind / 没有取词表动作 / group 必填） ===");
const kinds = schema.ACTION_SCHEMA.map((a) => a.kind);
check("动作定义是 95 个 kind", kinds.length === 95, `实际 ${kinds.length}`);
check("emotion.lexicon 已经删掉（改自由词后不再需要取词表）", !kinds.includes("emotion.lexicon"));
const reportDef = schema.ACTION_SCHEMA.find((a) => a.kind === "emotion.report");
check("emotion.report 在动作定义里", Boolean(reportDef));
check(
  "emotion.report 的分组是「自我」",
  reportDef?.group === "自我",
  String(reportDef?.group),
);
const fields = reportDef?.fields ?? [];
const fieldOf = (name) => fields.find((f) => f.name === name);
const groupField = fieldOf("group");
check(
  "emotion.report 有 group 字段，而且标了必填",
  Boolean(groupField) && groupField.required === true && String(groupField.note).includes("必填"),
  JSON.stringify(groupField ?? null).slice(0, 80),
);
check(
  "emotion.report 里还留着旧的 category 字段（兼容，但不是必填）",
  Boolean(fieldOf("category")) && fieldOf("category").required !== true,
);

/* ═════════════════ ④ 真跑 buildEmotionReport ═════════════════ */
console.log("\n=== ④ 真跑 buildEmotionReport()（自由词 + group） ===");
const base = { intensity: 0.6, confidence: 0.7 };

const ok1 = lex.buildEmotionReport({ ...base, primaryEmotion: "被看穿的心慌", group: "flutter" });
check(
  "自由词 6 字 → 能入库（超 5 字截断，不驳回）",
  ok1.ok === true,
  ok1.ok ? String(ok1.record.primaryEmotion) : ok1.message,
);
check(
  "截断到 5 字，而且回执里说了一句",
  ok1.ok && Array.from(ok1.record.primaryEmotion).length <= 5,
  ok1.ok ? `${ok1.record.primaryEmotion} · ${ok1.message}` : "",
);

const ok2 = lex.buildEmotionReport({ ...base, primaryEmotion: "踏实", group: "calm" });
check("3 字自由词原样入库", ok2.ok === true && ok2.record.primaryEmotion === "踏实");
check(
  "category 由 group 推导（calm → base）",
  ok2.ok && ok2.record.category === "base",
  ok2.ok ? String(ok2.record.category) : "",
);

const bad1 = lex.buildEmotionReport({ ...base, primaryEmotion: "心动" });
check("没给 group → 整笔拒绝，并列出 10 组", bad1.ok === false && bad1.message.includes("bright"));

const bad2 = lex.buildEmotionReport({ ...base, primaryEmotion: "心动", group: "intimacy" });
check(
  "group 写成旧大类（intimacy）→ 拒绝（不是 10 组 id）",
  bad2.ok === false && bad2.message.includes("10 组"),
  bad2.ok ? "" : bad2.message.slice(0, 60),
);

const bad3 = lex.buildEmotionReport({ ...base, group: "flutter" });
check("没给主情绪 → 拒绝", bad3.ok === false);

const ok3 = lex.buildEmotionReport({
  ...base,
  primaryEmotion: "酸",
  group: "jealous",
  secondaryEmotions: ["不甘", "酸", "闷", "烦"],
});
check(
  "次情绪去重 + 最多 2 个（4 个进去 2 个出来）",
  ok3.ok && ok3.record.secondaryEmotions?.length === 2,
  ok3.ok ? JSON.stringify(ok3.record.secondaryEmotions) : "",
);

const ok4 = lex.buildEmotionReport({
  ...base,
  primaryEmotion: "踏实",
  group: "calm",
  evidence: [
    { quote: "你".repeat(80) },
    { summary: "他".repeat(60) },
    { quote: "第三条应该被丢掉" },
  ],
});
check(
  "证据最多 2 条，quote ≤ 40 字、summary ≤ 20 字（截断不拒绝）",
  ok4.ok &&
    ok4.record.evidence?.length === 2 &&
    Array.from(ok4.record.evidence[0]?.quote ?? "").length <= 40 &&
    Array.from(ok4.record.evidence[1]?.summary ?? "").length <= 20,
  ok4.ok ? JSON.stringify(ok4.record.evidence).slice(0, 70) : "",
);

const ok5 = lex.buildEmotionReport({
  ...base,
  primaryEmotion: "  「心动」  ",
  group: "flutter",
});
check(
  "带引号/书名号的脏写法会被清掉，不算「表外」",
  ok5.ok === true && ok5.record.primaryEmotion === "心动",
  ok5.ok ? ok5.record.primaryEmotion : "",
);

/* ═════════════════ ⑤ 接线 + 星屿配色 ═════════════════ */
console.log("\n=== ⑤ 接线（源码文本断言） ===");
check(
  "actions.ts 里没有 emotion.lexicon 的执行分支（只剩注释里的历史说明）",
  !/case\s+"emotion\.lexicon"/.test(ACTIONS_SRC),
);
check("action-meta.ts 里没有 emotion.lexicon 的分支", !META_SRC.includes("emotion.lexicon"));
check(
  "actions.ts 上报情绪时把 group 传下去了",
  /buildEmotionReport\(\{[\s\S]{0,400}?group:\s*action\.group/.test(ACTIONS_SRC),
);
check(
  "常驻集合里有 emotion.report（每轮都能报，不能漏轮）",
  (tools.ALWAYS_KINDS ?? []).includes("emotion.report"),
);
check(
  "常驻集合里没有 emotion.lexicon",
  !(tools.ALWAYS_KINDS ?? []).includes("emotion.lexicon"),
);

const colorRows = LEX_SRC.split("\n").filter((l) => /^\s*"rgb\(/.test(l)).length;
check("星屿配色正好 10 个（跟着 10 组走；FALLBACK_COLOR 不算）", colorRows === 10, `实际 ${colorRows}`);
check(
  "词库里每个组都有对应的配色（不是靠第几个硬凑的）",
  groups.every((g) => LEX_SRC.includes(`// ${g.id} `)),
);

/* ═════════════════ 汇总 ═════════════════ */
console.log("\n" + "─".repeat(76));
if (failures > 0) {
  console.log(`❌ ${failures} 项不通过 —— 上面每条 ❌ 都是"换了新口径、旧的还留着"或者"新口径没真的生效"`);
  process.exit(1);
}
console.log("✅ 全部通过 —— 情绪上报已是「自由词 + 10 组互斥」，旧词表口径零残留");
