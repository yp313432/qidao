/**
 * 「内在」那朵花的花瓣词表 —— **一处定义**，提示词、上报、界面、心情都用它。
 *
 * 为什么要有这个词表、而不是像原来那样写死三个字段：
 *   原来只有 精力 / 想念 / 好奇 三个维度，画出来很单调（用户原话：
 *   "情绪可以多种不只是这几个太单调了"）。
 *
 * 2026-10 又收敛了一次（用户原话："ai 的心情描述还是那六个吗，太少了，
 * 而且不好分类，直接改成图上的这十一个吧"）：
 *   · **心情（MoodId）跟花瓣共用这一张词表**（见 lib/types.ts）——
 *     原来心情单独 6 个词，跟花瓣的 11 个对不上，同一份情绪两处命名。
 *   · 三个花瓣改了名：偏爱 → 心动、野心 → 情愫、精神 → 占有。
 *
 * 为什么是**稀疏上报**（每轮只报"此刻明显的那几个"）：
 *   · 每轮都报满十来个数字 = 每轮都多花一笔 token（用户是按量付费的）；
 *   · 而且"十来个都是 0.3"本来就不像真的 —— 真实的一刻，通常只有一两样很突出。
 *   所以词表放宽到十几个，**由他自己挑此刻明显的那几个报**，
 *   画出来正好是"只有那几瓣亮着"的样子。
 *
 * ⚠️ 名字就是协议里的键（`{"dims":{"心动":0.08}}`），**改名字要连提示词一起改**，
 *    否则他报的词会被丢掉（认不出的键不会写进档案）。
 *    万一提示词没跟上，还有下面的 `LEGACY_ALIASES` 兜着 —— 旧词照样认得出，不丢数据。
 */

export type DimId =
  | "missing"
  | "crush"
  | "care"
  | "share"
  | "curious"
  | "desire"
  | "reflect"
  | "bored"
  | "sad"
  | "angry"
  | "possess";

export type Dim = { id: DimId; label: string; color: string };

/**
 * 花瓣顺序是**故意排的**：亲近的挨在一起、负面的挨在一起，
 * 这样花开的时候能一眼看出"今天偏暖还是偏冷"。
 */
export const DIMS: Dim[] = [
  { id: "missing", label: "想念", color: "rgb(251,113,133)" },
  { id: "crush", label: "心动", color: "rgb(244,114,182)" },
  { id: "care", label: "牵挂", color: "rgb(251,146,60)" },
  { id: "share", label: "分享欲", color: "rgb(52,211,153)" },
  { id: "curious", label: "好奇", color: "rgb(96,165,250)" },
  { id: "desire", label: "情愫", color: "rgb(168,85,247)" },
  { id: "reflect", label: "反思", color: "rgb(148,163,184)" },
  { id: "bored", label: "无聊", color: "rgb(161,161,170)" },
  { id: "sad", label: "难过", color: "rgb(129,140,248)" },
  { id: "angry", label: "生气", color: "rgb(248,113,113)" },
  { id: "possess", label: "占有", color: "rgb(45,212,191)" },
];

export const DIM_IDS = new Set<string>(DIMS.map((d) => d.id));
/** 给提示词用的中文词表（顺序跟上面一致） */
export const DIM_LABELS = DIMS.map((d) => d.label);

/**
 * 旧词 → 新 id 的别名表（**只为兼容旧存档 / 旧提示词**，不参与展示）。
 *
 * 为什么要它：词表在 2026-10 改过名 ——
 *   · 花瓣：偏爱 → 心动、野心 → 情愫、精神 → 占有（中文词和英文 id 一起换了）
 *   · 心情：原来那 6 个 id（calm/joy/focus/low/miss/spark）并进了同一张表
 * IndexedDB 里还躺着用旧词当键的档案（"偏爱" / "fond" / "calm"…），
 * 不能因为改个名就把老数据丢掉 —— 所以统一在这里归到最接近的那一瓣。
 * ⚠️ 以后再改词表，**先往这里补一条**，再改词表和提示词。
 */
const LEGACY_ALIASES: Record<string, DimId> = {
  // 三个改过名的花瓣（旧中文词）
  偏爱: "crush",
  野心: "desire",
  精神: "possess",
  // 「心动」既是新词也是旧词（旧心情里就有 spark 心动）—— 写在这里更明白
  心动: "crush",
  // 旧的 6 个心情 id（老 MoodId）→ 最接近的那一瓣
  calm: "reflect",
  joy: "share",
  focus: "desire",
  low: "sad",
  miss: "missing",
  spark: "crush",
  // 旧的**英文 id**：老存档里 dims 的键，以及老的 energy/missing/curious 顶层字段
  fond: "crush",
  ambition: "desire",
  energy: "possess",
};

/**
 * 旧的 6 个心情 id → 它们当时的中文名。
 *
 * **只给界面做显示兜底**：老存档的 mood 存的是 "calm" 这种，
 * 新词表里查不到 —— 不兜一下界面上就是一块空白。
 * 数据层不靠它（数据层的旧值走 `LEGACY_ALIASES` 归到最近的一瓣）。
 */
export const LEGACY_MOOD_LABELS: Record<string, string> = {
  calm: "平静",
  joy: "开心",
  focus: "专注",
  low: "低落",
  miss: "想念",
  spark: "心动",
};

/**
 * 中文词或英文 id → 规范 id。
 *
 * ⚠️ 为什么必须有它：提示词里让他报的是**中文词**（`{"dims":{"心动":0.08}}`，
 * 他读起来自然），而内部存的是 id。第一版只认 id，于是**他报的情绪全被丢掉**、
 * 花永远是空的 —— 这种"两边都自己写的、就是没对齐"的错最难靠肉眼发现，
 * 是脚本里的纯逻辑断言抓出来的。
 */
const LABEL_TO_ID = new Map(DIMS.map((d) => [d.label, d.id]));
export function normalizeDimKey(key: string): DimId | null {
  const k = key.trim();
  if (DIM_IDS.has(k)) return k as DimId;
  return LABEL_TO_ID.get(k) ?? LEGACY_ALIASES[k] ?? null;
}

/**
 * 心情值 → 展示用（心情分布条、动态、日记、状态采样都用它）。
 *
 * 三种情况都别让界面空着：
 *   · 新词表里的 id（"crush"）→ 新词（心动）+ 词表里的颜色
 *   · 老存档的 mood（"calm"）→ 显示它当时的中文名（平静），颜色借最接近那瓣
 *   · 完全不认识 → 原样显示（总比一片空白强）
 */
export function moodDisplay(key: string): { label: string; color: string } {
  const hit = DIMS.find((d) => d.id === key);
  if (hit) return { label: hit.label, color: hit.color };
  const near = normalizeDimKey(key);
  const nearDim = near ? DIMS.find((d) => d.id === near) : undefined;
  return {
    label: LEGACY_MOOD_LABELS[key] ?? nearDim?.label ?? key,
    color: nearDim?.color ?? "rgb(148,163,184)",
  };
}

/**
 * 展示用的"零值底"：某一瓣没报过时也留一点点，好让人看出词表里还有它。
 * ⚠️ **只该用在画图那一层**，不要用在 `dimsOf` / 平均值里 ——
 * 否则"没报过"会被算成 0.06，平均值全被抬起来（实测：1 和 0 的平均变成 0.53）。
 */
export const ZERO_PETAL = 0.06;

const clamp = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};

/**
 * 一笔状态 → 每个维度的值（**没报的就是 0**，不加底）。
 *
 * 兼容三种存档：
 *   · 新数据：`dims` 里有稀疏的几个键（中文词或 id 都认）
 *   · 老数据：只有 `energy` / `missing` / `curious` 三个顶层字段
 *     （`energy` 就是老词"精力/精神" → 现在归到「占有」）
 *   · 混合：两者都有（以 `dims` 为准）
 */
export function dimsOf(sample: {
  energy?: number;
  missing?: number;
  curious?: number;
  dims?: Partial<Record<string, number>>;
}): Record<DimId, number> {
  const out = {} as Record<DimId, number>;
  for (const d of DIMS) out[d.id] = 0;
  for (const k of ["energy", "missing", "curious"] as const) {
    const v = sample[k];
    const id = normalizeDimKey(k);
    if (id && typeof v === "number") out[id] = clamp(v);
  }
  for (const [k, v] of Object.entries(sample.dims ?? {})) {
    const id = normalizeDimKey(k);
    if (id) out[id] = clamp(v);
  }
  return out;
}

/** 一段时间的平均（没记录的不算 0 —— 只平均真的报过的样本） */
export function averageDims(
  samples: { energy?: number; missing?: number; curious?: number; dims?: Partial<Record<string, number>> }[],
): Record<DimId, number> {
  const out = {} as Record<DimId, number>;
  for (const d of DIMS) out[d.id] = 0;
  if (!samples.length) return out;
  const sums = {} as Record<DimId, number>;
  for (const s of samples) {
    const v = dimsOf(s);
    for (const d of DIMS) sums[d.id] = (sums[d.id] ?? 0) + v[d.id];
  }
  for (const d of DIMS) out[d.id] = sums[d.id] / samples.length;
  return out;
}

/** 此刻最明显的一瓣（用来在花心写名字和数值） */
export function strongest(dims: Record<DimId, number>): { id: DimId; label: string; value: number } {
  let best = DIMS[0]!;
  for (const d of DIMS) if (dims[d.id] > dims[best.id]) best = d;
  return { id: best.id, label: best.label, value: dims[best.id] };
}
