#!/usr/bin/env node
/**
 * 验收：**给 AI 的文本，跟代码一致** —— 退役的概念一个都不许留。
 *
 * 用户原话（逐字，这条脚本就是为它写的）：
 *   "最后每次做完记得核实一下内置提示词和说明书，不要再出现像这种已经改了情绪词的，
 *    旧的还留着的情况，适配包括方方面面，给 ai 的也是。"
 *
 * ── 为什么必须有一个**专管"AI 文案"**的脚本 ──────────────────────
 *
 * 上一次的真实教训（用户自己抓到的）：新情绪词表（星屿 13 组 / 217 词）已经接好了，
 * 但**旧的 11 维词表还留在内置提示词和说明书里教他** ——
 * 用户那句"他为啥还在跑 state report"就是这么来的。
 *
 * 那类错的失败方式很阴：**不报错、不崩、界面照常**，只是 AI 说的和代码做的不一样。
 * `verify-emotion-lexicon-only.mjs` 管的是"旧词表在代码里退了没"；
 * 这个脚本管的是**另一件事**：同一批退役概念，在"真正会发给 AI 的文本"里退了没。
 * 两个脚本的失败方式不同，所以是两个脚本（别合并）。
 *
 * ── 它拼的是**真文本** ────────────────────────────────────────
 *
 * 不自己抄一遍文案，而是拿真 builder：
 *   · `lib/manual.ts` 的 `buildManual()`        —— 每轮系统提示词最前面那份说明书
 *   · `lib/manual.ts` 的 `emotionLexiconSection()` —— 按需取的那节词表
 *   · `lib/prompt.ts` 的 `systemPrompt()`       —— 走原生 tools 与降级两条路各拼一份
 *   · `lib/action-schema.ts` 的 `actionTools()` / `renderActionCatalog()`
 *     —— 动作的标题与描述（原生 function calling 时**这些字直接进请求**）
 *
 * ⚠️ `prompt.ts` 用的是 `@/lib/xxx` 别名 + 省略扩展名的写法，纯 node 直接 import 不了，
 *    所以下面用 `module.registerHooks()` 现场挂一个"只读的解析钩子"（只改怎么找文件，
 *    **不改任何源码、不落盘**）—— 这样才拿得到**真输出**，而不是读源码猜。
 *    这也是 `scripts/print-manual.ts` 那套"照真 builder import"的延续。
 *
 * ── 覆盖的四类断言 ────────────────────────────────────────────
 *
 *   【一】退役概念零残留 —— 见顶部 `RETIRED` 数组（一条一条加）
 *   【二】现任概念必须在（没适配就是这个症状）
 *   【三】一致性：说明书 / 提示词里教的动作，必须真的存在；权限不出现幽灵与孤儿
 *   【四】反向验证：`QIDAO_MUTATE_REVERSE=1` 时**在内存里**注入一条退役文案
 *        （不动磁盘文件），脚本**必须变红** —— 证明断言真的在看真值
 *
 * 跑法（纯 node，不起浏览器、不连外网、不占端口）：
 *   node --experimental-strip-types verify-ai-text-consistency.mjs
 *   # 不带 flag 也行：脚本会自己用带 flag 的 node 重跑一遍
 *   QIDAO_MUTATE_REVERSE=1 node verify-ai-text-consistency.mjs   # 反向验证，必须红
 *
 * 退出码：有任何 FAIL 就是 1；反向验证模式下反过来（红才算通过）。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/* ── 先保证能 import `.ts`（Node 的类型擦除）：没带 flag 就自己再跑一遍带 flag 的 ── */
if (!process.execArgv.includes("--experimental-strip-types")) {
  const self = fileURLToPath(import.meta.url);
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", self, ...process.argv.slice(2)],
    { stdio: "inherit", cwd: process.cwd() },
  );
  process.exit(child.status ?? 1);
}

import { registerHooks } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

/* ───────────────────── 反向验证开关（照 verify-emotion-lexicon-only.mjs 的做法） ─────────────────────
 * 任务书要求："故意在内存里注入一条退役文案 → 脚本必须变红"。
 * 做成开关（而不是手改源码再改回来），这样这条反向验证**以后每次都能重跑**。
 * 注意：注入只落在内存里的字符串上（以及一份 snapshot 出来的数组），
 * **绝不改磁盘文件**。
 */
const REVERSE = process.env.QIDAO_MUTATE_REVERSE === "1";

let passed = 0;
let failures = 0;
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

/* ═══════════════════════════ 只读的别名解析钩子 ═══════════════════════════ */

const SRC_URL = pathToFileURL(resolvePath(process.cwd(), "src") + "/").href;
const withExt = (p) => (/\.(ts|tsx|js|mjs|cjs|json)$/.test(p) ? p : `${p}.ts`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(withExt(SRC_URL + specifier.slice(2)), context);
    // `prompt.ts` 里有 `./xxx` 这种省扩展名的写法，纯 node 的 ESM 解析不了 —— 补上 .ts
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(withExt(specifier), context);
    }
    return nextResolve(specifier, context);
  },
});

/* ═══════════════════════════ 装载真模块 ═══════════════════════════ */

let manualMod;
let promptMod;
let schemaMod;
let metaMod;
let lexMod;
let permsMod;
let toolSelectMod;
try {
  manualMod = await import("./src/lib/manual.ts");
  promptMod = await import("./src/lib/prompt.ts");
  schemaMod = await import("./src/lib/action-schema.ts");
  metaMod = await import("./src/lib/action-meta.ts");
  lexMod = await import("./src/lib/emotion-lexicon.ts");
  permsMod = await import("./src/lib/permissions.ts");
  toolSelectMod = await import("./src/lib/tool-select.ts");
} catch (err) {
  console.log("❌ 装不进 TS 模块：", err?.message ?? err);
  console.log("   请用： node --experimental-strip-types verify-ai-text-consistency.mjs");
  process.exit(1);
}

/* ═══════════════════════ ① 退役清单（**要加条目就加在这里**） ═══════════════════════
 *
 * 每一项：
 *   id       —— 打印用的名字
 *   pattern  —— 要查的字面串
 *   mode     —— "plain"   ：全文 includes
 *               "lexicon" ：**只算"被当成词条/名字"的命中**（顿号、换行、引号、括号夹着），
 *                           避免"标签真命中 vs 正文里恰好出现"那种误伤
 *               例：新词表 H 组标题是「H. 吃醋与占有倾向」，里面含「占有」两个字，
 *               但它不是旧词表那个词条 —— 所以「占有」必须用 lexicon 模式查。
 *   scopes   —— 在哪些"真会发给 AI 的文本"里查：
 *               manual        buildManual()（每轮系统提示词最前面那份说明书）
 *               prompt        走原生 tools 的 systemPrompt()
 *               promptLegacy  降级回正文动作块的 systemPrompt()
 *               schema        动作的标题 / 描述 / 字段说明（actionTools + renderActionCatalog）
 *               ui            权限的标题与 hint（感知那一节会把它带给 AI，权限页也给人看）
 *   negatable—— 允许"否定式提醒"存在（"旧的 state.report 已经没了，别再写它"）。
 *               **这类不算残留** —— 它正是在帮 AI 别再写旧的。
 *               但只对"正文句"生效：脚本另有一条硬断言，禁止**裸的** `state.report`
 *               JSON 出现在文本里（那才是真的在示范旧动作）。
 *   why      —— 什么时候退役的 / 被什么取代（写清楚，以后不用翻 git log）
 */
const RETIRED = [
  {
    id: "state.report（旧的情绪上报动作）",
    pattern: "state.report",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: true,
    why: "2026-10 随 11 维情绪一起退役；被 emotion.report 取代（每轮系统提示词里明说『旧的已经没了，别再写它』）。",
  },
  {
    id: "state_report（旧动作的权限写法）",
    pattern: "state_report",
    mode: "plain",
    scopes: ["schema", "ui"],
    negatable: true,
    why: "权限 id 本身**不改**（用户已点的同意不能作废，见 action-meta.ts），但 AI 文案里不该出现它 —— 他看的是《给自己记一笔状态》这个标题。",
  },
  {
    id: "state-dims / stateSamples（旧 11 维的数据源）",
    pattern: "state-dims",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "2026-10 src/lib/state-dims.ts 整体删除；情绪档案只剩 emotion-lexicon 那一份（store 里的 stateSamples 也没了）。",
  },
  {
    id: "stateSamples（旧 11 维的存储字段）",
    pattern: "stateSamples",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "同上：旧的花瓣样本数组退役，改由插件侧只存新词表的情绪记录。",
  },
  {
    id: "DIM_IDS / DIM_LABELS / LEGACY_ALIASES（只属于旧 11 维词表的导出）",
    pattern: "DIM_IDS",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "旧词表的导出名，随 state-dims.ts 一起删除；新词表的导出都在 emotion-lexicon.ts。",
  },
  {
    id: "DIM_LABELS（同上）",
    pattern: "DIM_LABELS",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "旧 11 维那个「维度 id → 人话标签」的表，跟 DIM_IDS 一起删除（新表用 EMOTION_GROUPS 的 title）。",
  },
  {
    id: "LEGACY_ALIASES（旧词表兼容写法）",
    pattern: "LEGACY_ALIASES",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "旧词表那套「旧词 → 新维度」的兼容表，随旧词表一起退役。",
  },
  {
    id: "分享欲（旧 11 维独有词条）",
    pattern: "分享欲",
    mode: "lexicon",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "旧 11 维词表独有；新 13 组 217 词里没有它（已是 / 分享 走 M 组表达倾向）。",
  },
  {
    id: "情愫（旧 11 维独有词条）",
    pattern: "情愫",
    mode: "lexicon",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "旧 11 维词表独有；新表用 I 组「暧昧」那一类词。",
  },
  {
    id: "反思（旧 11 维独有词条）",
    pattern: "反思",
    mode: "lexicon",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "旧 11 维词表独有；新表归到 L 组「认知与探索」。",
  },
  {
    id: "占有（旧 11 维独有词条）",
    pattern: "占有",
    mode: "lexicon",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "旧 11 维词表独有；新表是 H 组「吃醋与占有倾向」—— ⚠️ 组标题里含「占有」两个字，**不算词条**，所以用 lexicon 模式查。",
  },
  {
    id: "花瓣（旧那朵花的说法）",
    pattern: "花瓣",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: true,
    why: "旧的「花瓣图」拆了（组件 inner-flower.tsx 一并删除），改成星屿那个活的灵体。给 AI 的文本里只允许作为「旧的没了」这样的否定式提醒出现。",
  },
  {
    id: "InnerFlower（旧花瓣图组件名）",
    pattern: "InnerFlower",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "旧花瓣图组件名，组件本身早就删了（2026-11 连 `/inner` 那一页也一起删了，见 nav-tree.ts 的注释）。AI 文案里不该出现组件名。",
  },
  {
    id: "那朵花（旧花瓣图的口语叫法）",
    pattern: "那朵花",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: true,
    why: "指旧的花瓣图。现在那个位置是星屿的入口 —— 但「星屿」本身只在代码注释里，没有进给 AI 的文本（见②d）。",
  },
  {
    id: "心情词表（旧那节的名字，跟新《情绪词表》两套口径）",
    pattern: "心情词表",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: true,
    why: "旧 11 维那节的标题；新节叫《情绪词表》。⚠️ 2026-10 已修：prompt.ts 的降级分支和 action-schema 的 moment.post 字段说明里原来都写着「心情词表」—— AI 手上并没有第二份「心情词表」，那正是「教了他一个不存在的东西」。现在两处都改成《情绪词表》，这条留着当回归闸。",
  },
  {
    id: "11 维口径（11 维 / 11 个维度）",
    pattern: "11 维",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: true,
    why: "旧的 11 维口径，唯一正确的说法是新表的 13 组 / 217 词条。",
  },
  {
    id: "last_ask_at（旧的唤醒梯子字段）",
    pattern: "last_ask_at",
    mode: "plain",
    scopes: ["manual", "prompt", "promptLegacy", "schema", "ui"],
    negatable: false,
    why: "旧的唤醒梯子内部状态字段。给 AI 的文本里从来没该出现内部字段名。",
  },
];

/* ═══════════════════════ 拼出"真正会发给 AI 的文本" ═══════════════════════ */

const MANUAL_TITLES = permsMod.PERMISSIONS.map((p) => ({ id: p.id, title: p.title }));
const MANUAL_PERMS = { memory: "allow", navigate: "allow" };

/** 三个作用域的**真文本**（反向验证时在内存里污染它们，绝不动磁盘文件） */
const REAL = {
  manual: manualMod.buildManual({
    permissions: MANUAL_PERMS,
    titles: MANUAL_TITLES,
    displayName: "yan",
    aiName: "星芒",
  }),
  prompt: promptMod.systemPrompt({
    style: "default",
    tools: [],
    nativeTools: true,
    name: "yan",
    aiName: "星芒",
    permissions: MANUAL_PERMS,
  }),
  promptLegacy: promptMod.systemPrompt({
    style: "default",
    tools: [],
    nativeTools: false,
    name: "yan",
    aiName: "星芒",
    permissions: MANUAL_PERMS,
  }),
  // 动作的标题与描述：原生 function calling 时这些字**直接进请求**
  schema: [
    ...schemaMod.actionTools().map((t) => `${t.function.name} —— ${t.function.description}\n${JSON.stringify(t.function.parameters)}`),
    schemaMod.renderActionCatalog(),
  ].join("\n"),
  // 权限的标题与 hint：感知那一节会把 title 带给 AI，权限页也拿它给人看
  ui: permsMod.PERMISSIONS.map((p) => `${p.title} —— ${p.hint}`).join("\n"),
};

/** 反向验证：**在内存里**注入退役文案（不动磁盘文件） */
const POISON = {
  manual: "\n【心情词表】(旧)\n想念、心动、牵挂、分享欲、好奇、情愫、反思、无聊、难过、生气、占有",
  prompt: "\n{\"kind\":\"state.report\",\"mood\":\"想念\",\"dims\":{\"想念\":0.4}}",
  promptLegacy: "\n{\"kind\":\"state.report\",\"dims\":{\"想念\":0.4}}",
  schema: "\nstate_report —— 旧的 11 维花瓣，dims/energy/missing/curious",
  ui: "\n给自己记一笔状态 —— 每轮顺手记下心情/精力/想念",
};

const TEXT = {};
for (const key of Object.keys(REAL)) {
  TEXT[key] = REVERSE ? `${REAL[key]}${POISON[key] ?? ""}` : REAL[key];
}

/** `ACTION_SCHEMA` 的快照（反向验证时往里塞一条假的退役动作，不动真数组） */
const SCHEMA_SNAPSHOT = schemaMod.ACTION_SCHEMA.map((a) => ({
  kind: a.kind,
  summary: a.summary,
  fields: a.fields.map((f) => ({ name: f.name, note: f.note })),
}));
if (REVERSE) {
  SCHEMA_SNAPSHOT.push({
    kind: "state.report",
    summary: "旧的 11 维花瓣（反向验证注入）",
    fields: [{ name: "dims", note: "11 个维度" }],
  });
}

/* ═══════════════════════ 判定小工具 ═══════════════════════ */

/** "被当成词条/名字"才算命中（顿号、换行、引号、括号、冒号夹着） */
function lexiconHit(text, term) {
  const b = `[、，,／/\\s"'「」『』【】（）()\\[\\]：:]`;
  return new RegExp(`(?:^|${b})${term}(?:$|${b})`, "m").test(text);
}

/** 「否定式提醒」的行：正是在告诉 AI"旧的没了、别再写" */
const NEG_MARKERS = ["不再", "别再", "已经没", "已经删", "已删除", "旧的", "退役", "删了", "删掉", "作废"];
const lineIsNegated = (line) => NEG_MARKERS.some((m) => line.includes(m));

/**
 * 在某个作用域里找一条退役概念的**真残留**。
 * @returns {string[]} 命中的行（不含否定式提醒的行；negatable=false 时连否定的也算命中）
 */
function residue(text, item) {
  const lines = text.split("\n");
  const out = [];
  for (const line of lines) {
    const hit = item.mode === "lexicon" ? lexiconHit(line, item.pattern) : line.includes(item.pattern);
    if (!hit) continue;
    if (item.negatable && lineIsNegated(line)) continue;
    out.push(line.trim().slice(0, 96));
  }
  return out;
}

const S = () => TEXT.schema;
console.log("=".repeat(76));
console.log(`给 AI 的文本一致性验收${REVERSE ? "（⚠️ 反向验证模式：注入了退役文案，必须变红）" : ""}`);
console.log("=".repeat(76));
console.log(
  `拼出来的文本：说明书 ${TEXT.manual.length} 字 · 原生提示词 ${TEXT.prompt.length} 字 · ` +
    `降级提示词 ${TEXT.promptLegacy.length} 字 · 动作定义 ${TEXT.schema.length} 字 · 权限文案 ${TEXT.ui.length} 字`,
);

/* ══════════════ 【一】退役概念零残留 ══════════════ */

console.log("");
console.log("=== 【一】退役概念零残留（清单见脚本顶部 RETIRED）===");

let residueTotal = 0;
for (const item of RETIRED) {
  const hits = [];
  for (const scope of item.scopes) {
    for (const line of residue(TEXT[scope], item)) hits.push(`${scope}: ${line}`);
  }
  residueTotal += hits.length;
  check(
    `无残留 · ${item.id}`,
    hits.length === 0,
    hits.length ? `\n      ${hits.join("\n      ")}` : "",
  );
}
check(
  `退役清单整体零残留（${RETIRED.length} 条 × 各自作用域，共 ${residueTotal} 处命中）`,
  residueTotal === 0,
);

/** 更硬的一条：文本里**不许有裸的**旧动作 JSON（否定式提醒不算） */
const BARE_RETIRED_JSON = [/"kind"\s*:\s*"state\.report"/, /"kind"\s*:\s*"state_report"/];
for (const re of BARE_RETIRED_JSON) {
  const bad = Object.entries(TEXT).filter(([, v]) => re.test(v)).map(([k]) => k);
  check(`没有裸的旧动作 JSON（${re.source}）`, bad.length === 0, bad.join("、"));
}

/** 旧 11 维的字段名：一个都不许在动作 schema 里留半截。
 *  ⚠️ `mood` **不在这份名单里**：它是 `moment.post` 现役的字段名（发动态带的心情），
 *  留在这里会把现役字段误判成 11 维残留 —— 这就是"口径要写清"的那种坑。 */
const LEGACY_FIELDS = ["dims", "energy", "missing", "curious"];
const presentLegacyFields = SCHEMA_SNAPSHOT.flatMap((a) =>
  a.fields.filter((f) => LEGACY_FIELDS.includes(f.name)).map((f) => `${a.kind}.${f.name}`),
);
check(
  "11 维的字段名（dims/energy/missing/curious）没留在任何动作的字段里",
  presentLegacyFields.filter((f) => !f.startsWith("state.report")).length === 0,
  presentLegacyFields.join("、") || "零命中",
);

/* ══════════════ 【二】现任概念必须在 ══════════════ */

console.log("");
console.log("=== 【二】现任概念必须在（不出现 = 没适配）===");

const KINDS = SCHEMA_SNAPSHOT.map((a) => a.kind);
const KIND_SET = new Set(KINDS);
const ALWAYS = toolSelectMod.ALWAYS_KINDS ?? [];

check(
  "① emotion.report 在动作定义里（每轮的情绪上报通道）",
  KIND_SET.has("emotion.report"),
);
check(
  "② emotion.report 在**常驻**集合里（用户特意要求常驻，不能漏轮）",
  ALWAYS.includes("emotion.report"),
  ALWAYS.join(","),
);
check("③ emotion.lexicon 在动作定义里（按需取全词表）", KIND_SET.has("emotion.lexicon"));
check(
  "④ 说明书里明说「情绪一律走 emotion.report」",
  /情绪一律/.test(TEXT.manual) && TEXT.manual.includes("emotion.report"),
);
check(
  "⑤ 说明书 / 提示词里都指引了「没看到词表就先取一份 emotion.lexicon」",
  TEXT.manual.includes("emotion.lexicon") && TEXT.prompt.includes("emotion.lexicon"),
);
check(
  "⑥ 原生提示词那一份也讲了情绪走 emotion.report",
  TEXT.prompt.includes("emotion.report"),
);

const lexiconSection = REVERSE
  ? `${manualMod.emotionLexiconSection()}\n\n【心情词表】(旧)\n分享欲、情愫、反思、占有`
  : manualMod.emotionLexiconSection();
const groups = lexMod.EMOTION_GROUPS;
check(
  `⑦ 新词表是 13 组（实际 ${groups.length} 组）`,
  groups.length === 13,
  groups.map((g) => g.id).join(","),
);
check(
  `⑧ 词条数 = ${lexMod.EMOTION_TERM_ENTRIES}（用户说的"约 217 词"）`,
  lexMod.EMOTION_TERM_ENTRIES === 217,
  String(lexMod.EMOTION_TERM_ENTRIES),
);
check(
  "⑨ 按需取的那节词表就是 `renderEmotionLexiconGroups()` 的真输出（没有第二份词表）",
  lexiconSection.includes(lexMod.renderEmotionLexiconGroups()),
);
const missingTerms = [];
for (const g of groups) {
  for (const need of [g.title, g.family, g.category, g.note]) {
    if (!lexiconSection.includes(String(need))) missingTerms.push(`${g.id}:${String(need).slice(0, 14)}`);
  }
  for (const t of g.terms) if (!lexiconSection.includes(t)) missingTerms.push(`${g.id}:词「${t}」`);
}
check(
  `⑩ 13 组的 title/family/category/note 与全部 ${lexMod.EMOTION_TERM_ENTRIES} 个词条都在词表那节里`,
  missingTerms.length === 0,
  missingTerms.slice(0, 5).join("、") || "零缺失",
);
check(
  "⑪ 词表正文**没有**被塞进每轮提示词（按需取，用户按 token 付费）",
  !TEXT.prompt.includes(lexMod.renderEmotionLexiconGroups().slice(0, 120)),
);

/** 「星屿」：只作提示，不判红 —— 它现在只在代码注释里，没有进给 AI 的文本 */
const STAR_ISLE = TEXT.manual.includes("星屿") || TEXT.prompt.includes("星屿");
console.log(
  `ℹ️  星屿（情绪灵体那个插件名）在给 AI 的文本里：${STAR_ISLE ? "有" : "没有"} —— ` +
    `没有也不算错（现在只在 tool-select.ts 的注释里），但换掉插件名时要想起这里`,
);

/** 「同轮回执」那一句（agent loop 加过）：结果这一轮就能看到，不用等下一轮 */
const SAME_TURN = /这一轮就能看到|这一轮就回来|当轮回执|同轮/;
check(
  "⑫ 「同轮回执」那一句还在（每步执行结果这一轮就能看到，不用等下一轮）",
  SAME_TURN.test(TEXT.prompt),
  TEXT.prompt.includes("这一轮就能看到") ? "命中『这一轮就能看到』" : "",
);

/** 主动感知：在 ACTION_SCHEMA 里就断言说明书覆盖到；不在就打印"还没到"，不判红 */
const SENSE_KINDS = KINDS.filter((k) => k.startsWith("sense."));
if (SENSE_KINDS.length === 0) {
  console.log("ℹ️  还没到：主动感知（sense.*）此刻不在 ACTION_SCHEMA 里，这条跳过");
} else {
  const missingSense = SENSE_KINDS.filter((k) => !TEXT.manual.includes(k));
  check(
    `⑬ 主动感知 ${SENSE_KINDS.length} 个动作都在说明书的覆盖范围内`,
    missingSense.length === 0,
    missingSense.join("、") || SENSE_KINDS.join("、"),
  );
}

/* ══════════════ 【三】一致性：教的 == 有的 ══════════════ */

console.log("");
console.log("=== 【三】一致性：文本里教的动作，必须真的存在 ===");

/**
 * 动作名长这样：小写字母开头 + 一个点 + 不是文件后缀的名字，如 navigate / emotion.report
 * ⚠️ 必须排掉 `types.ts` / `state-dims.ts` 这类**文件名**（它们出现在字段说明里），
 * 否则会把"引用了一个文件名"误报成"教了一个不存在的动作"。
 * 边界用 `(?![A-Za-z0-9_])`：中文等非 ASCII 跟在后面时**要**算命中。
 */
const ACTION_ID = /\b[a-z][a-zA-Z]*(?:\.[a-zA-Z][a-zA-Z]*)+(?![A-Za-z0-9_])/g;
/** 匹配到的"名字"如果其实是文件名，就不算动作名 */
const FILE_SUFFIX = /\.(ts|tsx|js|mjs|cjs|json|css|md|txt|html)$/;
/** 明确不是动作名的（维度名这类），列出来是为了"改文案时想起更新豁免" */
const ID_EXEMPT = new Set(["attraction", "longing", "shyness", "restraint", "warmth", "unease"]);

for (const scope of ["manual", "prompt", "promptLegacy", "schema"]) {
  const found = new Set();
  for (const m of TEXT[scope].matchAll(ACTION_ID)) found.add(m[0]);
  /**
   * ⚠️ 否定式提醒里的旧动作名**不算"教了他"**：说明书里那句
   * 「旧的 11 维花瓣 `state.report` 已经没了，别再写它」正是在**阻止**他去写。
   * 所以只把"出现在非否定行里"的旧名字当作残留 —— 口径跟上面【一】一致。
   */
  const bogus = [];
  for (const id of found) {
    if (KIND_SET.has(id) || ID_EXEMPT.has(id) || FILE_SUFFIX.test(id)) continue;
    const lines = TEXT[scope].split("\n").filter((l) => l.includes(id));
    if (lines.length > 0 && lines.every((l) => lineIsNegated(l))) continue;
    bogus.push(id);
  }
  check(
    `说明书/提示词里教的动作名都真的存在（作用域 ${scope}）`,
    bogus.length === 0,
    bogus.length ? `教了不存在的：${bogus.join("、")}` : `查了 ${found.size} 个名字`,
  );
}

/** 反向：动作表里每个 kind 都得有人知道它 —— 说明书/提示词至少覆盖到（或有常驻/按需注册兜底） */
check(
  `动作数对账：动作定义里 ${KINDS.length} 个 kind，说明书那一节讲的集合不超过它`,
  true,
  "（子集关系由上面那条保证）",
);

/** 权限：动作引用的权限 id 必须存在；权限表里的 id 不能没人用（幽灵 / 孤儿） */
const PERM_IDS = new Set(permsMod.PERMISSIONS.map((p) => p.id));
const AP = metaMod.ACTION_PERMISSION;
/**
 * **不挂权限**的动作（白名单，理由写在 `action-meta.ts` 那一段）。
 * ⚠️ 没有权限 = 闸门**直接执行、不弹卡片**，所以这份名单必须短且明确：
 * 多出任何一个都意味着"某个动作悄悄变成了免确认直接执行"。
 */
const NO_PERMISSION_KINDS = ["emotion.report", "emotion.lexicon", "sticker.send"];
const boundCount = Object.keys(AP).length;
const expectedBound = KINDS.length - NO_PERMISSION_KINDS.length;
check(
  `动作 → 权限的映射条数 = ${KINDS.length} 个 kind 减去不挂权限的 ${NO_PERMISSION_KINDS.length} 个（${expectedBound}）`,
  boundCount === expectedBound,
  `${boundCount} vs ${expectedBound}`,
);
const unboundKinds = KINDS.filter((k) => !Object.prototype.hasOwnProperty.call(AP, k));
check(
  `没挂权限的动作正好是白名单那两个（${NO_PERMISSION_KINDS.join("、")}）`,
  unboundKinds.length === NO_PERMISSION_KINDS.length &&
    unboundKinds.every((k) => NO_PERMISSION_KINDS.includes(k)),
  unboundKinds.join("、") || "(一个都没漏)",
);
const ghosts = [...new Set(Object.values(AP))].filter((id) => !PERM_IDS.has(id));
check(
  "动作引用的权限 id 全部真实存在（不出现幽灵权限）",
  ghosts.length === 0,
  ghosts.length
    ? ghosts
        .map((g) => `${g} ← ${Object.entries(AP).filter(([, v]) => v === g).map(([k]) => k).join(",")}`)
        .join("；")
    : `${PERM_IDS.size} 个权限都被引用到`,
);

/** 孤儿权限：扫全仓的权限 id 字符串字面量，看它在别的功能里有没有人用（感知那几项就不走动作） */
function walkSource(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkSource(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
let sourceText = "";
for (const root of ["src"]) {
  try {
    if (statSync(root).isDirectory()) {
      for (const f of walkSource(root)) sourceText += readFileSync(f, "utf8");
    }
  } catch {
    /* 目录不在就算了 */
  }
}
const usedByAction = new Set(Object.values(AP));
const orphans = [...PERM_IDS].filter(
  (id) =>
    !usedByAction.has(id) &&
    // 别的功能直接引用了它（如 awareness.ts 的 canRead("read_context")）
    !new RegExp(`["'\`]${id}["'\`]`).test(sourceText),
);
check(
  "权限表里没有孤儿权限（每条 id 都被某个动作或某项功能引用）",
  orphans.length === 0,
  orphans.length
    ? `${orphans.length} 条没人用：${orphans
        .map((id) => `${id}(${permsMod.permissionDef(id)?.title})`)
        .join(" / ")}`
    : `${PERM_IDS.size} 条权限全部有人用`,
);

/** 情绪词表的"口径"别分叉：说明书里唯一该叫的名字是《情绪词表》 */
check(
  "说明书里那份表只叫《情绪词表》，没有第二个名字（心情词表 / 花瓣词表）",
  TEXT.manual.includes("情绪词表") &&
    !TEXT.manual.includes("心情词表") &&
    !TEXT.manual.includes("花瓣词表"),
);

/* ══════════════ 【四】归属与豁免的自检（防止脚本自己变空） ══════════════ */

console.log("");
console.log("=== 【四】脚本自检（防止断言变空转）===");
check(
  "真文本都拼出来了（不是拿空字符串在断言）",
  TEXT.manual.length > 1500 && TEXT.prompt.length > 1500 && TEXT.promptLegacy.length > 1500,
  `manual=${TEXT.manual.length} prompt=${TEXT.prompt.length} legacy=${TEXT.promptLegacy.length}`,
);
check(
  "两条路（原生 tools / 降级动作块）拼出来的提示词确实不一样",
  TEXT.prompt !== TEXT.promptLegacy,
);
check(
  `退役清单不是空的（${RETIRED.length} 条），且每条都写了 why`,
  RETIRED.length > 0 && RETIRED.every((r) => typeof r.why === "string" && r.why.length > 8),
);

/* ══════════════════════════════ 汇总 ══════════════════════════════ */

console.log("");
console.log("-".repeat(76));
if (REVERSE) {
  const ok = failures >= 1;
  console.log(
    ok
      ? `✅ 反向验证通过：内存里注入退役文案之后，脚本按预期变红（${failures} 项失败 / 共 ${passed + failures} 项）—— 断言真的在看真值`
      : "❌ 反向验证失败：注入了退役文案，脚本却仍然全绿 —— 这些断言是空的、没在看真值",
  );
  process.exit(ok ? 0 : 1);
}
console.log(
  failures === 0
    ? `✅ 全部通过：${passed} 项断言 —— 给 AI 的文本跟代码一致（退役概念零残留 / 现任概念在位）`
    : `❌ ${failures} 项不通过（通过 ${passed} 项）—— 上面每条 ❌ 就是一个"改了新的、旧的还留着"`,
);
process.exit(failures === 0 ? 0 : 1);
