/**
 * 花圃：一片真的花园（新底图上一朵一朵长着的），加上"他替你打理"的那套记录。
 *
 * 2026-10 用户定的规矩（m03832 / m03954 / m04033 / m04036）：
 *   · 花圃是**看**的地方：花长在画里，花名像花园主页那样融进画面，点一朵才浮出介绍；
 *   · 种、浇水、施肥、剪，这些活儿**归他干，而且是真的动作**（`garden.flower.*`，见 actions.ts）；
 *   · 干过的活**记到踪跡里**，跟钓鱼记录一样的写法；
 *   · 背包里只放两种东西：**种子** 和 **采摘下来的花**（每枝带他剪时说的那句话）；
 *   · 稀有的花有介绍（花语 / 来历）；送花看他心情，送了必写一句，收到时走 app 级动画。
 *
 * 数据都在本地（`lib/data/local-kv`）：这是可重算的运行态，不进备份里的"资料"。
 */

import { kvGetJSON, kvKey, kvSetJSON } from "@/lib/data/local-kv";

export type FlowerRarity = 1 | 2 | 3 | 4 | 5;

export type FlowerSpecies = {
  id: string;
  zh: string;
  it: string;
  /** 花语，一句话 */
  word: string;
  /** 稀有度（星星） */
  rarity: FlowerRarity;
  /** 稀有花的来历；普通花留空 */
  lore?: string;
};

/**
 * 花圃画面上那六种花 + 一种稀有。
 *
 * ⚠️ 顺序/坐标是**画面上的位置**（见 `FLOWER_SPOTS`），改底图就要一起改。
 */
export const FLOWER_SPECIES: FlowerSpecies[] = [
  {
    id: "rosa",
    zh: "玫瑰",
    it: "Rosa",
    word: "开的时候不解释，谢的时候也不",
    rarity: 2,
  },
  {
    id: "giglio",
    zh: "百合",
    it: "Giglio",
    word: "不必说话也算说清了",
    rarity: 3,
  },
  {
    id: "margherita",
    zh: "雏菊",
    it: "Margherita",
    word: "最好活，给点水就笑",
    rarity: 1,
  },
  {
    id: "ortensia",
    zh: "绣球",
    it: "Ortensia",
    word: "这片蓝是土里自己变的，我没动过",
    rarity: 2,
  },
  {
    id: "glicine",
    zh: "紫藤",
    it: "Glicine",
    word: "要爬，开的时候一垂一垂的",
    rarity: 3,
  },
  {
    id: "lavanda",
    zh: "薰衣草",
    it: "Lavanda",
    word: "风一过就有味道",
    rarity: 2,
  },
  {
    id: "rosa-lunare",
    zh: "月白玫瑰",
    it: "Rosa Lunare",
    word: "在没人看的时候也照旧开着",
    rarity: 5,
    lore: "只在雨后第二天的清晨开。花瓣近白，晒过太阳会泛一点极淡的紫。花园西南角是它自己长出来的——没人种。",
  },
];

export function findFlower(id: string): FlowerSpecies | undefined {
  return FLOWER_SPECIES.find((f) => f.id === id);
}

/**
 * 从一句随口的话里认出是哪一种花（"玫瑰"/"rosa"/"那株白百合"都能认）。
 * 认不出来就返回 undefined —— 别猜，让他自己说清楚。
 */
export function filterFlowerByHint(hint: string): FlowerSpecies | undefined {
  const q = (hint ?? "").trim().toLowerCase();
  if (!q) return undefined;
  return (
    FLOWER_SPECIES.find((f) => f.id === q || f.zh === hint.trim() || f.it.toLowerCase() === q) ??
    FLOWER_SPECIES.find((f) => f.zh.includes(hint.trim()) || q.includes(f.id) || q.includes(f.zh))
  );
}

/**
 * 花名摆在画面的哪儿（390×844 的画布坐标，百分比）。
 * 值是 "left% top%"，跟花园主页 `.garden-spot` 的 translate(-50%,-50%) 对齐。
 */
export const FLOWER_SPOTS: Record<string, { x: number; y: number }> = {
  rosa: { x: 20, y: 66 },
  giglio: { x: 71, y: 46 },
  margherita: { x: 76, y: 86 },
  ortensia: { x: 39, y: 32 },
  glicine: { x: 77, y: 18 },
  lavanda: { x: 44, y: 54 },
};

/** 稀有花不开在花圃的地里，是"某天自己冒出来的" */
export const RARE_BLOOM_CHANCE = 0.06;

const KEY_BEDS = "garden-flower-beds";
const KEY_LOG = "garden-flower-log";
const KEY_BASKET = "garden-flower-basket";
const KEY_GIFTS = "garden-flower-gifts";
const KEY_SEEDS = "garden-flower-seeds";

/** 一块地里长着的东西；没有就是空着 */
export type FlowerBed = {
  species: string;
  plantedAt: number;
  /** 浇过几次水 + 施过几次肥 */
  care: number;
  bloomedAt?: number;
};

export type FlowerLogKind = "plant" | "water" | "feed" | "bloom" | "pick" | "gift";

/** 踪跡读的就是这个：每一次"他干了什么" */
export type FlowerLog = {
  id: string;
  at: number;
  kind: FlowerLogKind;
  species: string;
  /** 他剪/送时说的那句话 */
  note?: string;
};

/** 背包里的一枝（采摘下来的） */
export type PickedFlower = {
  id: string;
  species: string;
  at: number;
  note?: string;
};

/** 送过来的花：跟信一个待遇，一进 app 就要弹 */
export type FlowerGift = {
  id: string;
  species: string;
  at: number;
  note: string;
  seen: boolean;
};

const FLOWER_EVENT = "garden-flowers-changed";

/** 改完花圃之后喊一声，页面 / 角标 / 收花动画都跟着刷新 */
export function notifyFlowers(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FLOWER_EVENT));
}

export function subscribeFlowers(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(FLOWER_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(FLOWER_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function uid(prefix: string, at: number): string {
  return `${prefix}${at.toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
}

/* ---------------- 读 ---------------- */

export function readBeds(): Record<string, FlowerBed> {
  return kvGetJSON<Record<string, FlowerBed>>(KEY_BEDS, {});
}

export function bedOf(species: string): FlowerBed | undefined {
  return readBeds()[species];
}

export function readSeeds(): Record<string, number> {
  return kvGetJSON<Record<string, number>>(KEY_SEEDS, defaultSeeds());
}

export function readLog(): FlowerLog[] {
  return kvGetJSON<FlowerLog[]>(KEY_LOG, []);
}

export function readBasket(): PickedFlower[] {
  return kvGetJSON<PickedFlower[]>(KEY_BASKET, []);
}

export function readGifts(): FlowerGift[] {
  return kvGetJSON<FlowerGift[]>(KEY_GIFTS, []);
}

/** 还没拆的那一枝（收花动画用；新的优先） */
export function pendingGift(): FlowerGift | undefined {
  return readGifts().filter((g) => !g.seen).sort((a, b) => b.at - a.at)[0];
}

/** 开局给的几包种子（用户 m03954："种子初始几包，剩下的在寻物里加随机事件"） */
function defaultSeeds(): Record<string, number> {
  return { rosa: 3, margherita: 3, ortensia: 2, giglio: 2, lavanda: 2, glicine: 1 };
}

/* ---------------- 写 ---------------- */

function pushLog(kind: FlowerLogKind, species: string, at: number, note?: string): void {
  const log = readLog();
  log.push({ id: uid("fl", at), at, kind, species, note });
  kvSetJSON(KEY_LOG, log.slice(-400));
}

export type FlowerResult = { ok: boolean; why?: string; bloomed?: boolean };

/** 种下一株（种子 -1，地里记一条） */
export function plantFlower(species: string, at = Date.now()): FlowerResult {
  const f = findFlower(species);
  if (!f) return { ok: false, why: `没有叫「${species}」的花` };
  const beds = readBeds();
  if (beds[species]) return { ok: false, why: `${f.zh}那儿已经长着了` };
  const seeds = readSeeds();
  if ((seeds[species] ?? 0) <= 0) return { ok: false, why: `没有${f.zh}的种子了` };
  seeds[species] = (seeds[species] ?? 0) - 1;
  beds[species] = { species, plantedAt: at, care: 0 };
  kvSetJSON(KEY_SEEDS, seeds);
  kvSetJSON(KEY_BEDS, beds);
  pushLog("plant", species, at);
  notifyFlowers();
  return { ok: true };
}

/** 浇水 / 施肥：两次照料就开（用户只看结果，阈值不露给他） */
function careFor(species: string, kind: "water" | "feed", at: number): FlowerResult {
  const f = findFlower(species);
  if (!f) return { ok: false, why: `没有叫「${species}」的花` };
  const beds = readBeds();
  const bed = beds[species];
  if (!bed) return { ok: false, why: `${f.zh}还没种下去` };
  bed.care += 1;
  let bloomed = false;
  pushLog(kind, species, at);
  if (!bed.bloomedAt && bed.care >= 2) {
    bed.bloomedAt = at;
    bloomed = true;
    pushLog("bloom", species, at);
  }
  kvSetJSON(KEY_BEDS, beds);
  notifyFlowers();
  return { ok: true, bloomed };
}

export function waterFlower(species: string, at = Date.now()): FlowerResult {
  return careFor(species, "water", at);
}

export function feedFlower(species: string, at = Date.now()): FlowerResult {
  return careFor(species, "feed", at);
}

/** 剪下来，收进背包 */
export function pickFlower(species: string, note?: string, at = Date.now()): FlowerResult & { item?: PickedFlower } {
  const f = findFlower(species);
  if (!f) return { ok: false, why: `没有叫「${species}」的花` };
  const beds = readBeds();
  const bed = beds[species];
  if (species === "rosa-lunare") {
    // 稀有花不是种出来的：剪一次少一次，不占地
    const basket = readBasket();
    const item: PickedFlower = { id: uid("pf", at), species, at, note };
    basket.push(item);
    kvSetJSON(KEY_BASKET, basket);
    pushLog("pick", species, at, note);
    notifyFlowers();
    return { ok: true, item };
  }
  if (!bed) return { ok: false, why: `${f.zh}还没种下去` };
  if (!bed.bloomedAt) return { ok: false, why: `${f.zh}还没开，剪了也留不住` };
  const basket = readBasket();
  const item: PickedFlower = { id: uid("pf", at), species, at, note };
  basket.push(item);
  kvSetJSON(KEY_BASKET, basket);
  delete beds[species];
  kvSetJSON(KEY_BEDS, beds);
  pushLog("pick", species, at, note);
  notifyFlowers();
  return { ok: true, item };
}

/** 送一枝过来（会弹收花动画；必须有话） */
export function giftFlower(species: string, note: string, at = Date.now()): FlowerResult & { gift?: FlowerGift } {
  const f = findFlower(species);
  if (!f) return { ok: false, why: `没有叫「${species}」的花` };
  const said = note.trim();
  if (!said) return { ok: false, why: "送花要写一句话" };
  const gifts = readGifts();
  const gift: FlowerGift = { id: uid("gf", at), species, at, note: said, seen: false };
  gifts.push(gift);
  kvSetJSON(KEY_GIFTS, gifts.slice(-60));
  pushLog("gift", species, at, said);
  notifyFlowers();
  return { ok: true, gift };
}

/** 收下了（关掉动画才算） */
export function markGiftSeen(id: string): void {
  const gifts = readGifts().map((g) => (g.id === id ? { ...g, seen: true } : g));
  kvSetJSON(KEY_GIFTS, gifts);
  notifyFlowers();
}

/** 收下那一枝：进背包（带着他那句话），同时标记已拆 */
export function acceptGift(id: string, at = Date.now()): PickedFlower | undefined {
  const gifts = readGifts();
  const gift = gifts.find((g) => g.id === id);
  if (!gift) return undefined;
  markGiftSeen(id);
  const basket = readBasket();
  const item: PickedFlower = { id: uid("pf", at), species: gift.species, at: gift.at, note: gift.note };
  basket.push(item);
  kvSetJSON(KEY_BASKET, basket);
  notifyFlowers();
  return item;
}

/** 稀有的那枝"某天自己冒出来"——他浇完水顺手看一眼 */
export function maybeSpawnRare(at = Date.now(), roll = Math.random()): boolean {
  const beds = readBeds();
  if (beds["rosa-lunare"]) return false;
  if (roll > RARE_BLOOM_CHANCE) return false;
  beds["rosa-lunare"] = { species: "rosa-lunare", plantedAt: at, care: 2, bloomedAt: at };
  kvSetJSON(KEY_BEDS, beds);
  pushLog("bloom", "rosa-lunare", at);
  notifyFlowers();
  return true;
}

/* ---------------- 汇总（给感知层 / 页面角标用） ---------------- */

export type FlowerStats = {
  planted: number;
  bloomed: number;
  todayWatered: number;
  basket: number;
  seeds: number;
  latest?: { at: number; species: string };
};

export function flowerStats(now = Date.now()): FlowerStats {
  const beds = Object.values(readBeds());
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const log = readLog();
  const basket = readBasket();
  const seeds = readSeeds();
  return {
    planted: beds.length,
    bloomed: beds.filter((b) => b.bloomedAt).length,
    todayWatered: log.filter((l) => (l.kind === "water" || l.kind === "feed") && l.at >= start.getTime()).length,
    basket: basket.length,
    seeds: Object.values(seeds).reduce((n, v) => n + v, 0),
    latest: basket.length ? basket[basket.length - 1] : undefined,
  };
}

/** 花圃那一句人话（踪跡/感知共用） */
export function flowerSummary(): string {
  const s = flowerStats();
  if (s.planted === 0) return "花圃还空着";
  const names = Object.values(readBeds()).map((b) => {
    const f = findFlower(b.species);
    return `${f?.zh ?? "花"}${b.bloomedAt ? "（开着）" : ""}`;
  });
  return `花圃里长着 ${names.join("、")}；背包里收着 ${s.basket} 枝`;
}

/** 存在哪几个键里（备份 / 清理时要用） */
export const FLOWER_KEYS = [KEY_BEDS, KEY_LOG, KEY_BASKET, KEY_GIFTS, KEY_SEEDS].map((k) => kvKey(k));
