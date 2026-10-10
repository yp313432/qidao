/**
 * **两段式记忆召回** —— 把"标签对不上就想不起来"改成"意思像也能想起来"。
 *
 * 用户原话："记忆升级的话，加一个那个语义检索功能就可以了，我觉得。"
 *
 * ── 为什么要两段（而不是直接把整库丢给模型）
 *
 * 记忆库会长到几百上千条，"每次都把全库发给模型"既贵又慢，而且模型面对
 * 一千条候选的挑选质量会掉。所以拆成两段：
 *
 *   ① **粗筛**（本地、免费、同步）：标签 / 关键词 / 时间 / 最近 → **~20 条候选**。
 *   ② **精排**（现有对话模型，可选、可失败）：只把 20 条候选的 `id + 一小段内容`
 *      发过去，让它挑出最相关的 ≤5 条 + 每条一句"为什么相关"。
 *   ③ **混合排序**：**标签真命中 > 语义相关**（真命中永远置顶）。
 *   ④ **诚实**：真的都无关 → `note` 就是 `暂无可关联的历史记忆。`
 *
 * ── ⚠️ 这一版最关键的一处改动（不然第二段没东西可挑）
 *
 * 升级前："标签不命中就返回空"。那样第二段拿到的是**空候选**，语义检索
 * 再强也无从下手。现在改成：**命中不了也要给候选** —— 把"最近 + 强度"的
 * 那批也纳入候选（`matchedBy: "fill"`），由第二段去判断它们到底相不相关。
 *
 * ── 三条纪律
 *
 *   ① **模型那头绝不能拖垮检索**：它超时 / 报错 / 这台设备根本读不到上游配置，
 *      都必须**退回粗筛的结果**并**如实说"语义那一步没成"** —— 检索本身不失败。
 *   ② **不许瞎连**："正文里恰好出现这几个字"只当作**候选排序的加分**，
 *      不当成真命中（跟 `plugins/emotion-lifeform/.../qidao-adapter.ts` 同一条红线）。
 *      真命中的唯一凭据是**标签**（或调用方给的、它自己口径算出来的真命中）。
 *   ③ **只读**：不写回任何记忆，不 `reinforce`，不改 `recallCount`。
 *
 * ── 这个文件为什么是"零运行时依赖"
 *
 * 仓库的验收惯例（`verify-*.mjs`）是**纯 node 直接 import 真的 `.ts`**，
 * 而 `@/` 这个别名只有 Vite / tsc 认。所以这里：
 *   · 类型用 `import type` 从 `@/lib/types` 拿（`--experimental-strip-types` 会整行擦掉）；
 *   · 值只从**相对路径 `.ts`** 拿（`./memory.ts`，跟 `lib/manual.ts` 同一个写法）。
 * 这样 `verify-recall.mjs` 能不起浏览器、不连网就把这一层断言干净。
 */

import { keywords } from "./memory.ts";
import type { MemoryKind } from "@/lib/types";

/* ───────────────────────────── 对外说的话 ───────────────────────────── */

/**
 * "真的都无关"时那句话。
 *
 * ⚠️ **一个字都别改** —— 这条文案在界面上已经存在（星屿插件的记忆引用），
 * 用户认的就是它。
 */
export const EMPTY_RECALL_NOTE = "暂无可关联的历史记忆。";

/** 精排最多回几条（硬上限，模型说再多也砍） */
export const RERANK_MAX_PICKS = 5;
/** 粗筛最多给几条候选（硬上限） */
export const COARSE_MAX_CANDIDATES = 20;
/** 单次精排的超时（毫秒）—— 超过就当这一步没成，退回粗筛 */
export const RERANK_TIMEOUT_MS = 15_000;

/* ───────────────────────────── 类型 ───────────────────────────── */

/**
 * 能被召回的**最小形状**。
 *
 * 故意不要求完整的 `Memory`：星屿插件那边拿到的是一份"只读快照"
 * （`MatchableMemory`，没有 `confidence` / `strength` / `updatedAt`），
 * 它也该能直接用。缺的字段按默认值算，**绝不编数据**。
 */
export type RecallableMemory = {
  id: string;
  content: string;
  tags?: string[];
  links?: string[];
  kind?: MemoryKind | string;
  status?: string;
  confidence?: number;
  strength?: number;
  createdAt?: number;
  updatedAt?: number;
};

/** 这条是**怎么被找出来的** —— `"tag"` = 本地真命中（标签 / 已存连线），`"semantic"` = 意思像 */
export type RecallMatchedBy = "tag" | "semantic";

export type RecallItem<M extends RecallableMemory = RecallableMemory> = {
  memory: M;
  /** 一句"为什么相关" —— 本地命中的说命中什么，语义命中的用模型给的理由 */
  why: string;
  matchedBy: RecallMatchedBy;
};

/**
 * 精排那一步最后到底怎么样了。
 *
 * ⚠️ 这个字段存在的唯一理由是**诚实**：界面 / 调用方据此知道
 * "这次是语义检索帮上忙了"还是"语义那步没成，只有标签"。
 */
export type RecallSemanticState =
  /** 精排跑了，而且真的挑出了东西 */
  | "ok"
  /** 精排跑了，但它说一条都不相关 */
  | "empty"
  /** 调用方把它关了（`semantic: false`） */
  | "off"
  /** 候选全是真命中，本地就够回答了 —— **没花模型的钱** */
  | "not-needed"
  /** 这台设备上这一步不可用（没有上游配置 / 环境不支持） */
  | "unavailable"
  /** 调了，但失败了 */
  | "failed"
  /** 调了，超时了 */
  | "timeout"
  /** 命中缓存，这次**没有调模型** */
  | "cached";

export type RecallResult<M extends RecallableMemory = RecallableMemory> = {
  items: RecallItem<M>[];
  /** 给人看的一句话（星星屿插件直接把它当 `relationNote` 用） */
  note: string;
  semantic: RecallSemanticState;
  /** 语义那一步的**人话**说明（失败时就是"为什么没成"） */
  semanticNote: string;
  /** 粗筛一共给了几条候选（诊断用） */
  candidates: number;
  /** 这次是不是复用了缓存（= 没调模型） */
  fromCache: boolean;
};

/** 发给模型的一条候选（**id + 一小段内容**，不塞全文） */
export type RerankCandidate = {
  id: string;
  content: string;
  tags: string[];
  kind?: string;
};

export type RerankPick = { id: string; why: string };

/**
 * 精排器。
 *
 * 返回 `null` = **这一步没成**（调用方该退回粗筛并如实说）；
 * 返回 `[]` = 模型说"都不相关"（这是一个**有效结论**，不是失败）。
 */
export type RecallReranker = (
  input: { query: string; candidates: readonly RerankCandidate[] },
  signal?: AbortSignal,
) => Promise<RerankPick[] | null>;

export type RecallOptions<M extends RecallableMemory = RecallableMemory> = {
  /** 记忆库。不传就现读宿主 store（浏览器里那一条）；纯 node 里读不到 = 空库 */
  list?: readonly M[];
  /** 关掉语义精排（只走本地粗筛）。默认开 */
  semantic?: boolean;
  /** 最终返回几条上限。默认 5 */
  limit?: number;
  /** 粗筛候选上限。默认 20（硬上限也是 20） */
  candidateLimit?: number;
  /** 精排单次超时（毫秒）。默认 15000 */
  timeoutMs?: number;
  /**
   * **由调用方按自己的口径算好的"真命中"**。
   *
   * 为什么要这个口子：星屿插件的口径是"**只有标签真命中 / 已存的连线**才算"，
   * 而且"正文里恰好出现那几个字不算命中"（`qidao-adapter.ts` 写死的红线）。
   * 传了它，本文件就**只负责**补候选、调精排、混合排序、兜底 —— 口径不重写。
   */
  localHits?: readonly { id: string; why: string }[];
  /** 精排器。不传就用现有对话模型（`@/lib/recall-model` 的 `chatReranker`） */
  rerank?: RecallReranker;
  /** 关掉缓存（验收用）。默认开 */
  useCache?: boolean;
  signal?: AbortSignal;
  now?: number;
};

/* ───────────────────────────── 小工具 ───────────────────────────── */

const DAY = 86_400_000;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const clamp01 = (n: number) => clamp(Number.isFinite(n) ? n : 0, 0, 1);
const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();

/** 一条记忆现在还剩多少"清晰度"（0~1）—— 粗筛只拿它当**排序**用，不当命中凭据 */
function freshScore(m: RecallableMemory, now: number): number {
  const last = m.updatedAt ?? m.createdAt ?? 0;
  if (!last) return 0.5;
  const days = Math.max(0, (now - last) / DAY);
  // 30 天掉一半的粗代理（真正的记忆曲线在 `lib/memory.ts`，这里只要个序）
  return 1 / (1 + days / 30);
}

function strengthOf(m: RecallableMemory): number {
  return clamp01(m.strength ?? 1);
}

function confidenceOf(m: RecallableMemory): number {
  return clamp01(m.confidence ?? 0.7);
}

/**
 * 查询 → 用来比对的"针"。
 *
 *   · 整串（`咖啡不加糖` 能整体命中一个长标签）
 *   · 按顿号 / 逗号 / 斜杠 / 空格拆开的每一段（插件那边 `emotion + topic` 就是这个形状）
 *   · `keywords()` 切出来的词（中文双字滑窗 + 英文数字词，跟 `lib/memory.ts` 同一套）
 *
 * ⚠️ **故意不做同义词扩展**：同义词是"意思像"，那是**第二段（模型）**的活。
 * 在粗筛就扩同义词，会把"意思像"误报成"标签真命中"，把两段的口径搅在一起。
 */
export function recallNeedles(query: string): string[] {
  const raw = (query ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[、,，/|\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out = new Set<string>();
  for (const p of [...parts, raw]) out.add(norm(p));
  for (const w of keywords(raw)) out.add(norm(w));
  out.delete("");
  return [...out];
}

/** 一个"针"和一条标签的关系：一模一样，还是真标签包含它（针至少 2 个字，免得一个字连出一堆假线） */
function tagHit(needle: string, tag: string): "exact" | "contains" | null {
  const t = norm(tag);
  if (!t || !needle) return null;
  if (t === needle) return "exact";
  if ([...needle].length >= 2 && t.includes(needle)) return "contains";
  return null;
}

/* ───────────────────────── 第 1 段：本地粗筛 ───────────────────────── */

export type RecallCandidate<M extends RecallableMemory = RecallableMemory> = {
  memory: M;
  /** 本地分数（只在粗筛里排序用，不对外） */
  score: number;
  /**
   * `"tag"` = 本地真命中；`"fill"` = **凑数的候选**（本地判不了，交给第二段）。
   *
   * ⭐ `"fill"` 就是这次升级的核心：以前这些根本不会出现在结果里。
   */
  matchedBy: "tag" | "fill";
  why: string;
};

export type CoarseOptions = {
  candidateLimit?: number;
  localHits?: readonly { id: string; why: string }[];
  now?: number;
};

/**
 * **第 1 段：本地粗筛（纯函数、免费、同步）。**
 *
 * 规则（按优先级）：
 *   ① 调用方给的 `localHits` —— **口径由调用方定**，排在最前，原序保留；
 *   ② 没给就自己算字面命中：
 *      · 标签命中（exact 3 分 / contains 2 分）→ **真命中**；
 *      · 正文里同时对上 **≥2 个**针 → 也算真命中（一个针是巧合，两个就是证据）；
 *      · 正文里只对上 1 个针 → **只加分、不算真命中**（"恰好出现这几个字"不算关系）；
 *   ③ 剩下的按 **最近 + 强度** 补足到 `candidateLimit`（默认 20）—— 这一批
 *      就是"命中不了也要给候选"的那批，`matchedBy: "fill"`。
 */
export function coarseRecall<M extends RecallableMemory>(
  list: readonly M[],
  query: string,
  opts: CoarseOptions = {},
): RecallCandidate<M>[] {
  const now = opts.now ?? Date.now();
  const limit = clamp(Math.floor(opts.candidateLimit ?? COARSE_MAX_CANDIDATES), 1, COARSE_MAX_CANDIDATES);

  // 归档的不上桌；内容为空的不上桌（跟记忆宇宙 / 星屿同一口径）
  const live = list.filter((m) => m && m.id && m.status !== "archived" && String(m.content ?? "").trim());
  const byId = new Map(live.map((m) => [m.id, m]));

  /** 真命中（id → 为什么） */
  const realWhy = new Map<string, string>();
  /** 本地分数（越高越该被第二段看到） */
  const score = new Map<string, number>();
  const bump = (id: string, add: number) => score.set(id, (score.get(id) ?? 0) + add);

  const given = opts.localHits ?? null;
  if (given) {
    /* ① 调用方的口径 —— 原序保留（它那边已经排好序了） */
    let rank = given.length;
    for (const h of given) {
      const m = byId.get(h.id);
      if (!m) continue;
      if (!realWhy.has(m.id)) realWhy.set(m.id, (h.why || "").trim() || "本地命中");
      bump(m.id, 100 + rank); // 真命中之间保持调用方给的顺序
      rank -= 1;
    }
  } else {
    /* ② 本文件自己的字面口径 */
    const needles = recallNeedles(query);
    if (needles.length > 0) {
      for (const m of live) {
        const tags = (m.tags ?? []).map((t) => String(t));
        let best: { tag: string; level: "exact" | "contains" } | null = null;
        for (const needle of needles) {
          for (const tag of tags) {
            const level = tagHit(needle, tag);
            if (!level) continue;
            if (!best || (best.level === "contains" && level === "exact")) best = { tag, level };
          }
        }
        if (best) {
          const why = best.level === "exact" ? `标签命中「${best.tag}」` : `标签里有「${best.tag}」`;
          realWhy.set(m.id, why);
          bump(m.id, best.level === "exact" ? 3 : 2);
          continue;
        }
        // 正文重合：算清楚**对上了几个针**
        const hay = norm(m.content);
        const words = needles.filter((n) => [...n].length >= 2 && hay.includes(n));
        if (words.length >= 2) {
          realWhy.set(m.id, `正文里对上了「${words.slice(0, 2).join("」「")}」`);
          bump(m.id, 1.5 + words.length * 0.25);
        } else if (words.length === 1) {
          // 只对上 1 个 → 只是"看起来像"，**不算关系**，只当候选排序的加分
          bump(m.id, 0.4);
        }
      }
    }
  }

  /* 大家都有的一点底分：清晰度 + 置信度（只影响排序，不影响"是不是真命中"） */
  const base = (m: M) => freshScore(m, now) * 0.5 + confidenceOf(m) * 0.3;

  const real: RecallCandidate<M>[] = [];
  const fill: RecallCandidate<M>[] = [];
  for (const m of live) {
    const why = realWhy.get(m.id);
    if (why) {
      real.push({ memory: m, score: (score.get(m.id) ?? 0) + base(m), matchedBy: "tag", why });
    } else {
      fill.push({
        memory: m,
        score: freshScore(m, now) * 0.5 + strengthOf(m) * 0.5,
        matchedBy: "fill",
        why: "",
      });
    }
  }

  real.sort((a, b) => b.score - a.score || (b.memory.updatedAt ?? 0) - (a.memory.updatedAt ?? 0));
  // 候选的补位顺序：最近 > 强度（"命中不了也要给候选"的那一批）
  fill.sort(
    (a, b) =>
      (b.memory.updatedAt ?? b.memory.createdAt ?? 0) - (a.memory.updatedAt ?? a.memory.createdAt ?? 0) ||
      strengthOf(b.memory) - strengthOf(a.memory) ||
      (a.memory.id < b.memory.id ? -1 : 1),
  );

  return [...real.slice(0, limit), ...fill.slice(0, Math.max(0, limit - real.length))];
}

/* ───────────────────────── 缓存（省钱的那一半） ───────────────────────── */

/**
 * **缓存键 = 查询 + 记忆库版本**。
 *
 * 版本怎么算（用户定的口径）：**记忆条数 + 最新 `updatedAt`**。
 * 再补一个最新 `createdAt`：只加不删的场景下 `updatedAt` 不一定动，
 * 补上它能让"新记了一条"必定失效。另外把 `limit` / 语义开关也算进键里 ——
 * 同一句话、不同条数上限是两个问题，不能互相盖。
 */
export function libraryVersion(list: readonly RecallableMemory[]): string {
  let count = 0;
  let maxUpdated = 0;
  let maxCreated = 0;
  for (const m of list) {
    if (!m || m.status === "archived") continue;
    count += 1;
    maxUpdated = Math.max(maxUpdated, m.updatedAt ?? 0);
    maxCreated = Math.max(maxCreated, m.createdAt ?? 0);
  }
  return `${count}:${maxUpdated}:${maxCreated}`;
}

export function recallCacheKey(
  query: string,
  list: readonly RecallableMemory[],
  opts: { limit?: number; semantic?: boolean } = {},
): string {
  return [
    norm(query),
    libraryVersion(list),
    clamp(Math.floor(opts.limit ?? 5), 1, 99),
    opts.semantic === false ? "off" : "on",
  ].join("|");
}

/** 上限：别让缓存变成一个常驻内存的记忆库 */
const CACHE_MAX = 24;
const cache = new Map<string, RecallResult<RecallableMemory>>();

export function clearRecallCache(): void {
  cache.clear();
}

export function recallCacheSize(): number {
  return cache.size;
}

function cacheGet(key: string): RecallResult<RecallableMemory> | null {
  return cache.get(key) ?? null;
}

function cacheSet(key: string, value: RecallResult<RecallableMemory>): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}

/* ───────────────────── 第 2 段的"谁来跑"（可注入、可缺） ───────────────────── */

/**
 * 默认精排器 = **现有对话模型**（`src/lib/recall-model.ts`）。
 *
 * 为什么用**动态 import**：这个文件要能在纯 node 里被 import（见文件头），
 * 而真精排器要拉 `lib/store` + `lib/chat-client`（都是浏览器那一套）。
 * 动态 import 让"只有真要用模型时才把那套拉进来"；拉不到就**如实说不可用**，
 * 绝不让整个检索失败。
 */
let lastResolveError = "";
/** 真精排器 + "这台设备现在能不能跑"的探针（只解一次模块，探针每次都问） */
let resolvedReranker: { fn: RecallReranker | null; probe: (() => boolean) | null } | null = null;
async function resolveDefaultReranker(): Promise<{ fn: RecallReranker | null; available: boolean }> {
  if (!resolvedReranker) {
    try {
      const mod = (await import("@/lib/recall-model")) as {
        chatReranker?: RecallReranker;
        rerankAvailable?: () => boolean;
      };
      resolvedReranker = {
        fn: typeof mod.chatReranker === "function" ? mod.chatReranker : null,
        probe: typeof mod.rerankAvailable === "function" ? mod.rerankAvailable : null,
      };
    } catch (err) {
      lastResolveError = (err as Error)?.message ?? String(err);
      resolvedReranker = { fn: null, probe: null };
    }
  }
  const { fn, probe } = resolvedReranker;
  if (!fn) return { fn: null, available: false };
  /**
   * ⚠️ 探针**每次都问**（不缓存结论）：用户可能刚在设置里把上游填好，
   * 那时语义精排应该立刻就可用。
   */
  let available = true;
  if (probe) {
    try {
      available = probe() !== false;
    } catch {
      available = false;
    }
  }
  return { fn, available };
}

/** 不传 `list` 时现读宿主 store（浏览器里那一条）。读不到 = 空库，不报错。 */
async function loadHostMemories(): Promise<readonly RecallableMemory[]> {
  try {
    const mod = (await import("@/lib/store")) as {
      useApp?: { getState?: () => { memories?: readonly RecallableMemory[] } };
    };
    const list = mod.useApp?.getState?.().memories;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/* ───────────────────────── 主流程 ───────────────────────── */

function buildNote(items: RecallItem[], semantic: RecallSemanticState, semanticNote: string): string {
  // 真的都无关 —— 一个字都别改（见 EMPTY_RECALL_NOTE）
  if (items.length === 0) return EMPTY_RECALL_NOTE;

  const head = `这几条是他记忆里真有的：${items.map((i) => i.why).join("；")}。`;
  const sem = items.filter((i) => i.matchedBy === "semantic").length;

  /**
   * 尾巴只说**真话**：
   *   · 有语义挑出来的 → 说清"后面那几条是意思像，不是标签命中"；
   *   · 语义那步没成（关了 / 不可用 / 失败 / 超时）→ 如实说没成；
   *   · 成功且全是真命中 → 什么都不加（别给界面添噪音）。
   */
  if (sem > 0) return `${head}（后 ${sem} 条是语义检索找出来的：意思像，不是标签命中。）`;
  if (semantic === "ok" || semantic === "empty" || semantic === "not-needed" || semantic === "cached") {
    return head;
  }
  return `${head}（${semanticNote}）`;
}

/**
 * ⭐ **正在飞的那几次检索**（同 key 共用同一趟）。
 *
 * 为什么必须有：界面会把检索跑好几次（面板挂载、场景切换、记忆 hydrate 完再来一次），
 * 而它们**几乎同时**发生 —— 光靠"结果缓存"拦不住：第一次还没回来，其余几次
 * 已经各自把模型调了一遍（实测一个查询能被重复调 6 次）。
 * 这里让同一句话 + 同一个记忆库版本**只花一次钱**。
 */
const inFlight = new Map<string, Promise<RecallResult<RecallableMemory>>>();

/**
 * **召回一条记忆该被想起来的那几条。**
 *
 * 永远 resolve（不 reject）：模型那头出什么事都只是让"语义那一步没成"，
 * 粗筛的结果照旧返回。
 */
export async function recallMemories<M extends RecallableMemory>(
  query: string,
  opts: RecallOptions<M> = {},
): Promise<RecallResult<M>> {
  const q = (query ?? "").trim();
  const list = (opts.list ?? ((await loadHostMemories()) as readonly M[])) ?? [];
  const limit = clamp(Math.floor(opts.limit ?? RERANK_MAX_PICKS), 1, 12);
  const candidateLimit = clamp(
    Math.floor(opts.candidateLimit ?? COARSE_MAX_CANDIDATES),
    1,
    COARSE_MAX_CANDIDATES,
  );
  const semanticOn = opts.semantic !== false;
  const now = opts.now ?? Date.now();

  /* ---------- 缓存：同一句话 + 记忆库没变 → 直接复用，不再调模型 ---------- */
  const key = recallCacheKey(q, list, { limit, semantic: semanticOn });
  const useCache = opts.useCache !== false;
  if (useCache) {
    const hit = cacheGet(key);
    if (hit) {
      return {
        ...(hit as unknown as RecallResult<M>),
        fromCache: true,
        semantic: "cached",
        semanticNote: "记忆库没变，复用了上一次的检索结果（这次没调模型）。",
      };
    }
    // 同一句话正在飞 → 搭那趟顺风车，别再多调一次模型
    const running = inFlight.get(key);
    if (running) return (await running) as unknown as RecallResult<M>;
  }

  const work = runRecall<M>({ q, list, opts, limit, candidateLimit, semanticOn, now, key, useCache });
  if (useCache) {
    inFlight.set(key, work as unknown as Promise<RecallResult<RecallableMemory>>);
    // 不产生"未处理的 rejection"：`runRecall` 本身不会 reject，这里也两头都接住
    void work.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key),
    );
  }
  return work;
}

/** 真正干活的那一趟（缓存 / 在飞判定都在上面那个函数里） */
async function runRecall<M extends RecallableMemory>(ctx: {
  q: string;
  list: readonly M[];
  opts: RecallOptions<M>;
  limit: number;
  candidateLimit: number;
  semanticOn: boolean;
  now: number;
  key: string;
  useCache: boolean;
}): Promise<RecallResult<M>> {
  const { q, list, opts, limit, candidateLimit, semanticOn, now, key, useCache } = ctx;

  const candidates = coarseRecall<M>(list, q, {
    candidateLimit,
    localHits: opts.localHits,
    now,
  });
  const localCands = candidates.filter((c) => c.matchedBy === "tag");
  const fillCands = candidates.filter((c) => c.matchedBy === "fill");

  /* ---------- 真命中永远置顶（"标签真命中 > 语义相关"） ---------- */
  const tagItems: RecallItem<M>[] = localCands
    .slice(0, limit)
    .map((c) => ({ memory: c.memory, why: c.why, matchedBy: "tag" as const }));

  /* ---------- 第 2 段：精排（可关、可失败、可超时） ---------- */
  let semantic: RecallSemanticState;
  let semanticNote: string;
  let picks: RerankPick[] = [];

  if (!semanticOn) {
    semantic = "off";
    semanticNote = "语义精排这次是关着的，只按标签和已存的连线找。";
  } else if (fillCands.length === 0) {
    // 候选全是真命中 —— 本地就够回答了，**没必要花模型的钱**
    semantic = "not-needed";
    semanticNote = "本地命中已经够回答这次检索，没有花模型的钱。";
  } else {
    const resolved = opts.rerank ? { fn: opts.rerank, available: true } : await resolveDefaultReranker();
    const rerank = resolved.fn;
    if (!rerank || !resolved.available) {
      semantic = "unavailable";
      /**
       * 给用户看的是**人话**，不是内部报错（"Cannot find package '@/lib'" 这种
       * 只会让人以为东西坏了）。原始原因留在控制台，排查时看得到。
       */
      if (lastResolveError && !rerank) console.debug("[qidao] 记忆精排不可用：", lastResolveError);
      semanticNote = "语义精排没跑成（这台设备上没有配可用的上游），只按标签和已存的连线找。";
    } else {
      const timeoutMs = clamp(Math.floor(opts.timeoutMs ?? RERANK_TIMEOUT_MS), 200, 60_000);
      const ac = new AbortController();
      const onOuterAbort = () => ac.abort();
      opts.signal?.addEventListener("abort", onOuterAbort);
      let timedOut = false;

      /**
       * 双保险：① 把 `signal` 传下去（上游那条 fetch 真的会被掐断）；
       * ② 再 `Promise.race` 一个超时 —— 万一哪天精排器不理 signal，
       *    这一步也绝不可能把整个检索吊在那儿。
       */
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raced = await Promise.race([
          Promise.resolve(rerank({ query: q, candidates: toRerankCandidates(fillCands) }, ac.signal)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              ac.abort();
              reject(new Error("recall rerank timeout"));
            }, timeoutMs);
          }),
        ]);
        if (raced === null || raced === undefined) {
          semantic = "failed";
          semanticNote = "语义精排这一步没成（模型没有给出可用的结果），只按标签和已存的连线找。";
        } else {
          // 只认**候选里真有**的 id：模型偶尔会编一个不存在的 id 出来，那是幻觉，不能上桌
          const allowed = new Set(fillCands.map((c) => c.memory.id));
          const seen = new Set<string>();
          const picked: RerankPick[] = [];
          for (const p of Array.isArray(raced) ? raced : []) {
            if (!p || typeof p.id !== "string") continue;
            if (!allowed.has(p.id) || seen.has(p.id)) continue;
            seen.add(p.id);
            picked.push({ id: p.id, why: cleanWhy(p.why) });
            if (picked.length >= RERANK_MAX_PICKS) break;
          }
          picks = picked;
          if (picks.length > 0) {
            semantic = "ok";
            semanticNote = `语义精排跑过了（从 ${fillCands.length} 条候选里挑出 ${picks.length} 条）。`;
          } else {
            semantic = "empty";
            semanticNote = `语义精排跑过了，它认为这 ${fillCands.length} 条候选都不相关。`;
          }
        }
      } catch (err) {
        if (timedOut) {
          semantic = "timeout";
          semanticNote = `语义精排超时了（超过 ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} 秒` : `${timeoutMs} 毫秒`}），只按标签和已存的连线找。`;
        } else {
          semantic = "failed";
          const msg = (err as Error)?.message ?? String(err);
          semanticNote = `语义精排这一步没成（${msg}），只按标签和已存的连线找。`;
        }
      } finally {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onOuterAbort);
      }
    }
  }

  /* ---------- 第 3 段：混合排序（真命中在前，语义在后） ---------- */
  const byId = new Map(candidates.map((c) => [c.memory.id, c.memory]));
  const already = new Set(tagItems.map((i) => i.memory.id));
  const semItems: RecallItem<M>[] = picks
    .filter((p) => !already.has(p.id))
    .map((p) => ({
      memory: byId.get(p.id) as M,
      why: p.why ? `语义相关：${p.why}` : "语义相关（没给理由）",
      matchedBy: "semantic" as const,
    }))
    .filter((i) => Boolean(i.memory));

  const items = [...tagItems, ...semItems].slice(0, limit);

  /* ---------- 第 4 段：诚实 ---------- */
  const result: RecallResult<M> = {
    items,
    note: buildNote(items, semantic, semanticNote),
    semantic,
    semanticNote,
    candidates: candidates.length,
    fromCache: false,
  };

  if (useCache && items.length > 0) {
    cacheSet(key, result as unknown as RecallResult<RecallableMemory>);
  }
  return result;
}

/** 候选 → 发给模型的那一小段（`id + 一小段内容 + 标签`，**不塞全文**） */
function toRerankCandidates<M extends RecallableMemory>(cands: readonly RecallCandidate<M>[]): RerankCandidate[] {
  return cands.map((c) => ({
    id: c.memory.id,
    content: excerpt(c.memory.content, 80),
    tags: (c.memory.tags ?? []).map((t) => String(t)).slice(0, 6),
    kind: typeof c.memory.kind === "string" ? c.memory.kind : undefined,
  }));
}

/** 取一小段内容：一行、最多 `max` 个字符 */
export function excerpt(text: string, max = 80): string {
  const one = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return [...one].length > max ? `${[...one].slice(0, max).join("")}…` : one;
}

/** 模型给的"为什么相关"：去换行、限长（界面只有一行） */
function cleanWhy(why: unknown): string {
  const s = String(why ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return [...s].length > 40 ? `${[...s].slice(0, 40).join("")}…` : s;
}
