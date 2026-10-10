/**
 * 「新情绪词表」的**唯一运行时入口**（13 组 · 约 217 词）。
 *
 * 用户的话："做好适配，不然 AI 不知道怎么用新的情绪词。"
 *
 * 三件事都收在这一个文件里，别在别处再抄一份：
 *   ① **词表本身**：直接 import 插件的 `lib/emotion/lexicon.ts`
 *      —— 同一份数组，改词表不用改两处（手册、动作校验、插件界面读的都是它）。
 *   ② **校验 / 截断**：主情绪必须在表里、quote ≤ 40 字、summary ≤ 20 字。
 *   ③ **给 AI 看的那一节**：`emotionLexiconSection()`（手册里那一节 + 按需取用的动作）。
 *
 * ⚠️ 两条纪律（都是用户明说的）：
 *   · **绝不把词表塞进每轮系统提示词** —— 用户按 token 付费。`manual.ts` 的
 *     `buildManual()` 里**只有一句指引**（见那里的注释），词表靠 `emotion.lexicon` 现取。
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

/** 词表分组（A~M 共 13 组）—— 就是插件那一份。 */
export const EMOTION_GROUPS: readonly LexiconGroup[] = LEXICON;

/** 全部合法词（扁平成一个集合，校验用）。 */
export const EMOTION_TERMS: ReadonlySet<string> = new Set(
  LEXICON.flatMap((group) => group.terms),
);

export const EMOTION_GROUP_COUNT = LEXICON.length;
/**
 * 词条**条目数**（13 组加起来的原始条数 = 217，用户说的"约 217 词"就是这个）。
 *
 * ⚠️ 跟 `EMOTION_TERMS.size`（**不重复**的词 = 209）不是一回事：
 * 有 8 个词同时出现在两组里（不甘 / 忍耐 / 害怕失去 / 意犹未尽 / 试探 / 欲言又止 /
 * 逗弄 / 克制）—— 校验用去重集合，给 AI 报数用条目数（跟他说的那个数对上）。
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

/** 主情绪所在的那一组（找不到返回 null）。 */
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

/** 这个词是不是词表里的（词表外一律无效）。 */
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
 * **心情、花瓣、上报、提示词现在全部只认这一份词表**（13 组 / 217 词）。
 *
 * 为什么界面这里只给**13 个代表词**（每组取第一个），而不是把 217 个词都铺成按钮：
 *   · 日记 / 动态那个心情选择器原来只有 11 个按钮；换成 217 个就不是"改词表"，
 *     是把界面重做一遍 —— 用户明说"不要新做界面"。
 *   · 报告侧不受影响：AI 用 `emotion.report` 报的是**完整的 217 词**，
 *     只有人手动挑心情时用这 13 个"每组一个"的代表（分组见 `LEXICON`）。
 */
export const MOOD_TERMS: readonly string[] = LEXICON.map((group) => group.terms[0]!).filter(
  (term): term is string => Boolean(term),
);

/**
 * 每一组一个颜色 —— 顺序跟 A~M 一一对应。
 *
 * 这些值就是旧 11 维那套颜色（`state-dims.ts` 的 `DIMS[].color`）**原样搬过来**：
 * 用户说了不许动美术，所以只是把"哪个颜色给哪个词"重新按新词表的分组分配一次。
 */
const GROUP_COLORS: readonly string[] = [
  "rgb(251,113,133)", // A 基础积极
  "rgb(96,165,250)", // B 平静与安全
  "rgb(129,140,248)", // C 悲伤与低落
  "rgb(248,113,113)", // D 愤怒与冲突
  "rgb(161,161,170)", // E 焦虑与不确定
  "rgb(251,146,60)", // F 亲密与依恋
  "rgb(244,114,182)", // G 心动与浪漫
  "rgb(45,212,191)", // H 吃醋与占有
  "rgb(168,85,247)", // I 暧昧与撩拨
  "rgb(139,92,246)", // J 欲望与亲密
  "rgb(148,163,184)", // K 克制与拉扯
  "rgb(52,211,153)", // L 认知与探索
  "rgb(217,119,6)", // M 互动与表达
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

/** 把 13 组按组渲染成文本（组名 + family + category + note + 全部词）。 */
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
  primaryEmotion?: unknown;
  secondaryEmotions?: unknown;
  intensity?: unknown;
  confidence?: unknown;
  dimensions?: unknown;
  suggestedMode?: unknown;
  category?: unknown;
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
    // 两个都给时**以 quote 为准**（用户要的是"引起波动的那一句"，不是他自己概括的）
    if (quote) out.push({ quote });
    else if (summary) out.push({ summary });
  }
  return out;
}

/**
 * 校验 + 归一化一笔上报。
 *
 * 规矩（用户逐条说的）：
 *   · 主情绪**必须是词表里的原词**，不在表里 → `ok:false`，整笔不入库；
 *   · 次情绪 0~2 个、也在表里，表外的**丢掉并如实说**（不因为一个次情绪废掉整笔）；
 *   · 强度/置信度 0~1；六个维度稀疏、词表外的键丢掉；
 *   · 证据最多 2 条，quote ≤ 40 字 / summary ≤ 20 字（**截断**，不拒绝）；
 *   · `category` 不写就按主情绪那一组算（词表里本来就标着）。
 */
export function buildEmotionReport(input: EmotionReportInput): EmotionReportResult {
  const primaryEmotion = normalizeEmotionTerm(input.primaryEmotion);
  if (!primaryEmotion) {
    return {
      ok: false,
      message:
        '这一笔没记：primaryEmotion 是空的。主情绪必须从情绪词表里挑一个原词 —— 先写 {"kind":"emotion.lexicon"} 取一份。',
    };
  }
  if (!EMOTION_TERMS.has(primaryEmotion)) {
    return {
      ok: false,
      message: `「${clipChars(primaryEmotion, 12)}」不在情绪词表里，这一笔没记（表里没有的词一律无效）。主情绪要用表里的原词 —— {"kind":"emotion.lexicon"} 可以取整份表。`,
    };
  }
  const group = emotionGroupOf(primaryEmotion);

  const secondaryEmotions: string[] = [];
  const droppedSecondary: string[] = [];
  const rawSecondary = Array.isArray(input.secondaryEmotions) ? input.secondaryEmotions : [];
  for (const raw of rawSecondary) {
    const word = normalizeEmotionTerm(raw);
    if (!word || word === primaryEmotion) continue;
    if (!EMOTION_TERMS.has(word)) {
      droppedSecondary.push(word);
      continue;
    }
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
  const queryEmotion = normalizeEmotionTerm(rawQuery.emotion);
  const memoryQuery: EmotionMemoryQuery = {
    emotion: EMOTION_TERMS.has(queryEmotion) ? queryEmotion : primaryEmotion,
    topic: clipChars(rawQuery.topic, QUOTE_MAX) || undefined,
  };

  const intensity = clamp01(input.intensity, 0.5);
  const confidence = clamp01(input.confidence, 0.5);
  const suggestedMode = isEmotionMode(input.suggestedMode) ? input.suggestedMode : "daily";
  const category = isEmotionCategory(input.category)
    ? input.category
    : ((group?.category ?? "base") as EmotionEventRecord["category"]);

  const notes: string[] = [];
  if (droppedSecondary.length) notes.push(`表外的次情绪已丢掉：${droppedSecondary.join("、")}`);
  if (input.suggestedMode && !isEmotionMode(input.suggestedMode)) {
    notes.push("档位不认识，按日常算");
  }

  return {
    ok: true,
    record: {
      primaryEmotion,
      secondaryEmotions,
      intensity,
      confidence,
      dimensions,
      suggestedMode,
      category,
      evidence,
      memoryQuery,
      sourceType: "conversation_inference",
    },
    message: `上报了一笔情绪：${primaryEmotion}${
      secondaryEmotions.length ? `（+${secondaryEmotions.join("、")}）` : ""
    } · 强度 ${Math.round(intensity * 100)}% · 置信度 ${Math.round(confidence * 100)}% · ${emotionModeLabel(
      suggestedMode,
    )}档${notes.length ? `｜${notes.join("；")}` : ""}`,
  };
}
