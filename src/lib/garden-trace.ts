/**
 * 踪迹：把"发生过的事"翻成一行一行的时间线。
 *
 * 为什么单独一个文件：
 *   · 花园里的记录（`lib/garden-catch`）只是原始数据；**怎么念出来**是另一件事；
 *   · 同一条记录要同时喂：踪迹页（一行）、感知层（"他刚才干了什么"）、以后动态的素材。
 *     三处用同一句措辞，才不会出现"聊天里说的和踪迹上写的对不上"。
 *
 * 现在只有池塘的记录（钓鱼/杂物）。等花圃、长椅、棋桌也记到这里时，
 * 只在 `traceOf` 里加一路来源就行 —— 页面不用改。
 */

import { findSpecies, JUNK_ITEMS, readCatches } from "@/lib/garden-catch";

export type TraceKind = "fish" | "junk";

export type TraceItem = {
  id: string;
  at: number;
  time: string;
  kind: TraceKind;
  /** 鱼种 / 杂物 id */
  ref: string;
  /** 一行话（踪迹上显示、感知层也读这句） */
  text: string;
};

function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 一条记录怎么说（唯一措辞出口） */
export function describeCatch(ref: string, kind: TraceKind, weight?: number, length?: number): string {
  if (kind === "fish") {
    const s = findSpecies(ref);
    if (!s) return "钓上来一条鱼";
    return `钓到一条${s.zh} · ${weight} g · ${length} cm`;
  }
  const j = JUNK_ITEMS.find((x) => x.id === ref)?.zh ?? "一样东西";
  return `钓上来${j}`;
}

/** 全部踪迹（新的在前） */
export function traceOf(): TraceItem[] {
  return readCatches()
    .slice()
    .sort((a, b) => b.at - a.at)
    .map((r) => ({
      id: r.id,
      at: r.at,
      time: hhmm(r.at),
      kind: r.kind,
      ref: r.ref,
      text: describeCatch(r.ref, r.kind, r.weight, r.length),
    }));
}

/** 最近 N 条（给感知层用） */
export function recentTrace(n = 3): TraceItem[] {
  return traceOf().slice(0, n);
}

/** 一天的分组键 */
export function dayKeyOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 分组小标题：今天 / 昨天 / N 月 N 日 */
export function dayTitle(key: string): string {
  const now = new Date();
  const today = dayKeyOf(now.getTime());
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (key === today) return "今天";
  if (key === dayKeyOf(yest.getTime())) return "昨天";
  const [, m, d] = key.split("-");
  return `${m} 月 ${d} 日`;
}
