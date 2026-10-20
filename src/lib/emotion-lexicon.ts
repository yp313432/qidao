/**
 * 「情绪分组」的**唯一运行时入口**（2026-10 起：**10 组互斥** · 每组一组参考说法）。
 *
 * 用户 m08526 / m08557 定的方案：上报不再要求"词表里的原词"，主情绪改成
 * **自由概括 1~5 个字**（超 5 字截断不驳回）；`group` 改成**必填**（10 组 id 之一）。
 *
 * 三件事都收在这一个文件里，别在别处再抄一份：
 *   ① **词表本身**：直接 import 插件的 `lib/emotion/lexicon.ts`
 *      —— 同一份数组，改词表不用改两处（手册、动作校验、插件界面读的都是它）。
 *   ② **校验 / 截断**：主情绪 1~5 字（超了截断）、group 必须合法、quote ≤ 40 字。
 *   ③ **给 AI 看的那一节**：`emotionLexiconSection()`（手册里那 10 组 + 参考说法）。
 *
 * ⚠️ 两条纪律（都是用户明说的）：
 *   · **绝不把 10 组参考词塞进每轮系统提示词** —— 用户按 token 付费。
 *     `manual.ts` 里只给组 id 清单（很短），参考说法留在本文件。
 *   · **不许硬编码副本** —— 这里 import 的是插件那一份，没有第二个词表。
 *
 * 为什么用**相对 .ts 路径** import（仓库里 `src/lib/app-data/*` 也这么写）：
 * 这样 `node --experimental-strip-types` 能直接 import 这个文件做**真断言**
 * （`verify-emotion-ai.mjs` 靠它跑真函数，而不是拿正则猜源码）。
 */
import { LEXICON, type LexiconGroup } from "../plugins/emotion-lifeform/lib/emotion/lexicon.ts";
import type {
  EmotionDimensionScores,
  EmotionEventRecord,
  EmotionEvidenceInput,
  EmotionMemoryQuery,
} from "@/lib/types";

/** 10 组互斥的情绪分组 —— 就是插件那一份。 */
export const EMOTION_GROUPS: readonly LexiconGroup[] = LEXICON;

/** 全部参考说法（扁平成一个集合，只用于"旧存档里的词属于哪组"和界面配色）。 */
export const EMOTION_TERMS: ReadonlySet<string> = new Set(
  LEXICON.flatMap((group) => group.terms),
);

export const EMOTION_GROUP_COUNT = LEXICON.length;
/** 10 组的 id（`emotion.report.group` 的合法值）。 */
export const EMOTION_GROUP_IDS: readonly string[] = LEXICON.map((group) => group.id);
/** 给 AI / 回执用的短清单：`bright（明亮）、calm（平静）…` */
export const EMOTION_GROUP_HINT = LEXICON.map(
  (group) => `${group.id}（${group.title.replace(/^[A-Z]\.\s*/, "")}）`,
).join("、");
/**
 * 参考说法的**条目数**（10 组加起来的原始条数）。
 *
 * ⚠️ 这些词**不再是白名单** —— 上报是自由词（1~5 字），本数字只用于文档/自检。
 */
export const EMOTION_TERM_ENTRIES = LEXICON.reduce((sum, group) => sum + group.terms.length, 0);
export const EMOTION_TERM_COUNT = EMOTION_TERMS.size;

/** 氛围档位（对应插件 `IntimacyMode`）。 */
export const EMOTION_MODES = ["daily", "affectionate", "flirtatious", "intense"] as const;
export type EmotionMode = (typeof EMOTION_MODES)[number];

/** 五个大类（对应插件 `SceneCategory`）。 */
export const EMOTION_CATEGORIES = ["base", "intimacy", "tension", "cognition", "expression"] as const;
export type EmotionCategory = (typeof EMOTION_CATEGORIES)[number];

/** 六个维度（对应插件 `EmotionDimensions` 的键）。 */
export const EMOTION_DIMENSIONS = [
  "attraction",
  "longing",
  "shyness",
  "restraint",
  "warmth",
  "unease",
] as const;
export type EmotionDimension = (typeof EMOTION_DIMENSIONS)[number];

/**
 * 依据条数的上限。
 *
 * 用户的要求："最多 1 条（特别纠结时最多 2 条）"，
 * 而且**只引引起波动的那一句** —— 不许引整段对话、不许复制消息列表。
 */
export const EVIDENCE_MAX = 2;
/** 引用原句的字数上限（"只引引起波动的那一句，≤40 字"）。 */
export const QUOTE_MAX = 40;
/** 他自己写的一句摘要的字数上限（≤20 字）。 */
export const SUMMARY_MAX = 20;
/** 次情绪最多两个。 */
export const SECONDARY_MAX = 2;
/** 主情绪 / 次情绪的字数上限（用户 m08526："1~5 字"，超了截断、不驳回）。 */
export const PRIMARY_MAX = 5;
/** group id → 组（找不到返回 null）。 */
export function emotionGroupById(id: unknown): LexiconGroup | null {
  if (typeof id !== "string") return null;
  const key = id.trim().toLowerCase();
  return LEXICON.find((group) => group.id === key) ?? null;
}

/**
 * 旧数据补 group（2026-10 用户 m09312 第 6 条："6做吧"）。
 *
 * 词表从"13 组 · 217 词"换成"10 组 · 自由词"之前，每条情绪记录只有
 * `category`（base / intimacy / tension / cognition / expression），没有 `group`。
 * 星屿那边按组上色，缺 group 的历史点会全落到默认灰蓝 —— 这里给一个确定的兜底：
 *   ① 已经有合法 group → 原样用
 *   ② 主情绪能在 10 组的参考说法里查到 → 用那一组
 *   ③ 否则按旧大类映射：base→calm、intimacy→close、tension→uneasy、
 *      cognition / expression→curious
 */
const LEGACY_CATEGORY_GROUP: Record<string, string> = {
  base: "calm",
  intimacy: "close",
  tension: "uneasy",
  cognition: "curious",
  expression: "curious",
};

export function inferGroupId(record: {
  group?: unknown;
  primaryEmotion?: unknown;
  category?: unknown;
}): string {
  const known = emotionGroupById(record.group);
  if (known) return known.id;

  // 老存档里 category 被误塞进 group 字段的情况
  const groupAsCategory = LEGACY_CATEGORY_GROUP[String(record.group ?? "").trim().toLowerCase()];
  if (groupAsCategory) return groupAsCategory;

  // 主情绪能在参考说法里查到 —— 比大类更精确，优先
  const word = normalizeEmotionTerm(String(record.primaryEmotion ?? ""));
  if (word) {
    const byWord = LEXICON.find((group) => group.terms.includes(word));
    if (byWord) return byWord.id;
  }

  return LEGACY_CATEGORY_GROUP[String(record.category ?? "").trim().toLowerCase()] ?? "calm";
}


const MODE_LABEL: Record<EmotionMode, string> = {
  daily: "日常",
  affectionate: "亲昵",
  flirtatious: "暧昧",
  intense: "浓烈",
};

/** 档位的中文名（给它自己描述用）。 */
export function emotionModeLabel(mode: string): string {
  return MODE_LABEL[mode as EmotionMode] ?? mode;
}

/** 这个词（参考说法里有的）属于哪一组 —— 旧存档 / 配色用；自由词不在里面就返回 null。 */
export function emotionGroupOf(term: string): LexiconGroup | null {
  const word = normalizeEmotionTerm(term);
  return LEXICON.find((group) => group.terms.includes(word)) ?? null;
}

/**
 * 词条归一化：去空白、去包裹的引号/书名号。
 *
 * 模型偶尔会把词写成 `「心动」` 或 `"心动"` —— 那不是"不在词表里"，
 * 是写法脏。归一化之后仍不在表里的，才算**真的无效**。
 */
export function normalizeEmotionTerm(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/^[「『“"'\s]+/, "")
    .replace(/[」』”"'\s]+$/, "")
    .trim();
}

/** 这个词是不是某组的参考说法（**不再用于校验**，只给旧数据/配色兜底）。 */
export function isEmotionTerm(raw: unknown): boolean {
  const word = normalizeEmotionTerm(raw);
  return word.length > 0 && EMOTION_TERMS.has(word);
}

/** 0~1 的钳位；给不出数就用 `fallback`。 */
export function clamp01(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

/**
 * **按字数截断**（不是按字节）—— 超了就直接切，末尾补一个 `…`，
 * 保证结果**不超过** `max` 个字。用户的要求是"超过 40 字要截断或拒绝"，
 * 这里选截断：拒绝会让整条上报失败、白费一轮。
 */
export function clipChars(text: unknown, max: number): string {
  const s = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** 是否是合法的档位 / 大类（词表外的值一律不认）。 */
export function isEmotionMode(raw: unknown): raw is EmotionMode {
  return typeof raw === "string" && (EMOTION_MODES as readonly string[]).includes(raw);
}
export function isEmotionCategory(raw: unknown): raw is EmotionCategory {
  return typeof raw === "string" && (EMOTION_CATEGORIES as readonly string[]).includes(raw);
}
export function isEmotionDimension(raw: unknown): raw is EmotionDimension {
  return typeof raw === "string" && (EMOTION_DIMENSIONS as readonly string[]).includes(raw);
}

/* ───────────────── 界面用：心情 → 中文名 / 颜色（**唯一一处**） ─────────────────
 *
 * 2026-10：旧的 11 维词表（`lib/state-dims.ts`）连同动作 `state.report` 一起退场，
 * 用户原话："原来的那个情绪一项……就是那 11 个就不用了。" —— 所以
 * **心情、花瓣、上报、提示词现在全部只认这一份词库**（2026-10 起：10 组互斥 + 自由词）。
 *
 * 为什么界面这里只给**每组一个代表词**（取 `terms[0]`），而不是把几百个参考说法都铺成按钮：
 *   · 日记 / 动态那个心情选择器原来只有 11 个按钮；铺开就不是"改词表"，
 *     是把界面重做一遍 —— 用户明说"不要新做界面"。
 *   · 报告侧不受影响：AI 用 `emotion.report` 报的 primaryEmotion 是**自由词**（1~5 字），
 *     只有人手动挑心情时用这些"每组一个"的代表（分组见 `LEXICON`）。
 */
export const MOOD_TERMS: readonly string[] = LEXICON.map((group) => group.terms[0]!).filter(
  (term): term is string => Boolean(term),
);

/**
 * 每一组一个颜色 —— 顺序跟 10 组一一对应。
 *
 * 这些值就是旧 11 维那套颜色（`state-dims.ts` 的 `DIMS[].color`）**原样搬过来**：
 * 用户说了不许动美术，所以只是把"哪个颜色给哪个词"重新按新词表的分组分配一次。
 */
const GROUP_COLORS: readonly string[] = [
  "rgb(251,113,133)", // bright 明亮
  "rgb(96,165,250)", // calm 平静
  "rgb(129,140,248)", // low 低落
  "rgb(248,113,113)", // angry 生气
  "rgb(161,161,170)", // uneasy 不安
  "rgb(251,146,60)", // close 亲近
  "rgb(244,114,182)", // flutter 心动
  "rgb(45,212,191)", // jealous 吃醋
  "rgb(148,163,184)", // restrained 克制
  "rgb(52,211,153)", // curious 好奇与表达
];
const FALLBACK_COLOR = "rgb(148,163,184)";

/** 词 → 颜色（不在表里就给个中性灰，绝不返回空）。 */
export function moodColor(term: string): string {
  const word = normalizeEmotionTerm(term);
  const at = LEXICON.findIndex((group) => group.terms.includes(word));
  return at >= 0 ? (GROUP_COLORS[at] ?? FALLBACK_COLOR) : FALLBACK_COLOR;
}

/**
 * 展示用：心情词 → `{ label, color }`。
 *
 * 三种情况都不让界面空着（跟旧 `state-dims.ts` 那个 `moodDisplay()` 同一个契约，
 * 消费侧只是换了个 import 来源）：
 *   · 表里的词（"心动"）→ 词本身 + 它那一组的颜色
 *   · 不认识的词 / 老存档留下的旧值 → 原样显示，借中性灰（总比一片空白强）
 */
export function moodDisplay(term: string): { label: string; color: string } {
  const word = normalizeEmotionTerm(term);
  return { label: word || String(term ?? ""), color: moodColor(term) };
}

/** 把 10 组按组渲染成文本（组名 + family + category + note + 全部参考说法）。 */
export function renderEmotionLexiconGroups(): string {
  return LEXICON.map((group) => {
    const head = `${group.title} ｜ family：${group.family} ｜ category：${group.category} ｜ kind：${group.kind}`;
    return [head, `  说明：${group.note}`, `  词（${group.terms.length}）：${group.terms.join("、")}`].join(
      "\n",
    );
  }).join("\n\n");
}

/* ───────────────────── 上报一笔情绪：校验 + 归一化（纯函数） ─────────────────────
 *
 * 为什么单独抽成纯函数（而不是写在 `actions.ts` 那个 `case` 里）：
 *   ① `actions.ts` 连锁 import 一大堆界面模块，纯 node 里跑不起来 ——
 *      校验规则写在里面就没法**真跑**验收（只能拿正则猜源码，那是"应该能跑"）。
 *   ② 「词表外的词无效」「quote ≤ 40 / summary ≤ 20 截断」是这一整套适配的**规矩**，
 *      规矩要能被单独测。
 *   所以：这里管"合不合法、怎么归一化"，`actions.ts` 那边只管"入库 + 回一句话"。
 */

/** 动作传来的原始字段（一律 unknown：模型什么都可能写）。 */
export type EmotionReportInput = {
  /** 自由概括 1~5 字（超了截断） */
  primaryEmotion?: unknown;
  /** 10 组之一（**必填**） */
  group?: unknown;
  secondaryEmotions?: unknown;
  intensity?: unknown;
  confidence?: unknown;
  dimensions?: unknown;
  suggestedMode?: unknown;
  evidence?: unknown;
  memoryQuery?: unknown;
};

export type EmotionReportResult =
  | { ok: false; message: string }
  | { ok: true; record: Omit<EmotionEventRecord, "id" | "at">; message: string };

/** 把 evidence 归一化：接受单条对象或数组，最多 2 条，quote/summary 二选一。 */
function normalizeEvidence(raw: unknown): EmotionEvidenceInput[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: EmotionEvidenceInput[] = [];
  for (const item of list.slice(0, EVIDENCE_MAX)) {
    if (!item || typeof item !== "object") continue;
    const quote = clipChars((item as EmotionEvidenceInput).quote, QUOTE_MAX);
    const summary = clipChars((item as EmotionEvidenceInput).summary, SUMMARY_MAX);
    if (quote) out.push({ quote });
    else if (summary) out.push({ summary });
  }
  return out;
}

/**
 * 校验 + 归一化一笔上报（2026-10 新规矩：自由词 + 必填 group）。
 *
 * 规矩（用户 m08526 / m08557 逐条说的）：
 *   · 主情绪是**自由概括**，1~5 个字；超 5 字**截断**（不驳回），回执里说一句；
 *   · `group` **必填**，必须是 10 组 id 之一（bright/calm/…/curious）；不认识 → 整笔不入库；
 *   · 次情绪 0~2 个，也是自由词、各截 5 字，重复的去掉（不因为次情绪废掉整笔）；
 *   · 强度/置信度 0~1；六个维度稀疏、不认识的键丢掉；
 *   · 证据最多 2 条，quote ≤ 40 字 / summary ≤ 20 字（截断，不拒绝）；
 *   · `category` 由 group 推导（不再让它自己填）。
 */
export function buildEmotionReport(input: EmotionReportInput): EmotionReportResult {
  const rawPrimary = normalizeEmotionTerm(input.primaryEmotion);
  const primaryEmotion = clipChars(rawPrimary, PRIMARY_MAX);
  if (!primaryEmotion) {
    return {
      ok: false,
      message: `这一笔没记：primaryEmotion 是空的。用 1~5 个字概括当下最贴的那种感觉，再给一个 group（${EMOTION_GROUP_HINT}）。`,
    };
  }
  const rawGroup = typeof input.group === "string" ? input.group.trim() : "";
  const group = emotionGroupById(rawGroup);
  if (!group) {
    return {
      ok: false,
      message: `这一笔没记：group 不对（收到「${clipChars(rawGroup, 12) || "空"}」）。group 必须从这 10 组里挑一个：${EMOTION_GROUP_HINT}。`,
    };
  }

  const secondaryEmotions: string[] = [];
  const rawSecondary = Array.isArray(input.secondaryEmotions) ? input.secondaryEmotions : [];
  for (const raw of rawSecondary) {
    const word = clipChars(normalizeEmotionTerm(raw), PRIMARY_MAX);
    if (!word || word === primaryEmotion) continue;
    if (!secondaryEmotions.includes(word) && secondaryEmotions.length < SECONDARY_MAX) {
      secondaryEmotions.push(word);
    }
  }

  const dimensions: EmotionDimensionScores = {
    attraction: 0,
    longing: 0,
    shyness: 0,
    restraint: 0,
    warmth: 0,
    unease: 0,
  };
  const rawDimensions = input.dimensions;
  if (rawDimensions && typeof rawDimensions === "object") {
    for (const [key, value] of Object.entries(rawDimensions)) {
      if (isEmotionDimension(key)) dimensions[key] = clamp01(value);
    }
  }

  const evidence = normalizeEvidence(input.evidence);

  const rawQuery = (input.memoryQuery ?? {}) as EmotionMemoryQuery;
  const memoryQuery: EmotionMemoryQuery = {
    emotion: primaryEmotion,
    topic: clipChars(rawQuery.topic, QUOTE_MAX) || undefined,
  };

  const intensity = clamp01(input.intensity, 0.5);
  const confidence = clamp01(input.confidence, 0.5);
  const suggestedMode = isEmotionMode(input.suggestedMode) ? input.suggestedMode : "daily";

  const notes: string[] = [];
  if (primaryEmotion !== rawPrimary) {
    notes.push(`超过 ${PRIMARY_MAX} 字，已截成「${primaryEmotion}」`);
  }
  if (input.suggestedMode && !isEmotionMode(input.suggestedMode)) {
    notes.push("档位不认识，按日常算");
  }

  return {
    ok: true,
    record: {
      primaryEmotion,
      group: group.id,
      secondaryEmotions,
      intensity,
      confidence,
      dimensions,
      suggestedMode,
      category: group.category as EmotionEventRecord["category"],
      evidence,
      memoryQuery,
      sourceType: "conversation_inference",
    },
    message: `上报了一笔情绪：${primaryEmotion}${
      secondaryEmotions.length ? `（+${secondaryEmotions.join("、")}）` : ""
    } · ${group.id} · 强度 ${Math.round(intensity * 100)}% · 置信度 ${Math.round(
      confidence * 100,
    )}% · ${emotionModeLabel(suggestedMode)}档${notes.length ? `｜${notes.join("；")}` : ""}`,
  };
}
