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
import { kvGetJSON, kvSetJSON } from "@/lib/data/local-kv";

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
  kind: TraceKind | "act";
  /** 鱼种 / 杂物 / 花 id（有就用它当图标） */
  ref: string;
  /** 一行话（踪迹上显示、感知层也读这句） */
  text: string;
  /** 他当时的心情（两三个字），只有新动作才带 */
  mood?: string;
  /** 他顺着这件事想说的话（一句短的） */
  line?: string;
  /** 图标：鱼 / 杂物 / 花 / 棋盘 / 水 / 星 / 花瓣 */
  icon?: "fish" | "junk" | "flower" | "board" | "water" | "star" | "petal";
};

/**
 * 一条"他做过的事"，带心情和一句话。
 *
 * 用户 m04355："有动作的都要记录，然后附上心情和想说的话，简单概括就行"。
 * 花园动作在执行时顺手写一条（见 `actions.ts` 的 `runAction` 包装），
 * 老的鱼获 / 花圃记录仍由下面两个适配器翻出来，两路在 `traceOf` 合并。
 */
export type Vestigium = {
  id: string;
  at: number;
  /** 动作 kind（garden.fish.reel 这种），图标和措辞都按它来 */
  kind: string;
  ref?: string;
  text: string;
  mood?: string;
  line?: string;
};

const VESTIGIA_KEY = "garden-vestigia";
const VESTIGIA_CAP = 400;
const VESTIGIA_EVENT = "garden-vestigia-changed";

export function readVestigia(): Vestigium[] {
  return kvGetJSON<Vestigium[]>(VESTIGIA_KEY, []);
}

/** 记一条：新的在最前面，最多留 400 条 */
export function appendVestigium(v: Omit<Vestigium, "id" | "at"> & { at?: number }): Vestigium {
  const at = v.at ?? Date.now();
  const rec: Vestigium = {
    id: `vg${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at,
    kind: v.kind,
    ref: v.ref,
    text: v.text,
    mood: v.mood?.trim() || undefined,
    line: v.line?.trim() || undefined,
  };
  kvSetJSON(VESTIGIA_KEY, [rec, ...readVestigia()].slice(0, VESTIGIA_CAP));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(VESTIGIA_EVENT));
  return rec;
}

export function subscribeVestigia(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const on = () => fn();
  window.addEventListener(VESTIGIA_EVENT, on);
  return () => window.removeEventListener(VESTIGIA_EVENT, on);
}

/** 动作 kind → 图标 */
function iconOf(kind: string): TraceItem["icon"] {
  if (kind.startsWith("garden.flower.")) return "flower";
  if (kind.startsWith("garden.gomoku.")) return "board";
  if (kind.startsWith("garden.fish.")) return "water";
  if (kind.startsWith("garden.tarot.")) return "star";
  if (kind === "garden.cesta.look") return "fish";
  return "petal";
}

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

/** 全部踪跡（新的在前）。新记录优先；老数据（鱼获 / 花圃）在还没有新记录时兜底 */
export function traceOf(): TraceItem[] {
  const rich: TraceItem[] = readVestigia().map((v) => ({
    id: v.id,
    at: v.at,
    time: hhmm(v.at),
    kind: "act",
    ref: v.ref ?? "",
    text: v.text,
    mood: v.mood,
    line: v.line,
    icon: iconOf(v.kind),
  }));
  if (rich.length > 0) return rich;

  const catches: TraceItem[] = readCatches().map((r) => ({
    id: r.id,
    at: r.at,
    time: hhmm(r.at),
    kind: r.kind,
    ref: r.ref,
    text: describeCatch(r.ref, r.kind, r.weight, r.length),
    icon: r.kind === "fish" ? "fish" : "junk",
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
  const [, mm, dd] = key.split("-");
  const md = `${Number(mm)} 月 ${Number(dd)} 日`;
  if (key === today) return `今天 · ${md}`;
  if (key === dayKeyOf(yest.getTime())) return `昨天 · ${md}`;
  return md;
}
