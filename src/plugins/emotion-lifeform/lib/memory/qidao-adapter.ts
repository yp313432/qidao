import type { MemoryKind } from "@/lib/types";
import type { MemoryAdapter, MemoryQuery, MemoryRecord, MemorySearchResult } from "./adapter";

/**
 * **栖岛真记忆 → 「星屿」的记忆检索**。
 *
 * 用户原话（这轮的做法）："记忆检索接上栖岛真记忆"（原来是 `MockMemoryAdapter`）。
 *
 * ── 匹配口径：跟**记忆宇宙**插件同一套（`plugins/memory-universe/adapter/qidao-memory.ts`）
 *
 * 那边建关系只用两份真实依据：`links` 和 `tags`。这里照抄这个口径，
 * 因为这个插件的规矩是"**宁可少连、不要瞎连**"：
 *   · 主线：`memory.tags` 里真有一条命中查询的情绪 / 主题（大小写、空格无所谓）
 *   · 补线：命中的那条记忆在**栖岛自己的图里**（`memory.links`）明确连着另一条
 *   · `topic` 允许"查询词是真标签的一部分"（`咖啡` 命中 `咖啡不加糖`），
 *     但查询词至少 2 个字 —— 免得一个字连出一堆假线
 *   · **正文里恰好出现这几个字不算命中** —— 那是"看起来像"，不是关系。
 *     宁可真返回空、诚实说「暂无可关联的历史记忆。」
 *
 * ── 三条红线（接口作者定的，见 `./adapter.ts` 的注释）
 *   ① 只返回**真命中**的条目（上面那套口径算出来的）；
 *   ② `links.kind` 只有 `"retrieved_for_query"`，`explanation` 必须说清**为什么连上**
 *      （例："标签命中「心动」"）—— 不编永久图边；
 *   ③ **绝不写回**：只读 memory 数组，一个 store 写方法都不调，
 *      也不把推断出来的情绪塞进记忆。
 *
 * ── 数据从哪来
 *   宿主 store（`@/lib/store.ts` 的 `useApp`）里的 `memories` —— 由绑定层
 *   `./index.ts` 用 `setMemorySource()` 注册进来（那边才 import 宿主 store，
 *   这个文件保持"不认识宿主"的纯映射，好离线断言）。
 *   注册不上或还没有记忆时 `hasRealMemories()` 是 false，绑定层回落 mock ——
 *   **不白屏、不报错**。
 */

/** 类别 → 中文名（记忆没有标题时用它当标题）。照 `@/lib/memory.ts` 的 `KIND_LABEL` */
const KIND_LABEL: Record<MemoryKind, string> = {
  profile: "关于你",
  preference: "偏好",
  project: "项目",
  relationship: "关系",
  timeline: "日子",
};

/*
 * ───────────────────────── 纯函数区（可离线断言）─────────────────────────
 */

/** 只有这些字段参与匹配 —— 不依赖 store、不依赖浏览器 */
export type MatchableMemory = {
  id: string;
  content: string;
  kind: MemoryKind;
  source?: string;
  tags: string[];
  links: string[];
  recallCount: number;
  createdAt: number;
  status: "active" | "archived";
};

export const EMPTY_RELATION_NOTE = "暂无可关联的历史记忆。";

const norm = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

/** 情绪/主题 → 用来比对标签的"查询词"：整串 + 按顿号逗号拆开的每一段 */
function needlesOf(value: string | undefined): string[] {
  const raw = (value ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[、,，/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set([raw, ...parts])];
}

type ReasonKind = "emotion" | "topic" | "graph";

type Candidate = {
  memory: MatchableMemory;
  score: number;
  /** 为什么连上 —— 每一块都要能在界面上讲清楚 */
  reasons: { kind: ReasonKind; label: string }[];
};

/**
 * 一个查询词和一条标签的关系。
 * `exact` = 一模一样；`contains` = 真标签包含查询词（查询词至少 2 字）。
 */
function tagHit(needle: string, tag: string): "exact" | "contains" | null {
  const t = norm(tag);
  if (!t) return null;
  if (t === needle) return "exact";
  if ([...needle].length >= 2 && t.includes(needle)) return "contains";
  return null;
}

/** 一条查询词能在哪些标签上命中（exact 优先，只留最好的那个） */
function bestTagHit(needle: string, tags: string[]): { tag: string; level: "exact" | "contains" } | null {
  let best: { tag: string; level: "exact" | "contains" } | null = null;
  for (const tag of tags ?? []) {
    const level = tagHit(needle, tag);
    if (!level) continue;
    if (!best || (best.level === "contains" && level === "exact")) best = { tag, level };
  }
  return best;
}

/** 解释里给用户看的那一小段：说明"为什么连上"，不写别的 */
function labelFor(kind: "emotion" | "topic", tag: string, level: "exact" | "contains"): string {
  const tagText = `「${tag}」`;
  if (level === "exact") return kind === "emotion" ? `标签命中${tagText}` : `主题命中${tagText}`;
  return kind === "emotion" ? `标签里有${tagText}` : `主题写在${tagText}里`;
}

/**
 * 检索（纯函数）。
 *
 * 返回 `{ result, matchedIds }`：`matchedIds` 给图谱那一层用，
 * 让"沿着真实连线补上来的那一条"能指回**具体是哪条命中的记忆**带出来的。
 */
export function searchQidaoMemories(
  memories: readonly MatchableMemory[],
  query: MemoryQuery,
): { result: MemorySearchResult; matchedIds: string[] } {
  const emotionNeedles = needlesOf(query.emotion).map(norm);
  const topicNeedles = needlesOf(query.topic).map(norm);
  const live = memories.filter((m) => m.status !== "archived" && (m.content ?? "").trim());
  const byId = new Map(live.map((m) => [m.id, m]));
  const candidates = new Map<string, Candidate>();

  const keep = (memory: MatchableMemory, score: number, reason: { kind: ReasonKind; label: string }) => {
    const found = candidates.get(memory.id) ?? { memory, score: 0, reasons: [] as Candidate["reasons"] };
    found.score = Math.max(found.score, score);
    if (!found.reasons.some((r) => r.kind === reason.kind && r.label === reason.label)) {
      found.reasons.push(reason);
    }
    candidates.set(memory.id, found);
  };

  /* ① 标签真命中（情绪给高一点权 —— 情绪是这次检索的主诉求） */
  for (const memory of live) {
    for (const needle of emotionNeedles) {
      const hit = bestTagHit(needle, memory.tags);
      if (hit) keep(memory, hit.level === "exact" ? 3 : 2, { kind: "emotion", label: labelFor("emotion", hit.tag, hit.level) });
    }
    for (const needle of topicNeedles) {
      const hit = bestTagHit(needle, memory.tags);
      if (hit) keep(memory, hit.level === "exact" ? 2.5 : 1.5, { kind: "topic", label: labelFor("topic", hit.tag, hit.level) });
    }
  }

  /* ② 沿**栖岛自己的连线**补一层：它明确连着的记忆也算相关（跟记忆宇宙同一依据） */
  for (const from of [...candidates.values()]) {
    for (const id of from.memory.links ?? []) {
      if (candidates.has(id)) continue;
      const other = byId.get(id);
      if (!other) continue;
      const title = titleOf(other.content) || KIND_LABEL[other.kind] || "另一条记忆";
      keep(other, 0.5, { kind: "graph", label: `图谱里连着「${title}」` });
    }
  }

  const ordered = [...candidates.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.memory.createdAt !== a.memory.createdAt) return b.memory.createdAt - a.memory.createdAt;
    return a.memory.id < b.memory.id ? -1 : 1;
  });
  const limit =
    Number.isFinite(query.limit) && (query.limit as number) > 0 ? Math.floor(query.limit as number) : 3;
  const picked = ordered.slice(0, limit);

  const links = picked.map((c) => ({
    memoryId: c.memory.id,
    kind: "retrieved_for_query" as const,
    explanation: c.reasons.map((r) => r.label).join(" · ") || "本次检索命中",
  }));

  return {
    result: {
      memories: picked.map((c) => toMemoryRecord(c.memory)),
      links,
      relationNote: links.length
        ? `这几条是他记忆里真有的：${links.map((l) => l.explanation).join("；")}。`
        : EMPTY_RELATION_NOTE,
      isDemoData: false,
    },
    matchedIds: picked.map((c) => c.memory.id),
  };
}

/**
 * 取一个短标题 —— 记忆没有标题字段，所以用**内容的第一句**。
 * 口径跟记忆宇宙的 `titleOf()` 一致：第一行 → 第一句 → 超 14 字截断。
 */
export function titleOf(content: string): string {
  const first =
    (content ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? "";
  const one = first.split(/[。！？!?；;，,]/)[0]?.trim() || first;
  return one.length > 14 ? `${one.slice(0, 14)}…` : one;
}

/** 来源字段 → 界面上那行小字（老存档里两种写法都要认） */
export function sourceLabelOf(m: MatchableMemory): string {
  const raw = (m.source ?? "").trim();
  if (!raw || raw === "手动" || raw === "manual") return "手记";
  if (raw === "对话" || raw === "chat") return "对话";
  if (raw === "导入" || raw === "import") return "导入";
  return raw;
}

/** 一条栖岛记忆 → 插件要的 `MemoryRecord`（纯映射，不编字段） */
export function toMemoryRecord(m: MatchableMemory): MemoryRecord {
  const created = new Date(m.createdAt);
  return {
    id: m.id,
    title: titleOf(m.content) || KIND_LABEL[m.kind] || "一条记忆",
    summary: m.content,
    sourceLabel: sourceLabelOf(m),
    createdAt: Number.isNaN(created.getTime()) ? new Date(0).toISOString() : created.toISOString(),
    tags: [...(m.tags ?? [])],
    isDemoData: false,
    // 展开时才用到（平时只显示一行）
    recallCount: m.recallCount ?? 0,
    fullContent: m.content,
  };
}

/*
 * ───────────────────────── 读栖岛的记忆（只读）─────────────────────────
 */

/**
 * 宿主把「怎么读栖岛的记忆」注册进来（绑定层 `./index.ts` 干这件事）。
 * 这里只存一个**快照函数**：返回 `null` = 现在取不到（那就回落 mock）。
 */
export type MemorySource = () => readonly MatchableMemory[] | null;

const SOURCE_KEY = "__QIDAO_MEMORY_SOURCE__";
let memorySource: MemorySource | null = null;
const listeners = new Set<() => void>();

/**
 * 注册读法。
 *
 * `globalThis.__QIDAO_MEMORY_SOURCE__` 是给"离开宿主单独跑插件"留的后门
 * （宿主可以在页面脚本里挂一个读法，不用改插件）—— 没挂就当取不到。
 */
export function setMemorySource(source: MemorySource | null): void {
  memorySource = source;
  emitMemoryChange();
}

function emitMemoryChange(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 订阅者自己的问题，不能连累别人
    }
  }
}

/**
 * 订阅"栖岛的记忆变了" —— 界面靠它**重新检索一次**。
 *
 * 为什么必须有：检索是在场景切换时跑一次（`present.ts`），而宿主的记忆可能
 * 比插件晚一步就绪（IndexedDB 是异步 hydrate 的）。没有这条订阅，第一遍检索
 * 会拿着空库去问，之后就一直停在那个答案上 —— 那就是"接了个假的"。
 *
 * @returns 取消订阅
 */
export function subscribeMemorySource(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** 宿主那边记忆一变就吹哨（绑定层把它接到 store 的 `subscribe` 上） */
export function notifyMemoryChange(): void {
  emitMemoryChange();
}

/** 读一份当前记忆快照；取不到就是 null（调用方决定回落谁） */
export function snapshotMemories(): readonly MatchableMemory[] | null {
  const globalSource = (globalThis as Record<string, unknown>)[SOURCE_KEY];
  const external = memorySource ?? (typeof globalSource === "function" ? (globalSource as MemorySource) : null);
  if (typeof external !== "function") return null;
  try {
    const list = external();
    return Array.isArray(list) ? list : null;
  } catch {
    // 宿主读取炸了也不能连累插件 —— 当作取不到，回落 mock
    return null;
  }
}

/** 栖岛现在到底有没有真记忆（给别处判断用） */
export function hasRealMemories(): boolean {
  const list = snapshotMemories();
  return Array.isArray(list) && list.length > 0;
}

/**
 * **栖岛记忆适配器** —— 实现插件的 `MemoryAdapter`。
 *
 * 只返回真命中的条目；没命中就空数组 + 「暂无可关联的历史记忆。」；
 * 不回写、不编永久图边（见文件头那三条红线）。
 */
export const qidaoMemoryAdapter: MemoryAdapter & { hasRealMemories: () => boolean } = {
  name: "QidaoMemoryAdapter",
  hasRealMemories,
  async search(query: MemoryQuery): Promise<MemorySearchResult> {
    const list = snapshotMemories() ?? [];
    return searchQidaoMemories(list, query).result;
  },
};
