/**
 * 踪迹：把"发生过的事"翻成一行一行的时间线。
 *
 * 为什么单独一个文件：
 *   · 花园里的记录（`lib/garden-catch`）只是原始数据；**怎么念出来**是另一件事；
 *   · 同一条记录要同时喂：踪迹页（一行）、感知层（"他刚才干了什么"）、以后动态的素材。
 *     三处用同一句措辞，才不会出现"聊天里说的和踪迹上写的对不上"。
 *
 * 现在两路：池塘（钓鱼/杂物）和花圃（种/浇/施肥/开花/剪/送）。
 * 再加来源只在 `traceOf` 里加一路 —— 页面不用改。
 */

import { findSpecies, JUNK_ITEMS, readCatches } from "@/lib/garden-catch";
import { findFlower, readLog } from "@/lib/garden-flowers";

/**
 * 记录的种类。
 * 两路来源：池塘（fish / junk）和花圃（plant 种下 / water 浇水 / feed 施肥 / bloom 开花 / pick 剪下 / gift 送出）。
 * 再加来源只动这里和 `traceOf`，踪迹页不用改。
 */
export type TraceKind = "fish" | "junk" | "plant" | "water" | "feed" | "bloom" | "pick" | "gift";

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

/** 花圃那一路：种下 / 浇水 / 施肥 / 开花 / 剪下 / 送出，都落成踪跡里的一行 */
function flowerTrace(): TraceItem[] {
  return readLog().map((l) => {
    const zh = findFlower(l.species)?.zh ?? "花";
    const text = (() => {
      switch (l.kind) {
        case "plant":
          return `在花圃种下${zh}`;
        case "water":
          return `给${zh}浇了水`;
        case "feed":
          return `给${zh}施了肥`;
        case "bloom":
          return `${zh}开了`;
        case "pick":
          return l.note ? `剪下${zh}：「${l.note}」` : `把${zh}剪下来了`;
        case "gift":
          return l.note ? `把一枝${zh}放在你门口：「${l.note}」` : `把一枝${zh}放在你门口`;
        default:
          return `花圃：${zh}`;
      }
    })();
    return {
      id: l.id,
      at: l.at,
      time: hhmm(l.at),
      kind: l.kind,
      ref: l.species,
      text,
    } satisfies TraceItem;
  });
}

/** 全部踪跡（新的在前） */
export function traceOf(): TraceItem[] {
  const catches: TraceItem[] = readCatches().map((r) => ({
    id: r.id,
    at: r.at,
    time: hhmm(r.at),
    kind: r.kind,
    ref: r.ref,
    text: describeCatch(r.ref, r.kind, r.weight, r.length),
  }));
  return [...catches, ...flowerTrace()].sort((a, b) => b.at - a.at);
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
