#!/usr/bin/env node
/**
 * 验收：**AI 会用新情绪词表，而且上报的情绪真的喂给了「星屿」插件**。
 *
 * 跑法（纯 node，不起浏览器、不连外网）：
 *   node verify-emotion-ai.mjs
 *   # 老 node 上要显式开类型擦除：node --experimental-strip-types verify-emotion-ai.mjs
 *
 * 对着任务书逐条断言：
 *   ① **手册里有这 13 组词表** —— 直接 import `manual.ts` 的 `emotionLexiconSection()`
 *      拿真输出比对（13 组的 title / family / category / note / 每一个词）。
 *   ② **词表没混进每轮提示词** —— 拿 `buildManual()` 的**真输出**对账（用户按 token 付费）。
 *   ③ **动作 schema 里有那几类字段** —— `emotion.report` 的 9 个字段 +
 *      `emotion.lexicon`（按需取词表）。
 *   ④ **词表外的词会被判无效** —— 跑真的 `buildEmotionReport()`（不是读源码猜）。
 *   ⑤ **quote > 40 字 / summary > 20 字会被截断**（依据最多 2 条）。
 *   ⑥ **真数据能驱动插件显示** —— 跑真的映射（`qidao-scenes.ts`：0~1 → 0~100）
 *      和真的登记处（`scenes.ts`：有真数据用真数据，没有回落模拟，绝不白屏）。
 *   ⑦ **接线**（源码文本断言，因为 `actions.ts` 连锁 import 界面模块，纯 node 起不来）。
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
const round = (n) => Math.round(n * 100) / 100;

/* ─────────────────────────── 装载（真模块，不是文本） ─────────────────────────── */

let lex;
let manual;
let schema;
let qidaoScenes;
let pluginScenes;
try {
  lex = await import("./src/lib/emotion-lexicon.ts");
  manual = await import("./src/lib/manual.ts");
  schema = await import("./src/lib/action-schema.ts");
  qidaoScenes = await import("./src/plugins/emotion-lifeform/lib/emotion/qidao-scenes.ts");
  pluginScenes = await import("./src/plugins/emotion-lifeform/lib/emotion/scenes.ts");
} catch (err) {
  console.log("❌ 装不进 TS 模块（要先擦类型）：", err?.message ?? err);
  console.log("   请用： node --experimental-strip-types verify-emotion-ai.mjs");
  process.exit(1);
}

const ACTIONS_SRC = read("./src/lib/actions.ts");
const META_SRC = read("./src/lib/action-meta.ts");
const MANUAL_SRC = read("./src/lib/manual.ts");
const EMOTION_APP_SRC = read("./src/plugins/emotion-lifeform/components/app/EmotionApp.tsx");
const PLUGIN_STORE_SRC = read("./src/plugins/emotion-lifeform/lib/store.ts");
const HOST_SHELL_SRC = read("./src/components/play/plugins/emotion-lifeform.tsx");

/* ═══════════════════ ① 词表本身：13 组 / 217 个词条 ═══════════════════ */

console.log("=== ① 词表（13 组 · 217 个词条） ===");
const groups = lex.EMOTION_GROUPS;
check("13 组，一个不多一个不少", groups.length === 13, `实际 ${groups.length}`);
check(
  "词条条目数 = 217（用户说的「约 217 词」）",
  lex.EMOTION_TERM_ENTRIES === 217,
  `entries=${lex.EMOTION_TERM_ENTRIES} · 去重后 ${lex.EMOTION_TERM_COUNT}`,
);
const ids = groups.map((g) => g.id).join("");
check("组 id 是 A~M（13 个，顺序不乱）", ids === "ABCDEFGHIJKLM", ids);
const CATEGORIES = ["base", "intimacy", "tension", "cognition", "expression"];
check(
  "每组都有 title / family / category / note / terms，category 都在五类里",
  groups.every(
    (g) =>
      g.title &&
      g.family &&
      g.note &&
      CATEGORIES.includes(g.category) &&
      Array.isArray(g.terms) &&
      g.terms.length > 0,
  ),
);
console.log(
  `   分组：${groups
    .map((g) => `${g.id}·${g.title.replace(/^[A-M]\.\s*/, "")}(${g.family}/${g.category}·${g.terms.length})`)
    .join("  ")}`,
);

/* ═════════════ ② 手册里那一节（按需翻）；每轮提示词里**没有**词表 ═════════════ */

console.log("");
console.log("=== ② 手册里的《情绪词表》那一节 ===");
const section = manual.emotionLexiconSection();
const missingTitles = groups.filter((g) => !section.includes(g.title)).map((g) => g.id);
const missingFamilies = groups.filter((g) => !section.includes(g.family)).map((g) => g.id);
const missingNotes = groups.filter((g) => !section.includes(g.note)).map((g) => g.id);
const allTerms = groups.flatMap((g) => g.terms);
const missingTerms = allTerms.filter((t) => !section.includes(t));
check("13 组的组名全在", missingTitles.length === 0, missingTitles.join(","));
check("13 组的 family 全在", missingFamilies.length === 0, missingFamilies.join(","));
check("13 组的 note 全在", missingNotes.length === 0, missingNotes.join(","));
check(
  `217 个词条全在（缺 ${missingTerms.length} 个）`,
  missingTerms.length === 0,
  missingTerms.slice(0, 8).join("、"),
);
check(
  "写清了怎么用：主情绪挑 1 个 / 次情绪 0~2 / 依据只引一句 / 只在明显变化时给",
  section.includes("主情绪只能从下面这 13 组里挑一个最贴的词") &&
    section.includes("次情绪 0~2 个") &&
    section.includes("只引引起波动的那一句") &&
    section.includes("只在情绪明显变化时才给"),
);
check(
  `字数规矩写在手册里（quote ≤40 / summary ≤20）`,
  section.includes("≤40 字") && section.includes("≤20 字"),
);
check(
  "手册那一节是**同一份**词表（import 来的，不是副本）",
  MANUAL_SRC.includes("renderEmotionLexiconGroups") &&
    MANUAL_SRC.includes("emotion-lexicon") &&
    !MANUAL_SRC.includes("LEXICON:") &&
    MANUAL_SRC.includes("不在这里手抄"),
  `section ${section.length} 字符`,
);

const manualText = manual.buildManual({
  permissions: { state_report: "allow", memory: "allow" },
  titles: [
    { id: "state_report", title: "给自己记一笔状态" },
    { id: "memory", title: "长期记忆" },
  ],
  displayName: "yan",
  aiName: "星芒",
});
const leaked = [...new Set(allTerms.filter((t) => manualText.includes(t)))];
const leakedNotes = groups.filter((g) => manualText.includes(g.note)).map((g) => g.id);
check(
  "每轮系统提示词里**没有**词表正文（组的 note 一句都不在）",
  leakedNotes.length === 0,
  leakedNotes.join(","),
);
check(
  "每轮提示词里没有一个完整的组（217 个词条里最多只出现示例里的两三个）",
  leaked.length <= 6,
  `命中 ${leaked.length} 个：${leaked.join("、") || "无"}`,
);
check(
  "每轮提示词里给了「怎么取」的指引（emotion.lexicon + 情绪词表）",
  manualText.includes("emotion.lexicon") && manualText.includes("情绪词表"),
);
const groupsText = lex.renderEmotionLexiconGroups();
check(
  "词表正文（2000 多字符）**一句都没内联**进每轮提示词",
  !manualText.includes(groupsText.slice(0, 120)) && !manualText.includes(groupsText.slice(-120)),
  `词表正文 ${groupsText.length} 字符`,
);
const ptrStart = manualText.indexOf("【情绪（新词表）】");
const ptrEnd = manualText.indexOf("【这个 App 的边界");
const pointer = ptrStart >= 0 && ptrEnd > ptrStart ? manualText.slice(ptrStart, ptrEnd) : "";
check(
  "每轮提示词里只留了**一句指引**（几百字符，而不是那份 2000 多字符的词表）",
  pointer.length > 0 && pointer.length < 900,
  `指引 ${pointer.length} 字符 vs 词表正文 ${groupsText.length} 字符（省下约 ${round(
    (1 - pointer.length / (groupsText.length + pointer.length)) * 100,
  )}%）`,
);

/* ═══════════════════ ③ 动作 schema：字段 + 分组 + 工具名 ═══════════════════ */

console.log("");
console.log("=== ③ 动作 schema ===");
const reportDef = schema.ACTION_SCHEMA.find((a) => a.kind === "emotion.report");
const lexiconDef = schema.ACTION_SCHEMA.find((a) => a.kind === "emotion.lexicon");
check("有 emotion.report（上报一笔情绪）", Boolean(reportDef));
check("有 emotion.lexicon（按需取词表）", Boolean(lexiconDef));
const FIELDS = [
  "primaryEmotion",
  "secondaryEmotions",
  "intensity",
  "confidence",
  "dimensions",
  "suggestedMode",
  "category",
  "evidence",
  "memoryQuery",
];
const declared = (reportDef?.fields ?? []).map((f) => f.name);
const missingFields = FIELDS.filter((f) => !declared.includes(f));
check(
  `9 类字段齐（主/次情绪 · 强度 · 置信度 · 六维 · 档位 · 大类 · 依据 · 记忆检索）`,
  missingFields.length === 0,
  `缺 ${missingFields.join(",") || "无"}`,
);
check(
  "只有 primaryEmotion 是必填（其余都能省 —— 每轮只报精简版才可能）",
  (reportDef?.fields ?? []).filter((f) => f.required).map((f) => f.name).join(",") === "primaryEmotion",
);
check("分组是「自我」（跟 state.report 同一组，进按需注册那套）", reportDef?.group === "自我", reportDef?.group);
check(
  "工具名合法且能回填（emotion_report / emotion_lexicon）",
  schema.actionToolName("emotion.report") === "emotion_report" &&
    schema.kindOfToolName("emotion_lexicon") === "emotion.lexicon",
);
check(
  "进了按需注册的组表（ACTION_GROUP_OF 里有它，关键词命中的「自我」组会带它）",
  schema.ACTION_GROUP_OF["emotion.report"] === "自我" &&
    schema.ACTION_GROUP_OF["emotion.lexicon"] === "自我",
);
check(
  "权限落在 state_report（L0 静默，不新开一项、不重新问用户）",
  META_SRC.includes('"emotion.report": "state_report"') && META_SRC.includes('"emotion.lexicon": "state_report"'),
);

/* 按需注册：真的跑一遍 `selectActionKinds()`，看它会不会被带上 */
const toolSelect = await import("./src/lib/tool-select.ts");
const allKinds = schema.ACTION_SCHEMA.map((a) => a.kind);
const selected = toolSelect.selectActionKinds({
  text: "我今天心里有点乱，说不上来什么情绪",
  allKinds,
  groupOf: schema.ACTION_GROUP_OF,
});
const selectedOther = toolSelect.selectActionKinds({
  text: "放首歌听听",
  allKinds,
  groupOf: schema.ACTION_GROUP_OF,
});
check(
  "按需注册：聊到情绪时 emotion.report 真被带上（跑的真规则，不是读源码）",
  selected.kinds.includes("emotion.report") && selected.groups.includes("自我"),
  `命中组 ${selected.groups.join("/")} · 带上 ${selected.kinds.length}/${allKinds.length} 个`,
);
/**
 * ⚠️ 这里原本断言的是"聊别的时不带它"（子代理当初的决定：省 token）。
 * 2026-10 用户改主意了 —— **「常驻吧，我不能一直提醒他记情绪」**：
 * 他不想每次都提醒他记情绪，所以宁可按量付费也要每轮都带上这个能力。
 * 现在断言"常驻"，但**检验力度不减**：其他动作组仍要被按需筛掉，不许因为常驻就全发。
 */
check(
  "常驻（用户点名）：就算聊「放歌」，emotion.report 也在 —— 不用再提醒他记情绪",
  selectedOther.kinds.includes("emotion.report"),
  `带上 ${selectedOther.kinds.length}/${allKinds.length} 个`,
);
check(
  "按需注册没被废掉：聊放歌时仍只发相关的那些（媒体组在，无关组被筛掉）",
  selectedOther.kinds.includes("media.play") && selectedOther.kinds.length < allKinds.length / 2,
  `带上 ${selectedOther.kinds.length}/${allKinds.length} 个`,
);
check(
  "tool-select.ts 的常驻集合 = 5 个，且包含 emotion.report（用户点名的常驻）",
  toolSelect.ALWAYS_KINDS.length === 5 && toolSelect.ALWAYS_KINDS.includes("emotion.report"),
  toolSelect.ALWAYS_KINDS.join(","),
);

/* ═════════════ ④⑤ 真校验：词表外无效 + 字数截断（跑真函数） ═════════════ */

console.log("");
console.log("=== ④ 词表外的词 → 整笔无效 ===");
const badWord = lex.buildEmotionReport({ primaryEmotion: "天花板上的猫" });
check(
  "主情绪不在词表里 → ok:false，且明确说「不在情绪词表里」",
  badWord.ok === false && badWord.message.includes("不在情绪词表里"),
  badWord.message.slice(0, 48),
);
check(
  "没给主情绪 → 也拒绝（不能存一条没名字的情绪）",
  lex.buildEmotionReport({ primaryEmotion: "" }).ok === false,
);
check(
  "「心动」这种带引号/书名号的写法算合法（脏写法不是「表外」）",
  lex.normalizeEmotionTerm("「心动」") === "心动" && lex.isEmotionTerm("「心动」"),
);
const goodWord = lex.buildEmotionReport({ primaryEmotion: "心动" });
check("表里的词 → ok:true", goodWord.ok === true, goodWord.ok ? goodWord.record.primaryEmotion : "");
check(
  "次情绪里的表外词被丢掉，而且如实说了（不废掉整笔）",
  (() => {
    const r = lex.buildEmotionReport({
      primaryEmotion: "心动",
      secondaryEmotions: ["羞涩", "天花板上的猫", "克制", "安心"],
    });
    return (
      r.ok === true &&
      r.record.secondaryEmotions.join(",") === "羞涩,克制" &&
      r.message.includes("表外的次情绪已丢掉：天花板上的猫")
    );
  })(),
);

console.log("");
console.log("=== ⑤ 字数：quote ≤40 / summary ≤20 / 依据 ≤2 条 ===");
const longQuote = "他".repeat(60);
const longSummary = "想".repeat(30);
const clipped = lex.buildEmotionReport({
  primaryEmotion: "心动",
  evidence: [{ quote: longQuote }, { summary: longSummary }],
});
check(
  "quote 60 字 → 截到 ≤40 字",
  clipped.ok === true && Array.from(clipped.record.evidence[0].quote ?? "").length <= 40,
  `实际 ${Array.from(clipped.record.evidence[0]?.quote ?? "").length} 字`,
);
check(
  "summary 30 字 → 截到 ≤20 字",
  Array.from(clipped.record.evidence[1]?.summary ?? "").length <= 20,
  `实际 ${Array.from(clipped.record.evidence[1]?.summary ?? "").length} 字`,
);
const tooMany = lex.buildEmotionReport({
  primaryEmotion: "心动",
  evidence: [{ quote: "一" }, { quote: "二" }, { quote: "三" }, { quote: "四" }],
});
check("依据最多 2 条（给了 4 条 → 只留 2 条）", tooMany.record.evidence.length === 2, String(tooMany.record.evidence.length));
const both = lex.buildEmotionReport({
  primaryEmotion: "心动",
  evidence: [{ quote: "你刚才那句", summary: "他有点在意" }],
});
check(
  "quote 和 summary 同时给 → 以 quote 为准（要的是原句，不是他自己的概括）",
  both.record.evidence[0].quote === "你刚才那句" && both.record.evidence[0].summary === undefined,
);
check(
  "单条对象也能收（模型不一定包成数组）",
  lex.buildEmotionReport({ primaryEmotion: "心动", evidence: { quote: "就这一句" } }).record.evidence.length === 1,
);
check(
  "clipChars 的截断是「按字数」，超长结果 ≤ max（含省略号）",
  Array.from(lex.clipChars("汉".repeat(80), 40)).length === 40 &&
    Array.from(lex.clipChars("汉".repeat(10), 40)).length === 10,
);

console.log("");
console.log("=== ⑤b 归一化：档位 / 大类 / 强度 / 六维 / 记忆检索 ===");
const norm = lex.buildEmotionReport({
  primaryEmotion: "心动",
  intensity: 1.7,
  confidence: -3,
  dimensions: { attraction: 0.9, shyness: 0.4, 天花板: 1, warmth: 2 },
  suggestedMode: "超级浓烈",
  evidence: [],
  memoryQuery: { emotion: "天花板上的猫", topic: "刚才那句" },
});
check("强度/置信度钳在 0~1", norm.record.intensity === 1 && norm.record.confidence === 0);
check(
  "六个维度齐全、词表外的键丢掉、值钳位",
  norm.record.dimensions.attraction === 0.9 &&
    norm.record.dimensions.shyness === 0.4 &&
    norm.record.dimensions.warmth === 1 &&
    !("天花板" in norm.record.dimensions) &&
    Object.keys(norm.record.dimensions).length === 6,
);
check("档位不认识 → 回落 daily 并在回执里说明", norm.record.suggestedMode === "daily" && norm.message.includes("档位不认识"));
check(
  "category 不写 → 按主情绪那一组算（心动 → intimacy）",
  norm.record.category === "intimacy",
  norm.record.category,
);
check(
  "memoryQuery.emotion 是表外词 → 回落主情绪（拿它去检索才检索得着）",
  norm.record.memoryQuery.emotion === "心动" && norm.record.memoryQuery.topic === "刚才那句",
);

/* ═══════════════════ ⑥ 真数据 → 插件（映射 + 回落） ═══════════════════ */

console.log("");
console.log("=== ⑥ 真数据驱动插件 ===");
const demoCount = pluginScenes.SCENES.length;
check("插件自带的模拟场景还在（10 个，一个没删）", demoCount === 10, String(demoCount));
check(
  "空库时：没有真数据 → 回落模拟场景（绝不白屏）",
  pluginScenes.hasRealScenes() === false && pluginScenes.activeScenes().length === 10,
);

const record = {
  id: "e1",
  at: Date.parse("2026-10-09T14:02:00+08:00"),
  primaryEmotion: "心动",
  secondaryEmotions: ["羞涩", "克制"],
  intensity: 0.8,
  confidence: 0.7,
  dimensions: { attraction: 1, longing: 0.4, shyness: 0.5, restraint: 0.3, warmth: 0.6, unease: 0.1 },
  suggestedMode: "flirtatious",
  category: "intimacy",
  evidence: [{ quote: "你刚才那句，我看了两遍" }],
  memoryQuery: { emotion: "心动", topic: "刚才那句" },
  sourceType: "conversation_inference",
};
const mapped = qidaoScenes.toEmotionEvent(record);
check("映射：eventId 带 qidao: 前缀", mapped.eventId === "qidao:e1", mapped.eventId);
check(
  "映射：0~1 → 0~100（插件那张量表是 0~100）",
  mapped.intensity === 80 && mapped.confidence === 70 && mapped.dimensions.attraction === 100,
  `强度 ${mapped.intensity} / 置信度 ${mapped.confidence} / 吸引 ${mapped.dimensions.attraction}`,
);
check("映射：isDemoData=false（界面才敢标「他自己上报的」）", mapped.isDemoData === false);
check("映射：sourceType=conversation_inference", mapped.sourceType === "conversation_inference");
check(
  "映射：timestamp 用事件时间（跟 at 对得上）",
  new Date(mapped.timestamp).getTime() === record.at,
  mapped.timestamp,
);
check("映射：title 是一句短的（不编形容词）", mapped.title === "心动 · 羞涩", mapped.title);
check(
  "映射：依据按上报填（quote + 说明）",
  mapped.evidenceRefs.length === 1 && mapped.evidenceRefs[0].quote === "你刚才那句，我看了两遍",
);
check(
  "映射：拿不到的字段不编（expressionTendencies 留空）",
  Array.isArray(mapped.expressionTendencies) && mapped.expressionTendencies.length === 0,
);
const summaryOnly = qidaoScenes.toEmotionEvent({
  ...record,
  evidence: [{ summary: "他有点在意" }],
});
check(
  "映射：只有 summary 时也能显示（note 说的是「摘要」）",
  summaryOnly.evidenceRefs[0].quote === "他有点在意" && summaryOnly.evidenceRefs[0].note.includes("摘要"),
);

pluginScenes.setExternalScenes([mapped, qidaoScenes.toEmotionEvent({ ...record, id: "e2", primaryEmotion: "安心", at: record.at - 60000 })]);
check("有真数据时：activeScenes() 用真数据（10 → 2）", pluginScenes.activeScenes().length === 2);
check("有真数据时：hasRealScenes() = true（界面会标「真实上报」）", pluginScenes.hasRealScenes() === true);
check(
  "getScene(真 id) 取到那一条；取不到的 id 也**不会**掉回模拟场景（回落第一条真数据）",
  pluginScenes.getScene("qidao:e1").primaryEmotion === "心动" &&
    pluginScenes.getScene("不存在").eventId === "qidao:e1",
);
pluginScenes.setExternalScenes([]);
check("清空真数据 → 回到 10 个模拟场景（空库不白屏）", pluginScenes.activeScenes().length === 10);

/* ═══════════════════ ⑦ 接线（源码文本断言） ═══════════════════ */

console.log("");
console.log("=== ⑦ 接线 ===");
check(
  "actions.ts：emotion.report 走真校验（buildEmotionReport）+ 入库（addEmotionEvent）",
  /case "emotion\.report":[\s\S]*?buildEmotionReport\(\{[\s\S]*?\}\)[\s\S]*?addEmotionEvent\(result\.record\)/.test(ACTIONS_SRC),
);
const reportCase = (/case "emotion\.report":([\s\S]*?)case "/.exec(ACTIONS_SRC) ?? [])[1] ?? "";
const readFields = [...new Set([...reportCase.matchAll(/action\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
const notWired = FIELDS.filter((f) => !readFields.includes(f));
check(
  "actions.ts 真的把 9 个字段都读进来了（schema 覆盖得住，verify-action-registry 也盯这条）",
  notWired.length === 0,
  notWired.join(","),
);
check(
  "actions.ts：emotion.lexicon 返回手册那一节（按需取词表）",
  /case "emotion\.lexicon":[\s\S]*?emotionLexiconSection\(\)/.test(ACTIONS_SRC),
);
check(
  "手册里 buildManual 体内**没有**塞词表（真输出那条断言的双保险）",
  (() => {
    const body = (/export function buildManual\([\s\S]*?\n}/.exec(MANUAL_SRC) ?? [])[0] ?? "";
    return body.length > 0 && !body.includes("emotionLexiconSection");
  })(),
);
check(
  "插件 store 会登记真数据（setRealScenes → scenes.ts 的登记处）",
  PLUGIN_STORE_SRC.includes("setRealScenes") && PLUGIN_STORE_SRC.includes("setExternalScenes"),
);
check(
  "EmotionApp 用 store.scenes 渲染（不再直接读模拟场景），并接收 realScenes",
  /realScenes\?: EmotionEvent\[\]/.test(EMOTION_APP_SRC) &&
    EMOTION_APP_SRC.includes("useEmotionStore((s) => s.scenes)") &&
    EMOTION_APP_SRC.includes("setRealScenes(realScenes)"),
);
check(
  "宿主外壳把 emotionEvents 映射后传进去（跟记忆宇宙同一个套路）",
  HOST_SHELL_SRC.includes("s.emotionEvents") &&
    HOST_SHELL_SRC.includes("toEmotionEvents") &&
    HOST_SHELL_SRC.includes("<EmotionApp realScenes={realScenes} />"),
);
check(
  "旧的东西一个没删：11 维 dims（state-dims.ts）与旧花瓣动作 state.report 都还在",
  read("./src/lib/state-dims.ts").includes("DIMS") &&
    schema.ACTION_SCHEMA.some((a) => a.kind === "state.report") &&
    ACTIONS_SRC.includes('case "state.report"'),
);
check(
  "插件的画布/动效/配色文件没被这一轮碰过（只有数据层与文案）",
  read("./src/plugins/emotion-lifeform/lib/emotion/visual.ts").includes("export function resolveVisual") &&
    !read("./src/plugins/emotion-lifeform/lib/emotion/visual.ts").includes("qidao-scenes") &&
    !read("./src/plugins/emotion-lifeform/lib/emotion/present.ts").includes("qidao-scenes"),
);

/* ─────────────────────────────────── 汇总 ─────────────────────────────────── */

console.log("");
console.log("-".repeat(64));
console.log(
  `词表：13 组 / ${lex.EMOTION_TERM_ENTRIES} 个词条（去重 ${lex.EMOTION_TERM_COUNT}） · ` +
    `手册那一节 ${section.length} 字符（按需取） · 每轮提示词里只留 ${pointer.length} 字符的指引` +
    `（词表命中 ${leaked.length} 个：${leaked.join("、") || "无"}）`,
);
console.log(
  failures === 0
    ? `✅ 全部通过：AI 会查新词表、上报要走真校验、插件读得到真数据（也能回落模拟）`
    : `❌ ${failures} 项不通过`,
);
process.exit(failures === 0 ? 0 : 1);
