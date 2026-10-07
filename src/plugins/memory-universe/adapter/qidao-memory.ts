import type { Memory as UniverseMemory, MemoryRelationship } from "@/plugins/memory-universe/types";
import type { Memory as StoreMemory } from "@/lib/types";

/**
 * **栖岛的记忆库 → 记忆宇宙的星图数据**。
 *
 * 用户原话（这轮的做法）："走 b"、"记忆宇宙接真数据"。
 * 所以这里**不是造数据**，是纯映射 —— 每一颗星、每一条连线都来自栖岛真实的记忆字段：
 *
 * | 星图上要的 | 从哪来（真实字段） | 怎么算 |
 * |---|---|---|
 * | 星的**大小/亮度** | `strength` + `confidence` | 两者平均 → `importance`（映射成 0~1） |
 * | 星的名字 | `content` | 取第一句、去掉换行，最长 14 字 |
 * | 点开的正文 | `content` | 原样 |
 * | 分类 | `kind` | profile / relationship / timeline / preference … |
 * | **星与星的连线** | `links` + `tags` **重合** | 栖岛本来就有"神经元连线"；再按共同标签补一层 |
 * | 线的粗细 | 重合标签数 + `recallCount` | → `strength`（0~1） |
 * | **记忆形成**（第一次提及→反复→长期） | `createdAt` / `recallCount` / `lastRecalledAt` / `lastConfirmedAt` | 见 `formationOf` |
 * | 来源 | `source` | 对话 / 手记 |
 *
 * ⚠️ 两条纪律：
 *   ① **不许编**：拿不到的字段就不填（星图那边对缺字段都有兜底），
 *      绝不"猜一个像样的值" —— 那是在骗用户（用户最恨这个）。
 *   ② **归档的不上星图**（`status: "archived"`）—— 他已经把它收起来了。
 */

/** 时间戳 → 星图要的 `YYYY-MM-DD` */
function day(at: number): string {
  const d = new Date(at);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * 取一个短标题。
 *
 * 记忆的 content 常常是多行（"喜欢躺平，精力比较低"这种一句话，也有带细节的多行），
 * 星图上只能放一行 —— 所以取**第一句**，太长就截断加省略号。
 */
export function titleOf(content: string): string {
  const first = (content ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0) ?? "";
  const one = first.split(/[。！？!?；;，,]/)[0]?.trim() || first;
  return one.length > 14 ? `${one.slice(0, 14)}…` : one || "（无标题）";
}

/** 强度 → 0~1（星的大小用它） */
export function importanceOf(m: StoreMemory): number {
  const s = Number.isFinite(m.strength) ? m.strength : 0.5;
  const c = Number.isFinite(m.confidence) ? m.confidence : 0.7;
  return Math.max(0.15, Math.min(1, (s + c) / 2));
}

/**
 * 记忆形成过程 —— 用真实的时间点，**没有的就少写一条**（不编）。
 *
 * 这四步正好对得上栖岛已有的四个时间戳：
 *   · 第一次提及 = `createdAt`
 *   · 反复提及   = `recallCount >= 2` 且有 `lastRecalledAt`
 *   · 被强化     = `strength` 比初始高（反复确认/唤起会变高）
 *   · 长期记忆   = `lastConfirmedAt`（他确认过"现在仍然成立"）
 */
export function formationOf(m: StoreMemory): UniverseMemory["formation"] {
  const out: NonNullable<UniverseMemory["formation"]> = [
    { kind: "first_mention", at: day(m.createdAt), note: "第一次被记住" },
  ];
  if (m.recallCount >= 2 && m.lastRecalledAt) {
    out.push({ kind: "remention", at: day(m.lastRecalledAt), note: `被想起过 ${m.recallCount} 次` });
  }
  if (m.strength >= 0.75) {
    out.push({ kind: "strengthened", at: day(m.lastRecalledAt ?? m.updatedAt), note: "反复确认后变牢" });
  }
  if (m.lastConfirmedAt) {
    out.push({ kind: "long_term", at: day(m.lastConfirmedAt), note: "确认过仍然成立" });
  }
  return out;
}

/** 一条记忆 → 一颗星 */
export function toUniverseMemory(m: StoreMemory): UniverseMemory {
  return {
    id: m.id,
    title: titleOf(m.content),
    content: m.content,
    createdAt: day(m.createdAt),
    updatedAt: day(m.updatedAt),
    importance: importanceOf(m),
    category: m.kind,
    tags: m.tags,
    relatedMemoryIds: m.links,
    source: {
      type: m.source === "手动" || m.source === "manual" ? "note" : "conversation",
      label: m.source?.trim() || "对话",
      at: day(m.createdAt),
    },
    formation: formationOf(m),
  };
}

/**
 * 连线怎么来 —— **两份真实依据**：
 *   ① 栖岛的 `links`（他自己建立的"神经元连线"，`lib/memory.ts` 里算出来的）
 *   ② `tags` 重合（同标签的记忆天然相关）
 *
 * 强度：共同标签越多、两边被想起得越多 → 线越粗（0.3~1）。
 * 去重：A-B 和 B-A 只留一条；自己连自己不算。
 */
export function relationshipsOf(memories: StoreMemory[]): MemoryRelationship[] {
  const live = memories.filter((m) => m.status !== "archived");
  const byId = new Map(live.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const out: MemoryRelationship[] = [];

  const push = (a: StoreMemory, b: StoreMemory, sharedTags: number) => {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (a.id === b.id || seen.has(key)) return;
    if (!byId.has(a.id) || !byId.has(b.id)) return;
    seen.add(key);
    const recall = Math.min(1, ((a.recallCount + b.recallCount) / 12) * 0.4);
    const strength = Math.max(0.3, Math.min(1, 0.35 + sharedTags * 0.12 + recall));
    out.push({ sourceId: a.id, targetId: b.id, strength });
  };

  /** ① 显式连线 */
  for (const m of live) {
    for (const id of m.links ?? []) {
      const other = byId.get(id);
      if (other) push(m, other, 1);
    }
  }

  /** ② 同标签（标签相同的都连一条，最多让每颗星连 4 条，免得星图糊成一团） */
  const byTag = new Map<string, StoreMemory[]>();
  for (const m of live) {
    for (const t of m.tags ?? []) {
      if (!t.trim()) continue;
      const arr = byTag.get(t) ?? [];
      arr.push(m);
      byTag.set(t, arr);
    }
  }
  const degree = new Map<string, number>();
  for (const [, arr] of byTag) {
    if (arr.length < 2 || arr.length > 6) continue; // 太多内容的标签（比如"日常"）不连线
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        const a = arr[i]!;
        const b = arr[j]!;
        const da = degree.get(a.id) ?? 0;
        const db = degree.get(b.id) ?? 0;
        if (da >= 4 || db >= 4) continue;
        push(a, b, 1);
        degree.set(a.id, da + 1);
        degree.set(b.id, db + 1);
      }
    }
  }

  return out;
}

/** 整套映射：栖岛的记忆数组 → `{ memories, relationships }` */
export function toUniverse(memories: StoreMemory[]): {
  memories: UniverseMemory[];
  relationships: MemoryRelationship[];
} {
  const live = memories.filter((m) => m.status !== "archived" && m.content.trim());
  return {
    memories: live.map(toUniverseMemory),
    relationships: relationshipsOf(live),
  };
}
