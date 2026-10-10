/**
 * 验收脚本：P3 **按需注册**的召回对账 —— 拿 38 条"用户会这么说"的句子，
 * 逐条问一句：`selectActionKinds()` 到底有没有**漏发动作**？
 *
 * ── 为什么这是 P3 唯一的红线 ────────────────────────────────────
 *
 * 按需注册的失败方式**不是报错**，而是"他说我做不到"：少给一个动作，用户会
 * 以为功能坏了（多发几个只是多花一点 token）。所以判断规则好坏不能看"跑没跑通"，
 * 只能拿真句子逐条对账 —— 这就是这个脚本干的事：
 *
 *   A. **召回（红线）**：`RECALL_CASES` 每条的 `mustInclude` 一个都不能漏，并且
 *      **逐条打印**"这句话 → 命中哪组（命中哪个词）→ 发了几个 → 漏了几个"，让人能
 *      肉眼核一遍"它凭什么听懂这句"。⚠️ "没报错" ≠ "召回对"：全发安全网会遮住
 *      关键词的盲区（全发的样本必然不漏），所以对账表额外标出「若无全发会漏哪些」，
 *      并把"真按关键词筛的样本"与"靠全发兜的样本"分开数 —— 这才是规则真实覆盖度。
 *   B. 常驻七个（`navigate`/`memory.add`/`ui.highlight`/`emotion.report` + 主动感知便宜的三个
 *      样本（含反例、含安全网样本）里都必须出现。
 *   C. 不误伤：`NO_SIDE_EFFECT_CASES` 的 `mustKeep` 必须都在。
 *   D. 安全网：没有任何关键词的话（"嗯嗯"/"好的谢谢"/"在吗"/"？？"…）必须走**全发**
 *      （`enabled !== false` 时 = 70 个一个不少）。
 *   E. 省得动：≥80% 的召回样本发出 < 70 个，整体平均 ≤ 70 × `MAX_TOOLS_RATIO`。
 *   F. 纯函数：同一输入连算两次逐字相同；顺序稳定（跟 `ALL_KINDS` 一致，不靠 `Set`
 *      的遍历顺序）、无重复、无外来 kind。
 *   G. 权限：`allowed` 返回 false 的动作**绝不出现**，常驻那四个也一样（拒绝过就别发）。
 *   H. （附赠）兜底规则文本 + 那份"全部动作名"清单真的覆盖 70 个 ——
 *      "筛掉的动作 ≠ 不存在"的唯一凭据。
 *
 * ── 怎么做到"真的"（以及为什么规则会边验边改）──────────────────
 *
 * 纯 node、**不起浏览器、不连外网**、不动任何源码：
 *   · 规则本体 `src/lib/tool-select.ts` 是**零 import** 的，直接
 *     `node --experimental-strip-types` import 真模块来测（顺带断言它确实零 import）；
 *   · 语料优先 `.ts`（strip-types 直接擦类型）；若只有带 TS 语法（`as const`）的 `.mjs`，
 *     纯 node 会死在 `SyntaxError: Unexpected identifier 'as'`（strip-types 不擦 .mjs）——
 *     此时读源码剥掉 `as const` 经 data: URL 导入兜住，并在 0.11 把这件事钉成 FAIL
 *     报给 Lead（语料不是我的写范围）；
 *   · `src/lib/action-schema.ts` 带 `@/lib/types` 别名 import，纯 node 解析不了 ——
 *     所以 70 个 kind→组 的**抄件在脚本内**，但**不是靠信任**：【0】拿 `action-schema.ts`
 *     的**源码文本**正则抽出来，跟抄件逐项对账（kind 顺序 + 分组都要一致）；
 *   · "这句话凭什么命中这组"用规则自己导出的 `explainSelection()`（真口），拿不到才退回
 *     "从源码抽关键词表"的镜像；两者的**命中结果逐条比对**（0.13）保证诊断不是自说自话；
 *   · 规则还在被改（阈值从 `MIN_HIT_GROUPS>=2` 改成 `MIN_HIT_WORDS>=1` 就是被这些数字逼的），
 *     所以脚本**从源码读当前判据**，并把"阈值/口径"下的**假设模拟**跟真实规则逐条对齐
 *     （0.12）—— 只有对齐了，下面那些"若无全发会漏什么""补哪些词就够了"的结论才算数；
 *   · 【0】会打印本次验收针对的 `tool-select.ts` / corpus **sha256 前 12 位**：规则是活文件，
 *     报告里一律以这个 hash 为准。
 *
 * 跑法：
 *   node --experimental-strip-types verify-tool-recall.mjs
 * 退出码 0 = 全过；非 0 = 有断言失败（报告里逐条写清哪个组为什么红）。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as toolSelect from "./src/lib/tool-select.ts";

/* 用命名空间导入 + 取值（而不是命名 import）：规则文件正在被改，缺一个导出不该让
   整个脚本 link 失败 —— 缺了由【0】的断言报"导出过期"，比崩掉好排查。 */
const { selectActionKinds, ALL_GROUPS, ALWAYS_KINDS, FALLBACK_RULE, renderToolNameList } =
  toolSelect;
const explainSelection = toolSelect.explainSelection;

/* ─────────────────────── 动作清单：70 个 kind → 组（抄件） ─────────────────────── */

/**
 * `src/lib/action-schema.ts` 的 `ACTION_SCHEMA`，**顺序与它完全一致**。
 *
 * 为什么抄一份：那个文件 `import type { AppAction } from "@/lib/types"`，
 * 纯 node 里 `@/` 解析不了；而"漏没漏某个动作"必须精确到 kind。
 *
 * ⚠️ 这份抄件**不是靠信任**：【0】会用正则从 `action-schema.ts` 源码里抽出
 * 同样的 kind→组，跟它逐项比对；走散了就直接 FAIL（改动作后记得同步这里）。
 */
const ACTION_SCHEMA_KIND_GROUP = [
  ["navigate", "界面"],
  ["media.play", "媒体"],
  ["media.pause", "媒体"],
  ["media.next", "媒体"],
  ["media.prev", "媒体"],
  ["media.volume", "媒体"],
  ["media.seek", "媒体"],
  ["media.playTrack", "媒体"],
  ["media.playEmbed", "媒体"],
  ["appearance.theme", "界面"],
  ["appearance.font", "界面"],
  ["appearance.textColor", "界面"],
  ["ui.highlight", "界面"],
  ["ui.scroll", "界面"],
  ["ui.panel", "界面"],
  ["ui.model", "界面"],
  ["ui.style", "界面"],
  ["ui.toggle", "界面"],
  ["chat.rename", "聊天"],
  ["chat.pin", "聊天"],
  ["docs.write", "聊天"],
  ["docs.archive", "聊天"],
  ["learn.addCard", "学习"],
  ["reminder.add", "提醒"],
  ["cron.add", "提醒"],
  ["emotion.report", "自我"],
  ["emotion.lexicon", "自我"],
  ["memory.add", "记忆"],
  ["persona.set", "自我"],
  ["play.gobang", "玩"],
  ["play.truth", "玩"],
  ["play.recordResult", "玩"],
  ["learn.openReading", "学习"],
  ["learn.speak", "学习"],
  ["learn.removeCard", "学习"],
  ["media.speak", "媒体"],
  ["ambience.play", "媒体"],
  ["media.import", "媒体"],
  ["chat.delete", "聊天"],
  ["docs.delete", "聊天"],
  ["diary.deleteLast", "记录"],
  ["media.clear", "媒体"],
  ["data.reset", "数据"],
  ["settings.setUpstream", "数据"],
  ["moment.post", "记录"],
  ["letter.write", "记录"],
  ["date.add", "记录"],
  ["todo.add", "记录"],
  ["diary.add", "记录"],
  ["chat.new", "聊天"],
  ["memory.update", "记忆"],
  ["memory.remove", "记忆"],
  ["reminder.update", "提醒"],
  ["reminder.remove", "提醒"],
  ["reminder.done", "提醒"],
  ["todo.done", "记录"],
  ["todo.remove", "记录"],
  ["date.remove", "记录"],
  ["moment.remove", "记录"],
  ["letter.remove", "记录"],
  ["tool.call", "工具"],
  ["http.call", "工具"],
  /**
   * 2026-10 新增的**联网**两个（`web.search` / `web.fetch`）——
   * 手机版第一次真的有"搜网页 / 读正文"（走 Capacitor 自带的原生 HTTP，绕开跨域）。
   * ⚠️ 顺序必须跟 `action-schema.ts` 的声明顺序一致（【0】会逐项对账）。
   */
  ["web.search", "工具"],
  ["web.fetch", "工具"],
  /**
   * 2026-10 新增的「主动感知」六个（零参数，调用即"看一眼现在的状态"）——
   * 用户原话："我给开他那么多权限，其实是希望他**主动的去用**"。
   * ⚠️ 顺序必须跟 `action-schema.ts` 的声明顺序一致（【0】会逐项对账）。
   */
  ["sense.time", "感知"],
  ["sense.device", "感知"],
  ["sense.place", "感知"],
  ["sense.notifications", "感知"],
  ["sense.foreground", "感知"],
  ["sense.screen", "感知"],
];

const ALL_KINDS = ACTION_SCHEMA_KIND_GROUP.map((pair) => pair[0]);
const ACTION_GROUP_OF = Object.fromEntries(ACTION_SCHEMA_KIND_GROUP);
/**
 * 全发的基线数量（断言里到处用到，别写成字面量）。
 * 61（P0）→ 63（加「情绪词表」那两个动作）→ 62（2026-10 旧的 `state.report`／
 * 11 维花瓣整条退场）→ 68（再加「主动感知」六个 `sense.*`：让 AI **主动**
 * 看一眼现在的状态，而不是每轮被系统塞一段）→ **70**（2026-10 再加**联网**两个
 * `web.search` / `web.fetch`：手机版第一次能搜网页、能读网页正文）。
 * 下面【0】还会拿这份抄件跟 `action-schema.ts` 逐项对，所以数量对不上会先在那里冒出来。
 */
const EXPECTED_TOTAL = 70;
const TOTAL = ALL_KINDS.length;

/** 完全无关键词的句子（D 组用）：一句话不筛，全发，绝不漏。 */
const SAFETY_PHRASES = ["嗯嗯", "好的谢谢", "在吗", "？？", "1", "。", "  ", "…"];

/**
 * 建议补的关键词 —— 来源是下面【E-观察】里"命中 0 个词"的句子，以及【A】里漏发的动作。
 * ⚠️ **只在本脚本的模拟里生效，绝不写进源码**（`tool-select.ts` 是 Lead 的写范围）。
 * 每个词都挑"具体说法"（不是"歌/信/玩"这种子串危险词，见规则里的纪律第 3/4 条）。
 */
const SUGGESTED_KEYWORDS = {
  媒体: ["那首", "换一首"],
  记忆: ["之前说过", "说过什么"],
  记录: ["封信"],
  界面: ["简短", "字太小"],
  学习: ["英文", "读一下"],
  玩: ["赢了", "记一笔"],
};

/* ──────────────────────────── 断言小工具 ──────────────────────────── */

let passed = 0;
/** @type {string[]} */
const failures = [];
/** 非计分观察项：只记录、不算失败（报告里会点名） */
const notes = [];

function check(name, cond, detail) {
  const ok = !!cond;
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(detail ? `${name} —— ${detail}` : name);
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

function note(label, value) {
  const line = `${label} → ${value}`;
  notes.push(line);
  console.log(`  ⚠️ ${line}`);
}

const j = (v) => JSON.stringify(v);
const same = (a, b) => j(a) === j(b);
/** 读文件；读不到返回 ""（规则文件是活的，缺文件不该让脚本崩） */
function readSource(rel) {
  try {
    return readFileSync(new URL(rel, import.meta.url), "utf8");
  } catch {
    return "";
  }
}
const shortHash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);

/* ─────────────────────── 加载召回语料（句集） ─────────────────────── */

/**
 * 语料文件名是 `tool-recall-corpus.mjs`，但里面写了 TS 的 `as const`；
 * `node --experimental-strip-types` **只对 .ts/.mts/.cts 做类型擦除，.mjs 不擦** ——
 * 所以直接 import 会死在 `SyntaxError: Unexpected identifier 'as'`。
 *
 * 处理：**先试直接 import**（语料改成 .ts 或去掉 `as const` 后就走这条），
 * 不行才退回"读源码文本、只剥掉 `as const`、经 data: URL 导入"。
 * ⚠️ 这条退路**不是静默**：0.12 会把它钉成 FAIL 报给 Lead（见报告）。
 */
async function loadCorpus() {
  const candidates = ["./tool-recall-corpus.ts", "./tool-recall-corpus.mjs"];
  for (const rel of candidates) {
    try {
      return { mod: await import(rel), how: `直接 import ${rel}`, direct: true };
    } catch {
      /* 换下一个候选 / 走退路 */
    }
  }
  for (const rel of candidates) {
    const src = readSource(rel);
    if (!src) continue;
    const url = `data:text/javascript;base64,${Buffer.from(
      src.replace(/\bas\s+const\b/g, ""),
      "utf8",
    ).toString("base64")}`;
    try {
      return {
        mod: await import(url),
        how: `${rel} 源码剥掉 as const 后经 data: URL 导入`,
        direct: false,
      };
    } catch {
      /* 换下一个候选 */
    }
  }
  throw new Error("corpus 加载失败：既不能直接 import，也不能按源码文本加载");
}

const corpusLoad = await loadCorpus();
const { ALWAYS_ON, MAX_TOOLS_RATIO, NO_SIDE_EFFECT_CASES, RECALL_CASES } = corpusLoad.mod;

/* ─────────────────── 规则源码的只读反射（诊断用，不改文件） ─────────────────── */

const TOOL_SELECT_SRC = readSource("./src/lib/tool-select.ts");
const ACTION_SCHEMA_SRC = readSource("./src/lib/action-schema.ts");
const CORPUS_SRC = readSource("./tool-recall-corpus.ts") || readSource("./tool-recall-corpus.mjs");
/** 本次验收针对的版本（规则是活文件，报告以 hash 为准） */
const RULE_REV = shortHash(TOOL_SELECT_SRC);
const CORPUS_REV = shortHash(CORPUS_SRC);

/** 从 `action-schema.ts` 源码里抽 `kind` / `group`（跟抄件对账用）。 */
function extractSchemaPairs(src) {
  const re = /\{\s*kind:\s*"([^"]+)",\s*group:\s*"([^"]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push([m[1], m[2]]);
  return out;
}

/**
 * 从 `tool-select.ts` 源码里抽当前判据的阈值：
 *   · `MIN_HIT_WORDS`（现行：命中 ≥ N 个**词**就筛）
 *   · `MIN_HIT_GROUPS`（第一版：命中 ≥ N 个**组**才筛）
 * 读不到就返回 null —— 说明规则又换了写法，0.10 会 FAIL 提醒同步本脚本。
 */
function extractThreshold(src) {
  const words = /MIN_HIT_WORDS\s*=\s*(\d+)/.exec(src);
  if (words) return { kind: "words", value: Number(words[1]), name: "MIN_HIT_WORDS" };
  const groups = /MIN_HIT_GROUPS\s*=\s*(\d+)/.exec(src);
  if (groups) return { kind: "groups", value: Number(groups[1]), name: "MIN_HIT_GROUPS" };
  return null;
}

/**
 * 去掉注释再抽词表：规则的关键词数组里嵌了 JSDoc（解释"为什么把情绪词放进记录组"），
 * 注释正文里带引号（"今天好累啊"），不剥掉就会被当成**幽灵关键词**抽出来
 * —— 组集合看着没错，但"命中词"多几个假的，0.13 就会报假不一致。
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** 从 `tool-select.ts` 源码里抽 `GROUP_KEYWORDS`（只在 explainSelection 不可用时当退路）。 */
function extractKeywordTable(src) {
  const body = stripComments(src);
  /** @type {Record<string, string[]>} */
  const table = {};
  for (const group of ALL_GROUPS) {
    const at = body.indexOf(`\n  ${group}: [`);
    if (at < 0) continue;
    const open = body.indexOf("[", at);
    const close = body.indexOf("]", open);
    if (open < 0 || close < 0 || close < open) continue;
    table[group] = [...body.slice(open + 1, close).matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  }
  return table;
}

const KEYWORDS = extractKeywordTable(TOOL_SELECT_SRC);
const THRESHOLD = extractThreshold(TOOL_SELECT_SRC);

/** 跟规则里的 `normalize` 同一套（诊断镜像）：小写 + 全角转半角。 */
function normalizeLikeRule(text) {
  return (text ?? "")
    .toLowerCase()
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** 用源码关键词表算命中（退路/模拟用）；`extra` 是模拟用的附加词。 */
function mirrorFromSource(text, recent, extra) {
  const haystack = normalizeLikeRule([text, ...(recent ?? [])].join("\n"));
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const group of ALL_GROUPS) {
    const words = [...(KEYWORDS[group] ?? []), ...((extra ?? {})[group] ?? [])];
    const matched = words.filter((w) => haystack.includes(normalizeLikeRule(w)));
    if (matched.length > 0) out[group] = matched;
  }
  return out;
}

/**
 * "这句话命中了哪些组、被哪些词点着的" —— **优先用规则自己导出的 `explainSelection()`**
 * （真口，规则改了口径这里也跟着对）；拿不到才退回源码抽词表。
 * `extra` 只有模拟补词时才传，此时必须走镜像（真口不接受外部词表）。
 */
function hitsFor(text, recent, extra) {
  if (!extra && typeof explainSelection === "function") {
    return explainSelection({ text, recent });
  }
  return mirrorFromSource(text, recent, extra);
}

/** 按"命中组 + 常驻"挑动作（判据可换）—— 只用于诊断/假设模拟，不改任何源码。 */
function simulateWith(hits, judge) {
  const words = Object.values(hits).reduce((n, ws) => n + ws.length, 0);
  const groups = Object.keys(hits);
  const wentAll = !judge({ words, groups: groups.length, hits });
  const kinds = wentAll
    ? [...ALL_KINDS]
    : ALL_KINDS.filter((k) => ALWAYS_KINDS.includes(k) || groups.includes(ACTION_GROUP_OF[k]));
  return {
    wentAll,
    kinds,
    groups: wentAll ? [...ALL_GROUPS] : ALL_GROUPS.filter((g) => groups.includes(g)),
    dropped: TOTAL - kinds.length,
  };
}

/** 三套判据：现行（源码里的阈值）、第一版（≥2 组）、中间版（1 组 + ≥2 词）。 */
const JUDGE = {
  current: ({ words, groups }) => (THRESHOLD ? words >= THRESHOLD.value : groups >= 1),
  byTwoGroups: ({ groups }) => groups >= 2,
  oneGroupTwoWords: ({ groups, words }) => groups >= 1 && words >= 2,
};

const simulate = (text, recent, judgeName, extra) =>
  simulateWith(hitsFor(text, recent, extra), JUDGE[judgeName]);

/** 调真规则（默认全量动作 + 真映射）。 */
function select(text, recent, allowed) {
  return selectActionKinds({
    text,
    recent,
    allKinds: ALL_KINDS,
    groupOf: ACTION_GROUP_OF,
    allowed,
  });
}

/** 全部样本（召回 + 反例 + 安全网 + 边角）—— B / F / 镜像自检共用。 */
const SAMPLE_BATTERY = [
  ...RECALL_CASES.map((c) => ({ text: c.text, recent: c.recent, tag: "召回" })),
  ...NO_SIDE_EFFECT_CASES.map((c) => ({ text: c.text, tag: "反例" })),
  ...SAFETY_PHRASES.map((t) => ({ text: t, tag: "安全网" })),
  { text: "", tag: "空串" },
  { text: "随便聊聊", tag: "闲聊" },
];

/* ──────────────────────────────── 开跑 ──────────────────────────────── */

async function main() {
  /* ═════════ 【0】模块自检：导出齐全、零 import、抄件与源码一致 ═════════ */

  console.log("【0】模块自检 —— 导出齐全 / 零 import / 抄件与源码一致 / 诊断口径对齐");
  check(
    "tool-select.ts 导出了 selectActionKinds（纯函数）",
    typeof selectActionKinds === "function",
    typeof selectActionKinds,
  );
  check(
    `tool-select.ts 导出 ALL_GROUPS（${ALL_GROUPS?.length} 组）与 ALWAYS_KINDS（${ALWAYS_KINDS?.length} 个）`,
    Array.isArray(ALL_GROUPS) && ALL_GROUPS.length === 12 && ALWAYS_KINDS.length === 7,
    j([ALL_GROUPS?.length, ALWAYS_KINDS?.length]),
  );
  const firstImport = (TOOL_SELECT_SRC.match(/^\s*import\s.*$/m) ?? [""])[0].trim();
  check(
    "tool-select.ts 源码里没有任何 import（纯 node 直接 import 的前提）",
    !/^\s*import\s/m.test(TOOL_SELECT_SRC),
    firstImport,
  );
  check(
    "action-schema.ts 确实是 @/ 别名 import（所以动作清单只能自带抄件）",
    /from\s+["']@\//.test(ACTION_SCHEMA_SRC),
    (ACTION_SCHEMA_SRC.match(/^\s*import\s.*$/m) ?? [""])[0].trim(),
  );

  const schemaPairs = extractSchemaPairs(ACTION_SCHEMA_SRC);
  check(
    `抄件与 action-schema.ts 逐项一致（${schemaPairs.length} 条：kind 顺序 + 分组都一样）`,
    same(schemaPairs, ACTION_SCHEMA_KIND_GROUP),
    `源码 ${schemaPairs.length} 条 vs 抄件 ${ACTION_SCHEMA_KIND_GROUP.length} 条；首个不一致：${
      j(schemaPairs.find((p, i) => !same(p, ACTION_SCHEMA_KIND_GROUP[i]))) || "无"
    }`,
  );
  check(
    `抄件共 ${TOTAL} 个动作，kind 无重复`,
    TOTAL === EXPECTED_TOTAL && new Set(ALL_KINDS).size === TOTAL,
    `TOTAL=${TOTAL}，唯一 ${new Set(ALL_KINDS).size}`,
  );
  check(
    "每个动作的组都在 ALL_GROUPS 里（没有抄错的组名）",
    ALL_KINDS.every((k) => ALL_GROUPS.includes(ACTION_GROUP_OF[k])),
    j(ALL_KINDS.filter((k) => !ALL_GROUPS.includes(ACTION_GROUP_OF[k]))),
  );
  const groupsInSchemaSrc = [
    ...((/export const ACTION_GROUPS = \[([\s\S]*?)\]/.exec(ACTION_SCHEMA_SRC)?.[1] ?? "").matchAll(
      /"([^"]+)"/g,
    ) || []),
  ].map((m) => m[1]);
  check(
    "ALL_GROUPS 的顺序与 action-schema.ts 的 ACTION_GROUPS 一致",
    same(groupsInSchemaSrc, ALL_GROUPS),
    j(groupsInSchemaSrc),
  );
  check(
    "corpus 导出齐全（RECALL_CASES / NO_SIDE_EFFECT_CASES / ALWAYS_ON / MAX_TOOLS_RATIO）",
    Array.isArray(RECALL_CASES) &&
      Array.isArray(NO_SIDE_EFFECT_CASES) &&
      Array.isArray(ALWAYS_ON) &&
      typeof MAX_TOOLS_RATIO === "number",
  );
  check(
    "0.11 corpus 能被纯 node 直接 import（.ts 走类型擦除；带 TS 语法的 .mjs 不行）",
    corpusLoad.direct,
    `退路已启用：${corpusLoad.how}；建议用具名 corpus.ts，或去掉 .mjs 里的 TS 语法`,
  );
  note("0-观察 corpus 加载方式", corpusLoad.how);
  note(
    "0-观察 本次验收针对的版本（规则是活文件，报告以 hash 为准）",
    `tool-select.ts sha256:${RULE_REV}（${TOOL_SELECT_SRC.length} 字节） · corpus sha256:${CORPUS_REV}（${CORPUS_SRC.length} 字节）`,
  );
  check(
    "corpus 的 ALWAYS_ON 与规则里的 ALWAYS_KINDS 完全一致（同一份常驻，含顺序）",
    same(ALWAYS_ON, [...ALWAYS_KINDS]),
    `corpus ${j(ALWAYS_ON)} vs 规则 ${j([...ALWAYS_KINDS])}`,
  );
  check(
    `语料规模够：召回 ${RECALL_CASES.length} 条 ≥ 30、反例 ${NO_SIDE_EFFECT_CASES.length} 条 ≥ 3`,
    RECALL_CASES.length >= 30 && NO_SIDE_EFFECT_CASES.length >= 3,
    j([RECALL_CASES.length, NO_SIDE_EFFECT_CASES.length]),
  );
  const corpusKinds = [
    ...RECALL_CASES.flatMap((c) => [...c.mustInclude]),
    ...NO_SIDE_EFFECT_CASES.flatMap((c) => [...c.mustKeep]),
  ];
  const unknownKinds = [...new Set(corpusKinds.filter((k) => !ALL_KINDS.includes(k)))];
  check(
    `corpus 里引用的 kind 全部真实存在（${corpusKinds.length} 处引用，没有写错的 kind）`,
    unknownKinds.length === 0,
    j(unknownKinds),
  );
  check(
    "0.10 能从源码读出当前判据阈值（MIN_HIT_WORDS / MIN_HIT_GROUPS）—— 读不到说明规则换了写法，本脚本的模拟要同步",
    THRESHOLD !== null,
    "没找到 MIN_HIT_WORDS = N 或 MIN_HIT_GROUPS = N",
  );
  if (THRESHOLD) {
    note(
      "0-观察 当前判据",
      `${THRESHOLD.name} = ${THRESHOLD.value}（${THRESHOLD.kind === "words" ? "命中词数" : "命中组数"}阈值）`,
    );
  }
  const simMismatch = SAMPLE_BATTERY.filter((s) => {
    const sim = simulate(s.text, s.recent, "current", null);
    const real = select(s.text, s.recent);
    return !same({ kinds: sim.kinds, groups: sim.groups, dropped: sim.dropped }, real);
  });
  check(
    `0.10 诊断模拟器（读源码阈值 ${THRESHOLD?.name}=${THRESHOLD?.value}）与真实规则在全部 ${SAMPLE_BATTERY.length} 条上逐条一致`,
    simMismatch.length === 0,
    `不一致：${j(simMismatch.map((s) => s.text))}`,
  );
  check(
    `0.11 源码关键词表 12 组全抽到（每组 ≥ 2 个词）`,
    ALL_GROUPS.every((g) => (KEYWORDS[g] ?? []).length >= 2),
    j(ALL_GROUPS.filter((g) => (KEYWORDS[g] ?? []).length < 2)),
  );
  if (typeof explainSelection === "function") {
    const mirrorMismatch = SAMPLE_BATTERY.filter((s) => {
      const realHits = explainSelection({ text: s.text, recent: s.recent });
      return !same(mirrorFromSource(s.text, s.recent, null), realHits);
    });
    check(
      `0.13 源码抽出的关键词表与规则导出的 explainSelection 逐条一致（"凭什么命中"的诊断可信）`,
      mirrorMismatch.length === 0,
      j(mirrorMismatch.map((s) => s.text)),
    );
  } else {
    note("0-观察 explainSelection 未导出", "命中诊断退回源码抽词表（0.13 跳过）");
  }

  /* ═════════ A. 召回对账（红线）═════════ */

  console.log(`\n【A】召回对账（红线）—— ${RECALL_CASES.length} 条样本，mustInclude 一个都不能漏`);
  console.log("      #  判定 发出 漏 ｜ 这句话 → 命中组（命中词）｜ 标签");
  let totalMissing = 0;
  let filteredCount = 0;
  let netDependent = 0;
  /** @type {{label: string, text: string, missing: string[], netMiss: string[], wentAll: boolean}[]} */
  const recallRows = [];
  for (const [i, c] of RECALL_CASES.entries()) {
    const r = select(c.text, c.recent);
    const missing = c.mustInclude.filter((k) => !r.kinds.includes(k));
    totalMissing += missing.length;
    const wentAll = r.dropped === 0;
    if (!wentAll) filteredCount += 1;
    const hits = hitsFor(c.text, c.recent, null);
    const hitGroups = Object.keys(hits);
    /** 若只按命中组发（没有全发安全网）就会漏的动作 —— 衡量关键词真实覆盖度 */
    const netMiss = c.mustInclude.filter(
      (k) => !ALWAYS_KINDS.includes(k) && !hitGroups.includes(ACTION_GROUP_OF[k]),
    );
    if (wentAll && netMiss.length > 0) netDependent += 1;
    const hitText =
      hitGroups.map((g) => `${g}←${hits[g].join("/")}`).join(" ") || "（一个词都没命中 → 全发）";
    const recentText = c.recent ? `（上一句：${j(c.recent)}）` : "";
    const netText = wentAll && netMiss.length > 0 ? `  ⚠️无全发会漏: ${netMiss.join(",")}` : "";
    console.log(
      `  #${String(i + 1).padStart(2, "0")} ${missing.length === 0 ? "✅" : "❌"} ${
        wentAll ? "全发" : "真筛"
      } ${String(r.kinds.length).padStart(2)} ${missing.length} ｜「${c.text}」${recentText} ｜ ${hitText}${netText} ｜ ${c.label}`,
    );
    recallRows.push({
      label: c.label,
      text: c.text,
      missing,
      netMiss,
      wentAll,
      kinds: r.kinds.length,
      mustInclude: [...c.mustInclude],
    });
  }
  const mustIncludeTotal = RECALL_CASES.reduce((n, c) => n + c.mustInclude.length, 0);
  check(
    `A1 ⭐红线 ${RECALL_CASES.length} 条样本 / ${mustIncludeTotal} 个 mustInclude：漏发 ${totalMissing} 个`,
    totalMissing === 0,
    recallRows
      .filter((r) => r.missing.length > 0)
      .map(
        (r) =>
          `「${r.text}」漏 ${r.missing.join(",")}（该给的是 ${r.missing
            .map((k) => ACTION_GROUP_OF[k])
            .join("/")} 组）`,
      )
      .join(" ； "),
  );
  const allSentRows = recallRows.filter((r) => r.wentAll);
  const allSentMissing = allSentRows.filter((r) => r.missing.length > 0);
  check(
    `A2 走"全发"安全网的 ${allSentRows.length} 条样本里也必须零漏（安全网确实兜住了）`,
    allSentMissing.length === 0,
    j(allSentMissing.map((r) => r.text)),
  );
  note(
    "A-观察 召回靠什么兑现",
    `${RECALL_CASES.length} 条里真按关键词筛的 ${filteredCount} 条（漏 ${
      recallRows.filter((r) => !r.wentAll && r.missing.length > 0).length
    } 条）、走全发安全网的 ${allSentRows.length} 条；其中「若无全发就会漏动作」的有 ${netDependent} 条 —— 这 ${netDependent} 条是关键词表的真实盲区`,
  );

  /* ═════════ B. 常驻七个：每条样本都要有 ═════════ */

  console.log(
    `\n【B】常驻七个 —— ${SAMPLE_BATTERY.length} 条样本（含反例 / 安全网 / 空串）里都必须出现`,
  );
  const bMissing = [];
  for (const s of SAMPLE_BATTERY) {
    const r = select(s.text, s.recent);
    const miss = ALWAYS_ON.filter((k) => !r.kinds.includes(k));
    console.log(
      `  ${miss.length === 0 ? "✅" : "❌"} [${s.tag}] 「${s.text}」→ 常驻 ${ALWAYS_ON.length - miss.length}/${
        ALWAYS_ON.length
      }，共发 ${r.kinds.length} 个${miss.length > 0 ? `，丢: ${miss.join(",")}` : ""}`,
    );
    if (miss.length > 0) bMissing.push(`${s.text} → 丢 ${miss.join(",")}`);
  }
  check(
    `B1 全部 ${SAMPLE_BATTERY.length} 条样本里常驻七个一个不少（反例也不能丢）`,
    bMissing.length === 0,
    bMissing.slice(0, 3).join(" ｜ "),
  );
  const filteredSamples = SAMPLE_BATTERY.filter((s) => select(s.text, s.recent).dropped > 0);
  const filteredMissing = filteredSamples.filter((s) => {
    const r = select(s.text, s.recent);
    return ALWAYS_ON.some((k) => !r.kinds.includes(k));
  });
  check(
    `B2 在真筛过的 ${filteredSamples.length} 条样本里也都有常驻那四个（不是靠"${TOTAL} 个全发"凑数）`,
    filteredSamples.length > 0 && filteredMissing.length === 0,
    j(filteredMissing.map((s) => s.text)),
  );

  /* ═════════ C. 不误伤 ═════════ */

  console.log(`\n【C】不误伤 —— ${NO_SIDE_EFFECT_CASES.length} 条反例的 mustKeep 必须都在`);
  const cMissing = [];
  const falsePositive = [];
  for (const c of NO_SIDE_EFFECT_CASES) {
    const r = select(c.text);
    const miss = c.mustKeep.filter((k) => !r.kinds.includes(k));
    const hits = hitsFor(c.text, null, null);
    const groups = Object.keys(hits);
    console.log(
      `  ${miss.length === 0 ? "✅" : "❌"} 「${c.text}」→ 发 ${r.kinds.length} 个，mustKeep 缺 ${
        miss.join(",") || "0"
      } ｜ 命中组 ${groups.length} 个${groups.length > 0 ? `（${groups.join("/")}）` : ""} ｜ ${c.label}`,
    );
    if (miss.length > 0) cMissing.push(`${c.text} → 缺 ${miss.join(",")}`);
    if (groups.length > 0) falsePositive.push(`${c.text} → 命中 ${groups.join("/")}（${j(hits)}）`);
  }
  check(
    `C1 ${NO_SIDE_EFFECT_CASES.length} 条反例的 mustKeep 全部保留`,
    cMissing.length === 0,
    cMissing.join(" ｜ "),
  );
  check(
    "C2 反例没有被「贪心」命中一堆组（闲聊句子命中组数 ≤ 1）",
    NO_SIDE_EFFECT_CASES.every((c) => Object.keys(hitsFor(c.text, null, null)).length <= 1),
    j(NO_SIDE_EFFECT_CASES.map((c) => [c.text, Object.keys(hitsFor(c.text, null, null)).length])),
  );
  if (falsePositive.length > 0) {
    note(
      "C-观察 反例仍会命中组（代价：多发一组；但只要不是「每句都中」就不算误伤）",
      falsePositive.join(" ｜ "),
    );
  }

  /* ═════════ D. 安全网：无关键词 → 全发 ═════════ */

  console.log(
    `\n【D】安全网 —— 一句关键词都没有的话，必须全发 ${TOTAL} 个（宁可多花 token，绝不漏）`,
  );
  for (const phrase of SAFETY_PHRASES) {
    const r = select(phrase);
    const ok = same(r.kinds, ALL_KINDS) && same(r.groups, ALL_GROUPS) && r.dropped === 0;
    check(
      `D1 「${phrase}」→ 全发 ${r.kinds.length}/${TOTAL} 个，dropped=${r.dropped}`,
      ok,
      j({ kinds: r.kinds.length, groups: r.groups.length, dropped: r.dropped }),
    );
  }
  const off = selectActionKinds({
    text: "放个歌听",
    allKinds: ALL_KINDS,
    groupOf: ACTION_GROUP_OF,
    enabled: false,
  });
  check(
    `D2 enabled=false（用户关掉按需）→ 不筛，全发 ${TOTAL} 个`,
    same(off.kinds, ALL_KINDS) && off.dropped === 0,
    j({ kinds: off.kinds.length, dropped: off.dropped }),
  );
  const onCase = "用 mcp 那个工具记一下";
  const explicitOn = selectActionKinds({
    text: onCase,
    allKinds: ALL_KINDS,
    groupOf: ACTION_GROUP_OF,
    enabled: true,
  });
  check(
    "D2 enabled=true 显式 与 不传 逐字相同（都走筛选）",
    same(explicitOn, select(onCase)),
    j([explicitOn.kinds.length, select(onCase).kinds.length]),
  );

  /* ═════════ E. 省得动 ═════════ */

  console.log("\n【E】省得动 —— 至少 80% 的召回样本要真被筛，整体平均 ≤ 62 × MAX_TOOLS_RATIO");
  const counts = RECALL_CASES.map((c) => select(c.text, c.recent).kinds.length);
  const belowTotal = counts.filter((n) => n < TOTAL);
  const ratio = belowTotal.length / counts.length;
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  const budget = TOTAL * MAX_TOOLS_RATIO;
  const filteredCounts = counts.filter((n) => n < TOTAL);
  const filteredAvg =
    filteredCounts.length > 0
      ? filteredCounts.reduce((a, b) => a + b, 0) / filteredCounts.length
      : 0;
  check(
    `E1 ≥80% 的召回样本发出 < ${TOTAL} 个：实测 ${belowTotal.length}/${counts.length} = ${(
      ratio * 100
    ).toFixed(1)}%`,
    ratio >= 0.8,
    `${(ratio * 100).toFixed(1)}% < 80%（${counts.length - belowTotal.length} 条走了全发）`,
  );
  check(
    `E2 平均发出数 ≤ ${TOTAL} × ${MAX_TOOLS_RATIO} = ${budget.toFixed(1)}：实测 ${avg.toFixed(1)}`,
    avg <= budget + 1e-9,
    `实测平均 ${avg.toFixed(1)} > 预算 ${budget.toFixed(1)}`,
  );
  note(
    "E-观察 发出动作数分布",
    `最小 ${Math.min(...counts)} / 最大 ${Math.max(...counts)} / 平均 ${avg.toFixed(1)}（全发基线 ${TOTAL}）；只统计真筛了的 ${filteredCounts.length} 条 → 平均 ${filteredAvg.toFixed(1)} 个`,
  );
  const zeroWordCases = RECALL_CASES.filter(
    (c) => Object.keys(hitsFor(c.text, c.recent, null)).length === 0,
  );
  note(
    "E-观察 命中 0 个词的句子（关键词表没覆盖 → 只能全发，不漏但也不省）",
    `${zeroWordCases.length} 条：${zeroWordCases.map((c) => c.text).join(" / ") || "无"}`,
  );
  const assumption = (judgeName, extra) => {
    const sims = RECALL_CASES.map((c) => simulate(c.text, c.recent, judgeName, extra));
    const miss = RECALL_CASES.map((c, i) => ({
      text: c.text,
      miss: c.mustInclude.filter((k) => !sims[i].kinds.includes(k)),
    })).filter((x) => x.miss.length > 0);
    return {
      filtered: sims.filter((r) => r.dropped > 0).length,
      avg: sims.reduce((n, r) => n + r.kinds.length, 0) / sims.length,
      miss,
    };
  };
  const simOld1 = assumption("byTwoGroups", null);
  note(
    "E-观察 假设①：回到第一版口径「命中 ≥ 2 组才筛」（脚本内模拟，未改源码）",
    `会筛 ${simOld1.filtered}/${RECALL_CASES.length}，平均 ${simOld1.avg.toFixed(1)} 个；漏 ${simOld1.miss.length} 条：${
      simOld1.miss.map((x) => `${x.text}→漏${x.miss.join(",")}`).join(" ｜ ") || "无"
    }`,
  );
  const simOld2 = assumption("oneGroupTwoWords", null);
  note(
    "E-观察 假设②：口径「1 组 + 组内 ≥ 2 词」（脚本内模拟，未改源码）",
    `会筛 ${simOld2.filtered}/${RECALL_CASES.length}，平均 ${simOld2.avg.toFixed(1)} 个；漏 ${simOld2.miss.length} 条：${
      simOld2.miss.map((x) => `${x.text}→漏${x.miss.join(",")}`).join(" ｜ ") || "无"
    }`,
  );
  const simSuggested = assumption("current", SUGGESTED_KEYWORDS);
  /** 只算"建议词**新增**的命中"：反例本来就有命中（"今天天气真好"命中工具）不算到建议词头上 */
  const suggestedNewHits = NO_SIDE_EFFECT_CASES.map((c) => {
    const before = Object.keys(hitsFor(c.text, null, null));
    const after = Object.keys(mirrorFromSource(c.text, null, SUGGESTED_KEYWORDS));
    return { text: c.text, added: after.filter((g) => !before.includes(g)) };
  }).filter((x) => x.added.length > 0);
  note(
    "E-观察 假设③：现行口径 + 建议补词（词见脚本 SUGGESTED_KEYWORDS，模拟，未改源码）",
    `会筛 ${simSuggested.filtered}/${RECALL_CASES.length}，平均 ${simSuggested.avg.toFixed(
      1,
    )} 个；漏 ${simSuggested.miss.length} 条：${
      simSuggested.miss.map((x) => `${x.text}→漏${x.miss.join(",")}`).join(" ｜ ") || "无"
    }；建议词对反例的**新增**命中：${suggestedNewHits.length === 0 ? "0 处（不误伤）" : j(suggestedNewHits)}`,
  );

  /* ═════════ F. 纯函数 / 顺序稳定 ═════════ */

  console.log("\n【F】纯函数 —— 同一输入连算两次逐字相同，顺序稳定（别用 Set 的遍历顺序）");
  const unstable = SAMPLE_BATTERY.filter(
    (s) => !same(select(s.text, s.recent), select(s.text, s.recent)),
  );
  check(
    `F1 ${SAMPLE_BATTERY.length} 条样本连算两次结果逐字相同（kinds/groups/dropped）`,
    unstable.length === 0,
    j(unstable.map((s) => s.text)),
  );
  const x1 = select("开个新对话");
  select("陪我下一局五子棋");
  select("嗯嗯");
  const x2 = select("开个新对话");
  check(
    "F2 中间插别的调用之后，同输入结果仍然逐字相同（没有隐藏状态）",
    same(x1, x2),
    j([x1.kinds.length, x2.kinds.length]),
  );
  const orderBad = SAMPLE_BATTERY.filter((s) => {
    const r = select(s.text, s.recent);
    const idx = r.kinds.map((k) => ALL_KINDS.indexOf(k));
    const increasing = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
    return !increasing || new Set(r.kinds).size !== r.kinds.length;
  });
  check(
    "F3 kinds 严格跟 ALL_KINDS 顺序一致（不靠 Set 遍历序）、无重复、无外来 kind",
    orderBad.length === 0,
    j(orderBad.map((s) => s.text)),
  );
  check(
    "F4 groups 也跟 ALL_GROUPS 顺序一致、无重复",
    SAMPLE_BATTERY.every((s) => {
      const r = select(s.text, s.recent);
      const idx = r.groups.map((g) => ALL_GROUPS.indexOf(g));
      return idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
    }),
  );

  /* ═════════ G. 权限 ═════════ */

  console.log("\n【G】权限 —— allowed 返回 false 的动作绝不出现（常驻也一样）");
  const denyAlways = (k) => !ALWAYS_KINDS.includes(k);
  const g1 = select("嗯嗯", undefined, denyAlways);
  check(
    `G1 拒绝常驻七个 → 一个都不出现，剩下 ${TOTAL - ALWAYS_KINDS.length} 个照发`,
    !ALWAYS_KINDS.some((k) => g1.kinds.includes(k)) &&
      g1.kinds.length === TOTAL - ALWAYS_KINDS.length &&
      g1.dropped === ALWAYS_KINDS.length,
    j({ kinds: g1.kinds.length, dropped: g1.dropped }),
  );
  const g2 = select("放个歌听", undefined, (k) => k !== "media.playTrack");
  check(
    "G2 拒绝单个动作（media.playTrack）→ 不出现，别的还在",
    !g2.kinds.includes("media.playTrack") && g2.kinds.includes("media.play"),
    j({ has: g2.kinds.includes("media.playTrack"), play: g2.kinds.includes("media.play") }),
  );
  const g3 = select("用 mcp 那个工具记一下", undefined, (k) => k !== "tool.call");
  check(
    "G3 真筛过的那条样本里拒绝 tool.call → 不出现，常驻 memory.add 仍在",
    !g3.kinds.includes("tool.call") && g3.kinds.includes("memory.add"),
    j({ tool: g3.kinds.includes("tool.call"), memory: g3.kinds.includes("memory.add") }),
  );
  const g4 = select("嗯嗯", undefined, () => false);
  check(
    "G4 全部拒绝 → kinds 为空、dropped = 全部（不能悄悄塞回来）",
    Array.isArray(g4.kinds) && g4.kinds.length === 0 && g4.dropped === TOTAL,
    j({ kinds: g4.kinds.length, dropped: g4.dropped }),
  );
  const g5Bad = RECALL_CASES.filter((c) => {
    const r = select(c.text, c.recent, denyAlways);
    if (ALWAYS_ON.some((k) => r.kinds.includes(k))) return true;
    return c.mustInclude.some((k) => !ALWAYS_KINDS.includes(k) && !r.kinds.includes(k));
  });
  check(
    "G5 每条召回样本都拒绝常驻 → 常驻绝不出现，且非常驻的 mustInclude 一个不漏",
    g5Bad.length === 0,
    j(g5Bad.map((c) => c.text)),
  );
  const g6Case = "用 mcp 那个工具记一下";
  const g6 = select(g6Case, undefined, (k) => k !== "http.call");
  check(
    "G6 只拒一个组里的一个动作 → 同组的另一个（tool.call）还在（不是整组塌掉）",
    !g6.kinds.includes("http.call") && g6.kinds.includes("tool.call"),
    j({ http: g6.kinds.includes("http.call"), tool: g6.kinds.includes("tool.call") }),
  );

  /* ═════════ H. 附赠：兜底规则 + 名字清单 ═════════ */

  console.log("\n【H】附赠 —— 「筛掉的动作 ≠ 不存在」的凭据（兜底规则 + 全部动作名清单）");
  check(
    "H1 兜底规则非空、明确「不要因为工具列表里没有就说做不到」、并给了 qidao 动作块写法",
    typeof FALLBACK_RULE === "string" &&
      FALLBACK_RULE.includes("做不到") &&
      FALLBACK_RULE.includes("```qidao") &&
      FALLBACK_RULE.length > 100,
    j(FALLBACK_RULE?.slice?.(0, 40)),
  );
  const nameList = typeof renderToolNameList === "function" ? renderToolNameList(ALL_KINDS) : "";
  const notListed = ALL_KINDS.filter((k) => !nameList.includes(k));
  check(
    `H2 名字清单覆盖全部 ${TOTAL} 个动作（漏一个就等于告诉模型"这个能力不存在"）`,
    notListed.length === 0,
    j(notListed),
  );
  note(
    "H-观察 名字清单体积",
    `${nameList.length} 字符（${TOTAL} 个全量定义 ≈ 4000 token，名字清单便宜一个量级）`,
  );

  /* ═════════ 收尾 ═════════ */

  console.log("\n【收尾】汇总与可重复性");
  check("断言项数 ≥ 40（任务要求的下限）", passed >= 40, `实际 ${passed}`);
  check("所有断言汇总后没有失败项", failures.length === 0, failures.slice(0, 3).join(" / "));

  /* 红项根因：把"是规则漏了"还是"语料/格式口径冲突"写清楚，别让 Lead 猜 */
  const redA = recallRows.filter((r) => r.missing.length > 0);
  if (redA.length > 0) {
    console.log("\n⚠️ A 组（红线）根因 —— 这些句子漏发动作：");
    for (const r of redA) {
      console.log(`   · 「${r.text}」（${r.label}）：命中 ${j(hitsFor(r.text, null, null))}`);
      console.log(
        `     该给 ${r.missing.join(",")}（${[...new Set(r.missing.map((k) => ACTION_GROUP_OF[k]))].join("/")} 组）没给；`,
      );
      const hints = [...new Set(r.missing.map((k) => ACTION_GROUP_OF[k]))]
        .map((g) => `${g} 建议补词 ${j(SUGGESTED_KEYWORDS[g] ?? [])}`)
        .join("；");
      console.log(`     ${hints}`);
    }
    console.log(
      `   验证：现行口径 + 上面这些建议词（脚本内模拟）→ 会筛 ${simSuggested.filtered}/${RECALL_CASES.length}，漏 ${simSuggested.miss.length} 条。`,
    );
  }
  if (failures.some((f) => f.startsWith("E"))) {
    console.log("\n⚠️ E 组根因 —— 省得动不够：");
    console.log(
      `   现行判据 ${THRESHOLD?.name}=${THRESHOLD?.value} 下，${counts.length - belowTotal.length} 条命中 0 个词 → 全发 ${TOTAL} 个；`,
    );
    console.log(
      `   真筛的只有 ${filteredCounts.length}/${counts.length} 条（平均 ${avg.toFixed(1)} 个，预算 ${budget.toFixed(1)}）。`,
    );
    console.log(
      `   补词（假设③）后：筛 ${simSuggested.filtered}/${RECALL_CASES.length}、平均 ${simSuggested.avg.toFixed(1)}、漏 ${simSuggested.miss.length}。`,
    );
  }
  if (failures.some((f) => f.startsWith("0.11 corpus"))) {
    console.log("\n⚠️ 0.11 根因 —— 语料文件格式：tool-recall-corpus.mjs 里写了 TS 的 `as const`，");
    console.log("   strip-types 只擦 .ts，所以纯 node 直接 import 不了（本脚本靠退路兜着）。");
    console.log("   修法：改名 tool-recall-corpus.ts（推荐），或去掉那几处 `as const`。");
  }
}

try {
  await main();
} catch (err) {
  console.error("验收脚本自己崩了：", err);
  failures.push(`脚本异常：${err?.message ?? err}`);
}

console.log(`\n${"─".repeat(72)}`);
if (notes.length > 0) {
  console.log(`⚠️ ${notes.length} 条非计分观察（不算失败，报告里会点名）：`);
  for (const n of notes) console.log(`  · ${n}`);
}
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项断言 ✅（纯 node，未起浏览器、未连外网、未改任何源码）`);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项 ❌`);
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
