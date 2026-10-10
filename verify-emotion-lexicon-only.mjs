#!/usr/bin/env node
/**
 * 验收：**情绪口径已经统一到新词表这一处**（旧的 11 维 `state.report` 整条退场）。
 *
 * 用户原话（逐字）：
 *   "原来的那个情绪一项，他为啥还在跑 state report 那个板块已经结束了，
 *    让他用新词块报，**就是那11个就不用了**。"
 *
 * ── 为什么单独一个脚本 ──────────────────────────────────────────
 * `verify-emotion-ai.mjs` 证的是"新词表接通了"；这个脚本证的是**旧的那套彻底没了**，
 * 而且**没有任何一处还在用旧词表** —— 两件事的失败方式完全不同：
 * 前者的失败是"新功能不工作"，后者的失败是"新旧两套并存、口径分叉"
 * （那种错不报错、只会让 AI 报的词一半被丢掉，肉眼几乎看不出来）。
 *
 * 要证明的四条（对着任务书逐条写）：
 *   ① **手册里已经没有旧的 11 维词表**（想念/心动/牵挂/分享欲/好奇/情愫/反思/
 *      无聊/难过/生气/占有）—— ⚠️ **必须按上下文判，不能全文搜**：
 *      「心动 / 好奇 / 想念」这些字样在新词表里本来就有（心动是 G 组的词），
 *      全文搜必然误伤。所以判据是**旧词表的结构性痕迹**：
 *        · 旧那节的标题（【心情词表】/【花瓣】）与字段名（`dims` / `mood` 心跳那种）
 *        · 旧词表独有的 4 个词（分享欲 / 情愫 / 反思 / 占有 —— 新表 217 词里没有）
 *        · `DIM_IDS` / `DIM_LABELS` / `LEGACY_ALIASES` 这些只属于旧词表的导出
 *   ② **新词表 13 组都在手册里**（沿用 `emotionLexiconSection()` 的**真输出**，
 *      不是读源码猜）——每组 title / family / category / note / 每个词都在。
 *   ③ `state.report` **既不在动作定义里、也不在 types 里、也没有那个 case**；
 *      并且它声明的 11 维字段（`dims` / `energy` / `missing` / `curious`）在
 *      「自我」组任何动作的字段里都找不到（不留半截）。
 *   ④ 情绪**只剩一条上报通道**：`emotion.report` 在，`state.report` 不在。
 *
 * 跑法（纯 node，不起浏览器、不连外网、不改任何源码）：
 *   node --experimental-strip-types verify-emotion-lexicon-only.mjs
 *   # 用 $QIDAO_MUTATE_REVERSE=1 跑一次**反向验证**：脚本会故意把一条断言写反，必须变红
 *
 * 退出码：有任何 FAIL 就是 1。
 */
import { existsSync, readFileSync } from "node:fs";

/* ─────────────────────────── 反向验证开关 ───────────────────────────
 * 任务书要求："故意把一条断言写反 → 脚本变红；再改回"。
 * 这里把它做成一个**可重复执行**的开关（而不是手改源码再改回来）：
 * 打开后，人手册那一节会被替换成"旧词表"的样子，脚本**必须**因此变红。
 * 这样这条"反向验证"以后每次都能重跑，不靠人记得手工验一次。
 */
const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";

let failures = 0;
let passed = 0;
function check(name, ok, extra = "") {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
}
const read = (rel) => {
  try {
    return readFileSync(new URL(rel, import.meta.url), "utf8");
  } catch {
    return "";
  }
};

/* ─────────────────────────── 装载真模块 ─────────────────────────── */

let lex;
let manual;
let schema;
try {
  lex = await import("./src/lib/emotion-lexicon.ts");
  manual = await import("./src/lib/manual.ts");
  schema = await import("./src/lib/action-schema.ts");
} catch (err) {
  console.log("❌ 装不进 TS 模块（要先擦类型）：", err?.message ?? err);
  console.log("   请用： node --experimental-strip-types verify-emotion-lexicon-only.mjs");
  process.exit(1);
}

/**
 * ⚠️ 反向验证注入点：把**真输出**污染成"旧词表还在"的样子。
 * 必须是"注入到待测值里"，而不是改断言 —— 这样证明的是**断言真的在看那个值**。
 */
const RETIRED_SECTION = `【心情词表】(旧)
想念、心动、牵挂、分享欲、好奇、情愫、反思、无聊、难过、生气、占有
{"kind":"state.report","mood":"想念","dims":{"想念":0.4}}`;

const lexiconSection = REVERSE
  ? `${manual.emotionLexiconSection()}\n\n${RETIRED_SECTION}`
  : manual.emotionLexiconSection();

const manualText = (() => {
  const base = manual.buildManual({
    permissions: { state_report: "allow", memory: "allow" },
    titles: [
      { id: "state_report", title: "给自己记一笔状态" },
      { id: "memory", title: "长期记忆" },
    ],
    displayName: "yan",
    aiName: "星芒",
  });
  return REVERSE ? `${base}\n\n${RETIRED_SECTION}` : base;
})();

const TYPES_SRC = read("./src/lib/types.ts");
const ACTIONS_SRC = read("./src/lib/actions.ts");
const META_SRC = read("./src/lib/action-meta.ts");
const SCHEMA_SRC = read("./src/lib/action-schema.ts");

/* ══════════════ ① 旧词表在手册/提示词里彻底没了 ══════════════ */

console.log("=== ① 旧的 11 维词表：手册与每轮提示词里都不该再有 ===");

/**
 * 旧词表**独有**的那几个词 —— 新词表 217 个词条里确实没有它们。
 * 另 7 个（想念 / 心动 / 牵挂 / 好奇 / 难过 / 生气 / 无聊）跟新词表重合，
 * **不能**拿它们全文搜（会误伤），所以只作"结构性痕迹"的辅助。
 */
const RETIRED_ONLY = ["分享欲", "情愫", "反思", "占有"];
/** 旧那节的结构性痕迹：节的标题 + 只属于旧写法的字段名 */
const RETIRED_MARKERS = [
  "【心情词表】", // 旧节的标题（新节是【情绪词表】）
  "花瓣词表", // 旧注释/文案里的叫法
  '"dims"', // 旧协议的字段名
  "LEGACY_ALIASES", // 只属于旧词表的导出
  "DIM_LABELS", // 同上
  "DIM_IDS", // 同上
];

const hitsManual = RETIRED_MARKERS.filter((m) => lexiconSection.includes(m));
check(
  "①a 手册那一节里没有旧词表的结构性痕迹（旧节标题 / dims / 旧导出名）",
  hitsManual.length === 0,
  hitsManual.join("、") || "零命中",
);

/**
 * ⚠️ **必须按"词条位置"判**，不能 `includes` 了事：
 * 新词表 H 组的标题就是「H. 吃醋与占有倾向」—— 里面**含**「占有」这两个字，
 * 但它不是旧词表的那个词条。所以只在"像词条一样被顿号/换行/引号夹着"时才算命中。
 * （这就是任务书说的"要按'作为 11 维词表出现'来判，别误伤"。）
 */
function asLexiconEntry(text, term) {
  const boundary = `[、，,／/\\s"'「」『』【】（）()\\[\\]：:]`;
  return new RegExp(`(?:^|${boundary})${term}(?:$|${boundary})`, "m").test(text);
}

const hitsWords = RETIRED_ONLY.filter((w) => asLexiconEntry(lexiconSection, w));
check(
  `①b 旧词表独有的 ${RETIRED_ONLY.length} 个词（${RETIRED_ONLY.join("/")}）不作为词条出现在手册里`,
  hitsWords.length === 0,
  hitsWords.join("、") || "零命中",
);

/**
 * 每轮系统提示词（`buildManual()`）里同样不该有旧词表。
 * ⚠️ 「心动」这类词在提示词的**示例 JSON** 里是故意留的（新词表的示例），
 * 所以这里查的还是**结构性痕迹 + 独有词**。
 */
const hitsPrompt = [
  ...RETIRED_MARKERS.filter((m) => manualText.includes(m)),
  ...RETIRED_ONLY.filter((w) => asLexiconEntry(manualText, w)),
];
check(
  "①c 每轮提示词里也没有旧词表的结构性痕迹与独有词",
  hitsPrompt.length === 0,
  hitsPrompt.join("、") || "零命中",
);

check(
  "①d 提示词里明说了「情绪一律走 emotion.report、旧的那套没了」",
  manualText.includes("emotion.report") &&
    /情绪一律/.test(manualText) &&
    !manualText.includes('"kind":"state.report"'),
  manualText.includes("emotion.report") ? "" : "没提到 emotion.report",
);

/* ══════════════ ② 新词表 13 组都在手册里 ══════════════ */

console.log("");
console.log("=== ② 新词表 13 组：一组不少地在手册里（沿用真输出） ===");

const groups = lex.EMOTION_GROUPS;
check(
  `②a 词表是 13 组（实际 ${groups.length} 组）`,
  groups.length === 13,
  groups.map((g) => g.id).join(","),
);
check(
  `②b 词条总数 = ${lex.EMOTION_TERM_ENTRIES}（用户说的"约 217 词"）`,
  lex.EMOTION_TERM_ENTRIES === 217,
  String(lex.EMOTION_TERM_ENTRIES),
);

const groupsText = lex.renderEmotionLexiconGroups();
check(
  "②c 手册那一节就是 `renderEmotionLexiconGroups()` 的真输出（没有第二份词表）",
  lexiconSection.includes(groupsText),
);

const missingGroupParts = [];
for (const g of groups) {
  for (const need of [g.title, g.family, g.category, g.note]) {
    if (!lexiconSection.includes(need)) missingGroupParts.push(`${g.id}:${String(need).slice(0, 16)}`);
  }
  for (const term of g.terms) {
    if (!lexiconSection.includes(term)) missingGroupParts.push(`${g.id}:词「${term}」`);
  }
}
check(
  `②d 13 组的 title/family/category/note 与**全部 ${lex.EMOTION_TERM_ENTRIES} 个词条**都在手册里`,
  missingGroupParts.length === 0,
  missingGroupParts.slice(0, 6).join("、") || `零缺失（${lex.EMOTION_TERM_ENTRIES} 个词条）`,
);

check(
  "②e 手册里**没有**把词表正文塞进每轮提示词（按需取，用户按 token 付费）",
  !manualText.includes(groupsText.slice(0, 120)) && !manualText.includes(groupsText.slice(-120)),
);

/* ══════════════ ③ state.report 与它的 11 维字段都不在了 ══════════════ */

console.log("");
console.log("=== ③ state.report 整条退场（定义 / 类型 / case / 字段）===");

const schemaKinds = schema.ACTION_SCHEMA.map((a) => a.kind);
check("③a ACTION_SCHEMA 里没有 state.report", !schemaKinds.includes("state.report"));
check(
  "③b types.ts 的 AppAction 里没有 state.report 这个 kind",
  !/kind:\s*"state\.report"/.test(TYPES_SRC),
);
check("③c actions.ts 里没有 state.report 的 case", !ACTIONS_SRC.includes('case "state.report"'));
check(
  "③d action-meta.ts 的权限表里没有 state.report",
  !/^\s*"state\.report"\s*:/m.test(META_SRC),
);
check(
  "③e 它的数据源没了：state-dims.ts 已删除、store 里没有 stateSamples 字段",
  !existsSync("./src/lib/state-dims.ts") && !read("./src/lib/store.ts").includes("stateSamples:"),
);

/**
 * 11 维的字段名（`dims` / `energy` / `missing` / `curious`）不该藏在**任何**动作的
 * 字段声明里 —— 删动作时最容易把字段留在别处，那等于留了半截协议。
 */
const allFieldNames = schema.ACTION_SCHEMA.flatMap((a) => a.fields.map((f) => f.name));
const legacyFields = ["dims", "energy", "missing", "curious"].filter((f) =>
  allFieldNames.includes(f),
);
check(
  "③f 11 维的字段名（dims/energy/missing/curious）不在任何动作的字段里",
  legacyFields.length === 0,
  legacyFields.join(",") || "零命中",
);
check(
  "③g 源码里也没有旧词表的导出名（DIM_IDS / DIM_LABELS / LEGACY_ALIASES）",
  !/DIM_IDS|DIM_LABELS|LEGACY_ALIASES/.test(SCHEMA_SRC + TYPES_SRC + ACTIONS_SRC + META_SRC),
);

/* ══════════════ ④ 口径统一：只剩一条情绪上报通道 ══════════════ */

console.log("");
console.log("=== ④ 情绪只有一条上报通道（新词表）===");

check("④a emotion.report 在（上报一笔情绪）", schemaKinds.includes("emotion.report"));
check("④b emotion.lexicon 在（按需取词表）", schemaKinds.includes("emotion.lexicon"));
/**
 * ④c（2026-10 改写）——用户原话："ai 权限页那个情绪删了吧，如果适配都做好的话"。
 *
 * 原来是"两个动作都落在 `state_report` 这一项权限上"；现在反过来了：
 * 那两个绑定**必须没有**，而且 `state_report` 这一项权限**整条要从权限表里消失**。
 * 为什么敢删：`emotion.report` 已常驻、11 维花瓣与 `state.report` 早退场，
 * `emotion.lexicon` 只是取一份词表 —— 两个都写本机，没有"给他看"的必要。
 * ⚠️ 语义变了但**不是放宽**：没有权限 = 闸门直接执行（`action-gate.tsx`），
 *    所以这里连"闸门真的会放行"也一起盯着（④d）。
 */
const PERMS_SRC = read("./src/lib/permissions.ts");
const GATE_SRC = read("./src/components/action-gate.tsx");
check(
  "④c 两个动作都**不再挂权限**（权限表里也没有 state_report 这一项了）",
  !/"emotion\.report"\s*:\s*"state_report"/.test(META_SRC) &&
    !/"emotion\.lexicon"\s*:\s*"state_report"/.test(META_SRC) &&
    !/id:\s*"state_report"/.test(PERMS_SRC),
);
check(
  "④d 闸门对「没有权限」的动作是**直接放行**（`!current.permission → \"allow\"`，不许掉回「询问」弹卡片等用户点）",
  /!\s*current\.permission[\s\S]{0,80}?"allow"/.test(GATE_SRC),
);
check(
  "④d 常驻集合里有 emotion.report、没有 state.report",
  schema.ACTION_SCHEMA.length > 0 &&
    read("./src/lib/tool-select.ts").includes('"emotion.report",') &&
    !/"state\.report",/.test(read("./src/lib/tool-select.ts")),
);

/* ── 界面侧：心情显示只有一处实现（emotion-lexicon 的 moodDisplay）── */
console.log("");
console.log("=== ⑤ 界面侧：心情 → 中文名/颜色 只有一处实现 ===");
check(
  "⑤a moodDisplay / moodColor / MOOD_TERMS 由 `lib/emotion-lexicon.ts` 提供",
  typeof lex.moodDisplay === "function" &&
    typeof lex.moodColor === "function" &&
    Array.isArray(lex.MOOD_TERMS),
);
check(
  "⑤b 13 个代表词（每组一个）都在 217 词里",
  lex.MOOD_TERMS.length === 13 && lex.MOOD_TERMS.every((t) => lex.isEmotionTerm(t)),
  lex.MOOD_TERMS.join("、"),
);
check(
  "⑤c moodDisplay 对表外的旧值也不返回空（契约跟旧的那个一样）",
  lex.moodDisplay("calm").label === "calm" && lex.moodDisplay("心动").label === "心动",
  JSON.stringify([lex.moodDisplay("calm"), lex.moodDisplay("心动")]),
);
const uiFiles = [
  "./src/components/play/diary-view.tsx",
  "./src/components/play/space-view.tsx",
  "./src/lib/awareness.ts",
  "./src/lib/action-meta.ts",
];
const staleImports = uiFiles.filter((rel) =>
  /from\s+["']@\/lib\/state-dims["']/.test(read(rel)),
);
check(
  "⑤d 消费侧没有一处再 import `@/lib/state-dims`",
  staleImports.length === 0,
  staleImports.join("、") || "零命中",
);

/* ══════════════════════════════ 汇总 ══════════════════════════════ */

console.log("");
console.log("-".repeat(72));
if (REVERSE) {
  /**
   * 反向验证模式：**必须**出现失败，否则说明断言根本没在看真值。
   * 退出码反过来 —— 变红才算这条反向验证通过。
   */
  const ok = failures >= 1;
  console.log(
    ok
      ? `✅ 反向验证通过：注入了旧词表之后，脚本按预期变红（${failures} 项失败）—— 断言真的在看真值`
      : "❌ 反向验证失败：注入了旧词表，脚本却仍然全绿 —— 说明这些断言是空的、没在看真值",
  );
  process.exit(ok ? 0 : 1);
}
console.log(
  failures === 0
    ? `✅ 全部通过：${passed} 项断言 —— 情绪口径已统一到新词表（13 组 / ${lex.EMOTION_TERM_ENTRIES} 词条），旧的 11 维 state.report 整条退场`
    : `❌ ${failures} 项不通过（通过 ${passed} 项）`,
);
process.exit(failures === 0 ? 0 : 1);
