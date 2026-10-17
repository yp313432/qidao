/**
 * 池塘：鱼种、杂物、概率、记录。
 *
 * 为什么单独一个文件：
 *   · **同一条记录要喂三个地方** —— 踪迹（一行时间线）、竹篮（重量尺寸明细）、
 *     感知层（聊天里能答"你刚才在池塘干嘛"）。三处都读这一份，别各写各的；
 *   · 用户定的规矩（原话）："鱼的种类和重量也要有，要有对应的图片，不要写实的，
 *     卡通的就行，不一定吊起了鱼，还有垃圾，卡片之类其他的，总之是随机丰富的，
 *     可以写进踪迹里，然后更详细的比如重量，尺寸，种类放进背包里"；
 *   · "稀奇的还有介绍，平常的就一句话概括" → `tier` 分三档，`desc` 稀有写两三句、
 *     常见一句。**不做稀有度标签、不做收集率、不做图鉴进度**（他明确不要数值感）。
 *
 * 概率是"这一轮发生什么"，不是"钓鱼必定成功"：40% 没鱼、22% 有动静没咬实、
 * 12% 咬实跑掉、20% 上鱼、6% 上别的东西。护栏：同类事件不连发。
 *
 * 记录只存 localStorage（可重算的运行态，见 lib/data/local-kv 的规矩），
 * 上限 400 条，最近的在前。
 */

import { kvGetJSON, kvSetJSON } from "@/lib/data/local-kv";

/* ───────────────────── 鱼 ───────────────────── */

export type FishTier = "common" | "rare" | "rarest";

export type FishSpecies = {
  id: string;
  /** 中文名 */
  zh: string;
  /** 意大利语名（题字副行那种斜体） */
  la: string;
  tier: FishTier;
  /** 重量区间（克） */
  w: [number, number];
  /** 体长区间（厘米） */
  len: [number, number];
  /** 相对权重（同一档内按这个分） */
  weight: number;
  /** 介绍：常见一句、少见一两句、稀奇两三句 */
  desc: string;
};

export const FISH_SPECIES: FishSpecies[] = [
  // ── 常见（8 种，一句话）
  { id: "argento", zh: "银鳞鱼", la: "Argentino", tier: "common", w: [150, 420], len: [16, 27], weight: 24, desc: "太阳一照，身上像撒了层银粉。" },
  { id: "persico", zh: "斑纹鲈", la: "Persico", tier: "common", w: [260, 560], len: [20, 30], weight: 20, desc: "背上有几道深色横纹，脾气有点倔。" },
  { id: "ciprino", zh: "黄昏鲫", la: "Ciprino", tier: "common", w: [180, 340], len: [18, 24], weight: 18, desc: "傍晚才靠岸，白天躲得很深。" },
  { id: "alice", zh: "小银鱼", la: "Alice", tier: "common", w: [30, 90], len: [8, 13], weight: 13, desc: "一群一群地过，捞起来一把亮。" },
  { id: "ghiozzo", zh: "石头鳅", la: "Ghiozzo", tier: "common", w: [60, 140], len: [11, 16], weight: 10, desc: "贴着石头底走，嘴上有两根须。" },
  { id: "occhiata", zh: "青背鲷", la: "Occhiata", tier: "common", w: [280, 450], len: [20, 28], weight: 8, desc: "背是青的，翻过来像一小片玉。" },
  { id: "carice", zh: "芦叶鱼", la: "Carice", tier: "common", w: [80, 190], len: [15, 22], weight: 6, desc: "喜欢藏在芦苇根里，身子细长。" },
  { id: "muschio", zh: "苔斑鱼", la: "Muschio", tier: "common", w: [120, 260], len: [14, 19], weight: 4, desc: "浑身绿点，看着像块会游的石头。" },

  // ── 少见（4 种，一两句）
  {
    id: "lunare", zh: "月白鲤", la: "Carpa lunare", tier: "rare", w: [320, 520], len: [23, 28], weight: 40,
    desc: "鳞片泛着一层月白。它只在月亮很亮、水面很静的夜里浮上来，白天几乎见不到。",
  },
  {
    id: "bronzeo", zh: "铜环鲈", la: "Persico bronzeo", tier: "rare", w: [380, 620], len: [24, 31], weight: 30,
    desc: "鳃边有一圈铜色，越老的鱼这圈越深。渔人管这一圈叫「旧钱」。",
  },
  {
    id: "nero", zh: "黑羽鲫", la: "Ciprino nero", tier: "rare", w: [200, 380], len: [19, 26], weight: 20,
    desc: "通体墨黑，游动时像水里滑过一片影子 —— 看得见，抓不准。",
  },
  {
    id: "porcellana", zh: "白瓷鱼", la: "Porcellana", tier: "rare", w: [90, 180], len: [14, 20], weight: 10,
    desc: "白得几乎透明，捧在手里能看见自己的手指。阳光底下会有一点温润的光。",
  },

  // ── 稀奇（4 种，两三句）
  {
    id: "vetro", zh: "玻璃鳅", la: "Ghiozzo di vetro", tier: "rarest", w: [40, 90], len: [10, 14], weight: 40,
    desc: "身子是半透明的，能隐约看见里头一小团在动。它不太怕人，也不怎么挣扎，像是知道自己被看见也没关系。",
  },
  {
    id: "dorata", zh: "金瞳鲷", la: "Occhiata dorata", tier: "rarest", w: [300, 480], len: [22, 27], weight: 30,
    desc: "眼睛是琥珀色的，太阳正落的那一小会儿最亮，像水里钉着一粒金。错过了就得再等一天。",
  },
  {
    id: "barbiglio", zh: "四须鲶", la: "Barbiglio", tier: "rarest", w: [500, 900], len: [30, 40], weight: 20,
    desc: "四根须，比别的鱼多两根。老渔人说它能记住自己被放回去的次数 —— 放回去三次的鱼，之后就不咬钩了。",
  },
  {
    id: "centro", zh: "池心鲤", la: "Carpa del centro", tier: "rarest", w: [600, 1200], len: [32, 44], weight: 10,
    desc: "只在池子最中间那一小块水面上出现。从没有人见过它整条身子 —— 露出来的总只是一小截背，然后就没有了。",
  },
];

export const TIER_TITLE: Record<FishTier, string> = {
  common: "常见",
  rare: "少见",
  rarest: "稀奇",
};

export function findSpecies(id: string): FishSpecies | undefined {
  return FISH_SPECIES.find((s) => s.id === id);
}

/* ───────────────────── 别的东西 ───────────────────── */

export type JunkItem = { id: string; zh: string; la: string; sub: string; weight: number };

export const JUNK_ITEMS: JunkItem[] = [
  { id: "alga", zh: "水草", la: "Alga", sub: "一束", weight: 32 },
  { id: "tappo", zh: "旧瓶塞", la: "Tappo", sub: "软木", weight: 24 },
  { id: "granchio", zh: "小螃蟹", la: "Granchio", sub: "钳很大", weight: 20 },
  { id: "foglia", zh: "一片落叶", la: "Foglia", sub: "边缘卷了", weight: 14 },
  { id: "cartolina", zh: "漂来的卡片", la: "Cartolina", sub: "上面有字", weight: 10 },
];

/* ───────────────────── 一轮的结果 ───────────────────── */

/**
 * 一轮（20–60 秒）会发生什么。
 *
 * 概率总和 100。改数只有一个地方改 —— 别在页面里再写一遍。
 */
export const ROUND_RATE = {
  /** 没鱼：水面只是风 */
  none: 40,
  /** 有动静，没咬实 */
  nibble: 22,
  /** 咬实了，跑了 */
  escape: 12,
  /** 钓上来一条鱼 */
  fish: 20,
  /** 钓上来一样别的东西 */
  junk: 6,
} as const;

export type RoundOutcome =
  | { kind: "none" }
  | { kind: "nibble" }
  | { kind: "escape" }
  | { kind: "fish"; species: FishSpecies; weight: number; length: number; firstTime: boolean; record: boolean; prevBest: number }
  | { kind: "junk"; item: JunkItem };

function rnd(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

/** 按档内权重抽一条鱼 */
export function rollFish(): FishSpecies {
  const total = FISH_SPECIES.reduce((n, s) => n + s.weight, 0);
  let r = Math.random() * total;
  for (const s of FISH_SPECIES) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return FISH_SPECIES[0]!;
}

export function rollJunk(): JunkItem {
  const total = JUNK_ITEMS.reduce((n, s) => n + s.weight, 0);
  let r = Math.random() * total;
  for (const s of JUNK_ITEMS) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return JUNK_ITEMS[0]!;
}

/**
 * 摇一轮。
 *
 * `lastKind` 是上一轮的结果类型：**同类不连发**（连着四次"没鱼"会像卡住了），
 * 所以 none/nibble 撞上一次时就把它换成另一种。
 */
export function rollRound(lastKind?: RoundOutcome["kind"]): RoundOutcome {
  const r = Math.random() * 100;
  let kind: RoundOutcome["kind"];
  if (r < ROUND_RATE.none) kind = "none";
  else if (r < ROUND_RATE.none + ROUND_RATE.nibble) kind = "nibble";
  else if (r < ROUND_RATE.none + ROUND_RATE.nibble + ROUND_RATE.escape) kind = "escape";
  else if (r < ROUND_RATE.none + ROUND_RATE.nibble + ROUND_RATE.escape + ROUND_RATE.fish) kind = "fish";
  else kind = "junk";

  if ((kind === "none" || kind === "nibble") && lastKind === kind) {
    kind = kind === "none" ? "nibble" : "none";
  }
  if (kind === "fish") {
    const species = rollFish();
    const weight = rnd(species.w[0], species.w[1]);
    const length = rnd(species.len[0], species.len[1]);
    const best = bestWeightOf(species.id);
    return {
      kind,
      species,
      weight,
      length,
      firstTime: !hasCaught(species.id),
      record: best > 0 && weight > best,
      prevBest: best,
    };
  }
  if (kind === "junk") return { kind, item: rollJunk() };
  return { kind } as RoundOutcome;
}

/* ───────────────────── 记录（一份真源） ───────────────────── */

export type CatchRecord = {
  id: string;
  /** 钓上来的时刻 */
  at: number;
  kind: "fish" | "junk";
  /** 鱼种 id / 杂物 id */
  ref: string;
  /** 鱼才有 */
  weight?: number;
  length?: number;
  /** 当时他的心情（情绪事件里的主情绪原词，或日记心情） */
  mood?: string;
  /** 第一次钓到这个种类 */
  firstTime?: boolean;
  /** 破了这个种类的重量纪录 */
  record?: boolean;
  /** 破纪录前的最好成绩 */
  prevBest?: number;
};

const KEY = "garden-catches";
const MAX = 400;

export function readCatches(): CatchRecord[] {
  const list = kvGetJSON<CatchRecord[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

export function writeCatches(list: CatchRecord[]): void {
  kvSetJSON(KEY, list.slice(0, MAX));
}

export function hasCaught(speciesId: string): boolean {
  return readCatches().some((r) => r.kind === "fish" && r.ref === speciesId);
}

/** 这个种类到目前为止最重的一条（没有就 0） */
export function bestWeightOf(speciesId: string): number {
  return readCatches().reduce(
    (best, r) => (r.kind === "fish" && r.ref === speciesId && (r.weight ?? 0) > best ? r.weight! : best),
    0,
  );
}

/** 落一条记录（返回落好的那条） */
export function addCatch(input: Omit<CatchRecord, "id">): CatchRecord {
  const rec: CatchRecord = { ...input, id: `gc${input.at.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}` };
  const list = readCatches();
  list.unshift(rec);
  writeCatches(list);
  return rec;
}

/** 把一轮"上鱼 / 上别的东西"落成记录；`mood` 由页面传（lib 不读 store） */
export function recordOutcome(outcome: RoundOutcome, mood: string): CatchRecord | null {
  const at = Date.now();
  if (outcome.kind === "fish") {
    return addCatch({
      at,
      kind: "fish",
      ref: outcome.species.id,
      weight: outcome.weight,
      length: outcome.length,
      mood,
      firstTime: outcome.firstTime,
      record: outcome.record,
      prevBest: outcome.prevBest || undefined,
    });
  }
  if (outcome.kind === "junk") {
    return addCatch({ at, kind: "junk", ref: outcome.item.id, mood });
  }
  return null;
}

/* ───────────────────── 统计（竹篮 / 踪迹 / 感知都用） ───────────────────── */

export type GardenStats = {
  /** 一共多少条鱼 */
  fish: number;
  /** 一共多少件别的东西 */
  junk: number;
  /** 钓到过几个种类 */
  species: number;
  /** 最近一条（没有就 null） */
  latest: CatchRecord | null;
  /** 今天钓到几条 */
  todayFish: number;
};

export function gardenStats(now = new Date()): GardenStats {
  const list = readCatches();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const fishRecords = list.filter((r) => r.kind === "fish");
  return {
    fish: fishRecords.length,
    junk: list.filter((r) => r.kind === "junk").length,
    species: new Set(fishRecords.map((r) => r.ref)).size,
    latest: list[0] ?? null,
    todayFish: fishRecords.filter((r) => r.at >= start.getTime()).length,
  };
}

/** 竹篮列表：按种类归组（最近钓到过的种类在前），每组内新的在前 */
export type BasketGroup = { species: FishSpecies; rows: CatchRecord[] };

export function basketGroups(): BasketGroup[] {
  const list = readCatches()
    .filter((r) => r.kind === "fish")
    .slice()
    .sort((a, b) => b.at - a.at);
  const order: string[] = [];
  const map = new Map<string, CatchRecord[]>();
  for (const r of list) {
    if (!map.has(r.ref)) {
      map.set(r.ref, []);
      order.push(r.ref);
    }
    map.get(r.ref)!.push(r);
  }
  return order
    .map((id) => ({ species: findSpecies(id)!, rows: map.get(id)! }))
    .filter((g) => g.species);
}

/** 别的东西的计数（按出现次数从多到少） */
export function junkCounts(): { item: JunkItem; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of readCatches()) {
    if (r.kind === "junk") counts.set(r.ref, (counts.get(r.ref) ?? 0) + 1);
  }
  return JUNK_ITEMS.map((item) => ({ item, count: counts.get(item.id) ?? 0 })).sort((a, b) => b.count - a.count);
}

/* ───────────────────── 文案 ───────────────────── */

/** 竹篮页的页脚一句话（他今天放进来的） */
export function basketFooter(now = new Date()): string {
  const latest = gardenStats(now).latest;
  if (!latest) return "竹篮还是空的 —— 去池塘边看看他在做什么";
  const k =
    latest.kind === "fish"
      ? findSpecies(latest.ref)?.zh ?? "一条鱼"
      : JUNK_ITEMS.find((j) => j.id === latest.ref)?.zh ?? "一样东西";
  return `他最近放进来的是 ${k}`;
}

/** 心情兜底：没有情绪事件时用这个 */
export const DEFAULT_MOOD = "平静";
