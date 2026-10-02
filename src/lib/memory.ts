/**
 * 记忆引擎。
 *
 * 目标不是"存得多"，而是**像人脑**：
 *   · 常提到的越来越牢（反复加深）
 *   · 无关的慢慢淡出（记忆曲线）
 *   · 相关的自动连在一起（神经元连线）
 *   · 提到一件事，相关的那几件自己浮上来（扩散激活）
 *   · 心情一致时更容易想起（心境一致性）
 *   · 关键日子每年自己回来（周期性重现）
 *
 * 全部是**纯函数**：不碰浏览器 API、不碰 store、不联网。
 * 这样才好测，也能放进 Web Worker 里跑（界面不会卡）。
 */

import { expandWithSynonyms, isKnownWord } from "@/lib/synonyms";
import type { Memory, MemoryKind, MoodId } from "@/lib/types";

/**
 * 每种记忆的"半衰期"（天）—— 清晰度掉一半需要多久。
 *
 * 0 表示**不衰减**：名字、重要关系、关键日子这种，本来就不该忘。
 * 项目状态是有寿命的：「最近要忙论文」写完论文就该淡出，
 * 而「正在做自己的前端」只要你还在提就会一直亮着。
 */
export const HALF_LIFE: Record<MemoryKind, number> = {
  profile: 0,
  relationship: 0,
  timeline: 0,
  preference: 540,
  project: 60,
};

export const KIND_LABEL: Record<MemoryKind, string> = {
  profile: "关于你",
  preference: "偏好",
  project: "项目",
  relationship: "关系",
  timeline: "日子",
};

export const KIND_HINT: Record<MemoryKind, string> = {
  profile: "名字、性格、习惯这类不变的",
  preference: "喜欢什么、讨厌什么",
  project: "在做的事（会变，也会过期）",
  relationship: "重要的人和称呼",
  timeline: "生日、纪念日这种日子",
};

export const ALL_KINDS: MemoryKind[] = [
  "profile",
  "preference",
  "project",
  "relationship",
  "timeline",
];

const DAY = 86_400_000;

/* ------------------------------- 记忆曲线 ------------------------------- */

/** 清晰度 0~1：每过一个半衰期掉一半。 */
export function retention(m: Memory, now = Date.now()): number {
  const hl = HALF_LIFE[m.kind];
  const base = m.strength > 0 ? m.strength : 1;
  if (!hl) return Math.min(1, base);
  const last = m.lastRecalledAt ?? m.updatedAt ?? m.createdAt;
  const days = Math.max(0, (now - last) / DAY);
  return Math.max(0, Math.min(1, base * Math.pow(0.5, days / hl)));
}

/** 用来画衰减曲线：从创建到今天，每隔一段取一个清晰度。 */
export function decayPoints(m: Memory, days = 120, steps = 28, now = Date.now()): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = now - (days * (steps - i) * DAY) / steps;
    out.push(retention({ ...m, lastRecalledAt: m.lastRecalledAt }, Math.max(t, m.createdAt)));
  }
  return out;
}

/* -------------------------------- 关键词 -------------------------------- */

const STOP = new Set([
  "的", "了", "是", "我", "你", "他", "她", "在", "有", "和", "就", "都", "也",
  "不", "这", "那", "一个", "什么", "怎么", "可以", "我们", "你们", "the", "a",
  "an", "is", "are", "to", "of", "and", "in", "on", "it", "that", "this",
]);

/**
 * 抽关键词：中文按「双字滑窗」切（不需要词典，够用），英文/数字按词切。
 * 这是零依赖方案；将来想更准可以换成向量检索（可选，要花钱）。
 */
export function keywords(text: string): string[] {
  const out = new Set<string>();
  const lower = text.toLowerCase();

  for (const word of lower.match(/[a-z0-9]{2,}/g) ?? []) {
    if (!STOP.has(word)) out.add(word);
  }
  const han = lower.replace(/[^\u4e00-\u9fa5]/g, " ");
  for (const seg of han.split(/\s+/)) {
    if (seg.length === 1) {
      // 单个汉字一般丢掉（噪音太大），但词典里的要留 ——
      // 「累」「困」这种一个字的词，恰恰是用户最常说的
      if (isKnownWord(seg)) out.add(seg);
      continue;
    }
    if (seg.length === 2) {
      if (!STOP.has(seg)) out.add(seg);
      continue;
    }
    for (let i = 0; i + 2 <= seg.length; i += 1) {
      const bigram = seg.slice(i, i + 2);
      if (!STOP.has(bigram)) out.add(bigram);
    }
  }
  return [...out];
}

/* ------------------------------ 自动归类/连线 ------------------------------ */

/** 从一句话猜类别（用户手动改之前先用它打底）。 */
export function guessKind(text: string): MemoryKind {
  const t = text.toLowerCase();
  if (/生日|纪念日|周年|\d{1,2}\s*[.\-/月]\s*\d{1,2}/.test(t)) return "timeline";
  // 关系要**先判**：否则「你叫小克」会被「叫」这个字抢去 profile
  if (/你叫|他叫|她叫|朋友|家人|同事|对象|妈妈|爸爸|儿子|女儿|伴侣/.test(t)) {
    return "relationship";
  }
  if (/infp|enfp|intj|entp|mbti|性格|我是|本人|我叫|名字/.test(t)) return "profile";
  if (/喜欢|讨厌|偏好|习惯|不爱|爱看|爱听|躺平/.test(t)) return "preference";
  // 「搓」「搞」「正在」这类口语说法也要认出来，否则项目会被误判成 profile
  if (/项目|在做|在忙|正在|论文|开发|计划|最近要|搓|搞|做我自己的|写我自己的/.test(t)) {
    return "project";
  }
  return "profile";
}

/**
 * 自动连线：和已有的记忆有多少共同关键词，够像就牵一条线。
 *
 * 这就是"一起激活，就连在一起"的手工版 —— 以后每次被同一段话一起想起，
 * 连线还会更牢（见 reinforce）。
 */
export function autoLinks(list: Memory[], item: Memory, max = 4): string[] {
  const mine = new Set([...keywords(item.content), ...item.tags.map((t) => t.toLowerCase())]);
  if (mine.size === 0) return [];
  const scored: { id: string; score: number }[] = [];
  for (const other of list) {
    if (other.id === item.id || other.status !== "active") continue;
    const theirs = new Set([...keywords(other.content), ...other.tags.map((t) => t.toLowerCase())]);
    let shared = 0;
    for (const w of mine) if (theirs.has(w)) shared += 1;
    // 同类天然相关，给一点点基础分（阈值 0.3，所以同类就能连上）
    const kindBonus = other.kind === item.kind ? 0.4 : 0;
    const score = shared + kindBonus;
    if (score >= 0.3) scored.push({ id: other.id, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.id);
}

/* --------------------------------- 检索 --------------------------------- */

export type SearchOptions = {
  kinds?: MemoryKind[];
  /** 只看清晰度高于这个值的（默认 0 = 全看） */
  minRetention?: number;
  includeArchived?: boolean;
  /** 排序方式 */
  sort?: "recent" | "strong" | "confidence" | "created";
};

export type SearchHit = { memory: Memory; score: number; retention: number };

/** 关键词搜索 + 分级筛选（类型 / 清晰度 / 状态）。 */
export function searchMemories(
  list: Memory[],
  query: string,
  opts: SearchOptions = {},
  now = Date.now(),
): SearchHit[] {
  // 关键词先过一遍同义词表 —— 这样搜「好累」也能找到写着「精力低」的那条
  const words = expandWithSynonyms(keywords(query));
  const minR = opts.minRetention ?? 0;
  const hits: SearchHit[] = [];

  for (const m of list) {
    if (!opts.includeArchived && m.status !== "active") continue;
    if (opts.kinds?.length && !opts.kinds.includes(m.kind)) continue;
    const r = retention(m, now);
    if (r < minR) continue;

    let score = 0;
    if (words.length === 0) {
      score = 1; // 没输关键词就是"列全部"
    } else {
      const hay = `${m.content} ${m.tags.join(" ")}`.toLowerCase();
      for (const w of words) if (hay.includes(w)) score += 1;
      if (score === 0) continue;
      score += r * 0.5 + m.confidence * 0.3;
    }
    hits.push({ memory: m, score, retention: r });
  }

  const sort = opts.sort ?? "recent";
  hits.sort((a, b) => {
    if (sort === "strong") return b.retention - a.retention;
    if (sort === "confidence") return b.memory.confidence - a.memory.confidence;
    if (sort === "created") return b.memory.createdAt - a.memory.createdAt;
    return b.memory.updatedAt - a.memory.updatedAt;
  });
  return hits;
}

/* ------------------------------ 扩散激活（联想） ------------------------------ */

export type ActivationOptions = {
  limit?: number;
  /** 当前心情 —— 一致的记忆更容易浮现 */
  mood?: MoodId;
  /** 关掉连线扩散，只看直接命中的 */
  noSpread?: boolean;
};

export type Activation = { memory: Memory; score: number; via: "direct" | "link" };

/**
 * 从一句话出发，找出"此刻最该浮现"的几条记忆。
 *
 * 两步：
 *   ① 直接命中：这句话里的关键词出现在记忆里
 *   ② 沿连线扩散：命中了的记忆，把它连着的也带亮一点（传两跳，每跳减半）
 *
 * 分数里揉进三件事：清晰度（快忘的排后面）、置信度、心情一致性。
 */
export function activate(
  list: Memory[],
  cue: string,
  opts: ActivationOptions = {},
  now = Date.now(),
): Activation[] {
  const limit = opts.limit ?? 6;
  // 提问那边扩同义词：说「好累」→ 也去找「躺平 / 精力低 / 不想动」那些记忆
  const words = expandWithSynonyms(keywords(cue));
  const active = list.filter((m) => m.status === "active");
  const score = new Map<string, number>();
  const via = new Map<string, "direct" | "link">();

  const moodFactor = (m: Memory) => (opts.mood && m.mood === opts.mood ? 1.25 : 1);

  /* ① 直接命中 */
  for (const m of active) {
    const hay = `${m.content} ${m.tags.join(" ")}`.toLowerCase();
    let hit = 0;
    for (const w of words) if (hay.includes(w)) hit += 1;
    // 关键日子：到日子前后自动亮起来（每年重现）
    const periodic = periodicBoost(m, now);
    if (hit === 0 && periodic === 0) continue;
    const base = hit * retention(m, now) * (0.5 + 0.5 * m.confidence) * moodFactor(m);
    score.set(m.id, base + periodic);
    via.set(m.id, "direct");
  }

  /* ② 沿连线扩散两跳 */
  if (!opts.noSpread) {
    for (let hop = 0; hop < 2; hop += 1) {
      const snapshot = [...score.entries()];
      for (const [id, own] of snapshot) {
        if (own <= 0.02) continue;
        const from = active.find((m) => m.id === id);
        if (!from) continue;
        for (const target of from.links) {
          const next = active.find((m) => m.id === target);
          if (!next) continue;
          const add = own * 0.5 * retention(next, now) * (0.5 + 0.5 * next.confidence) * moodFactor(next);
          const cur = score.get(next.id) ?? 0;
          if (cur + add > cur) {
            score.set(next.id, cur + add);
            if (!via.has(next.id)) via.set(next.id, "link");
          }
        }
      }
    }
  }

  return [...score.entries()]
    .map(([id, s]) => {
      const memory = active.find((m) => m.id === id)!;
      return { memory, score: s, via: via.get(id) ?? "direct" };
    })
    .filter((x) => x.memory)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 关键日子：每年到日子前 7 天到后 3 天，自动加权（"每年自动想起来"）。 */
function periodicBoost(m: Memory, now: number): number {
  if (m.kind !== "timeline" || !m.at) return 0;
  const mmdd = m.at.slice(5);
  if (mmdd.length < 5) return 0;
  const [mm, dd] = mmdd.split("-").map((v) => Number(v));
  if (!mm || !dd) return 0;

  const today = new Date(now);
  for (const yearOffset of [0, 1]) {
    const target = new Date(today.getFullYear() + yearOffset, mm - 1, dd);
    const diffDays = (target.getTime() - now) / DAY;
    if (diffDays >= -3 && diffDays <= 7) return 1.5;
  }
  return 0;
}

/* -------------------------------- 加深/淡忘 -------------------------------- */

/**
 * 被唤起之后"加深"：次数 +1、强度涨一点、记下时间。
 *
 * 同时做一件更重要的事：**一起被想起的，彼此牵一条线** ——
 * 这就是赫布定律那句"一起激活的神经元会连在一起"。
 * 一句话里同时浮上来两条记忆，它们之间就该长出一条连线，
 * 下次提其中一条，另一条会顺着线跟着亮。
 *
 * 强度有上限（1.6），免得一句话被提一百次就永远压过一切。
 */
export function reinforce(list: Memory[], ids: string[], now = Date.now()): Memory[] {
  const set = new Set(ids.filter((id) => list.some((m) => m.id === id)));
  if (set.size === 0) return list;
  const others = [...set];
  return list.map((m) => {
    if (!set.has(m.id)) return m;
    const linked = others.filter((x) => x !== m.id);
    return {
      ...m,
      recallCount: m.recallCount + 1,
      strength: Math.min(1.6, (m.strength || 1) + 0.08),
      lastRecalledAt: now,
      links: [...new Set([...m.links, ...linked])].slice(0, 8),
    };
  });
}

/** 用户（或他自己）确认"这条还成立" —— 相当于又记了一次。 */
export function confirmMemory(m: Memory, now = Date.now()): Memory {
  return {
    ...m,
    confidence: Math.min(1, m.confidence + 0.1),
    strength: Math.min(1.6, (m.strength || 1) + 0.15),
    lastConfirmedAt: now,
    updatedAt: now,
  };
}

/* --------------------------------- 迁移 --------------------------------- */

/** 老版本存的是 { id, text, createdAt } —— 平滑升成新结构，一条都不丢。 */
export function fromLegacy(old: { id: string; text: string; createdAt: number }[]): Memory[] {
  return old.map((o) => {
    const kind = guessKind(o.text);
    const dateMatch = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(o.text);
    return {
      id: o.id,
      kind,
      content: o.text,
      source: "手动",
      confidence: 0.9,
      strength: 1,
      status: "active" as const,
      tags: [],
      links: [],
      recallCount: 0,
      createdAt: o.createdAt,
      updatedAt: o.createdAt,
      at: kind === "timeline" && dateMatch ? `${dateMatch[1]}-${dateMatch[2]!.padStart(2, "0")}-${dateMatch[3]!.padStart(2, "0")}` : undefined,
    };
  });
}
