/**
 * 塔罗牌：一副真的 78 张韦特体系牌，加上抽牌/牌阵规则。
 *
 * 用户 m06018 的原话："是真正的塔罗牌，我写上想问的，他按照顺序抽卡占卜，
 * 卡牌随机选……最后还有牌面解读"，并且"卡牌也要这种意式罗马风格"。
 *
 * 所以这里只放**数据和规则**（谁在第几位、正逆位怎么定），画在
 * `components/play/tarot-card-svg.tsx` 里；解读由他（模型）来写。
 *
 * 规则照真塔罗：
 *   · 78 张 = 22 大阿卡纳 + 56 小阿卡纳（权杖/圣杯/宝剑/星币，各 1–10 + 侍从/骑士/王后/国王）
 *   · 洗牌后不放回地抽，抽过的不会再出现
 *   · 每张独立约 1/3 概率逆位（现实里是洗牌时翻过来的，这里等价成随机）
 *   · 三张阵＝过去 / 现在 / 未来，位置含义固定，不因为问题而改
 */

export type Arcana = "major" | "wands" | "cups" | "swords" | "pentacles";

export type TarotCard = {
  id: string;
  arcana: Arcana;
  /** 大阿卡纳：0–21；小阿卡纳：1–14（11 侍从 … 14 国王） */
  rank: number;
  zh: string;
  it: string;
  /** 正位关键词（给他的解读提示，也显示在牌下面） */
  up: string;
  /** 逆位关键词 */
  down: string;
};

type MajorSpec = [number, string, string, string, string];

/** 22 张大阿卡纳：编号、意大利语、中文、正位、逆位 */
const MAJORS: MajorSpec[] = [
  [0, "Il Matto", "愚者", "出发、自由、不确定的开始", "轻率、逃避、没有方向"],
  [1, "Il Bagatto", "魔术师", "动手、把想法变成现实", "空谈、使不上劲"],
  [2, "La Papessa", "女祭司", "直觉、还没说出口的东西", "自我怀疑、忽略直觉"],
  [3, "L'Imperatrice", "皇后", "丰盛、被照顾、生长", "过度付出、停滞"],
  [4, "L'Imperatore", "皇帝", "秩序、边界、承担责任", "控制、僵化"],
  [5, "Il Papa", "教皇", "传统、指引、有人教", "规则不合身、想自己来"],
  [6, "Gli Amanti", "恋人", "选择、互相看见", "犹豫、价值不合"],
  [7, "Il Carro", "战车", "往前推、掌控方向", "失控、硬撑"],
  [8, "La Forza", "力量", "温柔的坚持、驯服冲动", "用尽力气、心虚"],
  [9, "L'Eremita", "隐士", "独处、往里看", "躲起来、怕见人"],
  [10, "La Ruota", "命运之轮", "转折、时机来了", "卡住、循环"],
  [11, "La Giustizia", "正义", "衡量、因果、把话说清", "失衡、逃避责任"],
  [12, "L'Appeso", "倒吊人", "停一停、换个角度", "白等、不肯动"],
  [13, "La Morte", "死神", "结束、切断、腾出位置", "拖着的结束、不肯放手"],
  [14, "La Temperanza", "节制", "调和、慢慢来", "过火、节奏乱了"],
  [15, "Il Diavolo", "恶魔", "绑住你的东西、欲望", "松绑、看清了"],
  [16, "La Torre", "塔", "突然的崩、藏不住的事", "小崩、还在拖"],
  [17, "Le Stelle", "星星", "希望、被照亮", "失望、光很弱"],
  [18, "La Luna", "月亮", "看不清、情绪的水", "雾散、真相露头"],
  [19, "Il Sole", "太阳", "明亮、被肯定", "光被挡住、迟到的开心"],
  [20, "Il Giudizio", "审判", "醒来、重新决定", "装睡、不肯承认"],
  [21, "Il Mondo", "世界", "收尾、圆满了", "差一步、没闭合"],
];

/** 四组花色：意大利语、中文、正位、逆位（小阿卡纳共用） */
const SUITS: { key: Exclude<Arcana, "major">; it: string; zh: string; up: string; down: string }[] = [
  { key: "wands", it: "Bastoni", zh: "权杖", up: "行动与热情", down: "使不上劲" },
  { key: "cups", it: "Coppe", zh: "圣杯", up: "情感与关系", down: "情绪堵住" },
  { key: "swords", it: "Spade", zh: "宝剑", up: "想法与争执", down: "想太多" },
  { key: "pentacles", it: "Denari", zh: "星币", up: "现实与身体", down: "落不到地" },
];

/** 小阿卡纳的点数名（1–10 与四张宫牌） */
const RANKS: { rank: number; it: string; zh: string; note: string }[] = [
  { rank: 1, it: "Asso", zh: "一", note: "开头" },
  { rank: 2, it: "Due", zh: "二", note: "两边" },
  { rank: 3, it: "Tre", zh: "三", note: "成形" },
  { rank: 4, it: "Quattro", zh: "四", note: "稳住" },
  { rank: 5, it: "Cinque", zh: "五", note: "失衡" },
  { rank: 6, it: "Sei", zh: "六", note: "和缓" },
  { rank: 7, it: "Sette", zh: "七", note: "取舍" },
  { rank: 8, it: "Otto", zh: "八", note: "推进" },
  { rank: 9, it: "Nove", zh: "九", note: "快到顶" },
  { rank: 10, it: "Dieci", zh: "十", note: "满" },
  { rank: 11, it: "Fante", zh: "侍从", note: "试探" },
  { rank: 12, it: "Cavallo", zh: "骑士", note: "冲" },
  { rank: 13, it: "Regina", zh: "王后", note: "包容" },
  { rank: 14, it: "Re", zh: "国王", note: "掌握" },
];

export const TAROT_DECK: readonly TarotCard[] = [
  ...MAJORS.map<TarotCard>(([rank, it, zh, up, down]) => ({
    id: `m${rank}`,
    arcana: "major",
    rank,
    zh,
    it,
    up,
    down,
  })),
  ...SUITS.flatMap((suit) =>
    RANKS.map<TarotCard>((r) => ({
      id: `${suit.key}${r.rank}`,
      arcana: suit.key,
      rank: r.rank,
      zh: `${suit.zh}${r.zh}`,
      it: `${r.rank === 1 ? "Asso" : r.it} di ${suit.it}`,
      up: `${suit.up} · ${r.note}`,
      down: `${suit.down} · ${r.note}`,
    })),
  ),
];

/** 一张牌 + 正逆位 */
export type DrawnCard = { card: TarotCard; reversed: boolean };

export type SpreadId = "one" | "three";

export type Spread = {
  id: SpreadId;
  zh: string;
  it: string;
  /** 每个位置的说明（下标 = 抽牌顺序） */
  positions: string[];
  /** 一句话解释这个牌阵在问什么 */
  note: string;
};

export const SPREADS: Spread[] = [
  {
    id: "one",
    zh: "单张",
    it: "Una carta",
    positions: ["此刻"],
    note: "只问一件事，只抽一张：现在最该看见的那张。",
  },
  {
    id: "three",
    zh: "三张",
    it: "Tre carte",
    positions: ["过去", "现在", "未来"],
    note: "过去–现在–未来：事情从哪儿来、现在卡在哪、会往哪走。",
  },
];

export function spreadOf(id: SpreadId): Spread {
  return SPREADS.find((s) => s.id === id) ?? SPREADS[0]!;
}

/** 洗一副牌（Fisher–Yates），返回整副的随机顺序 */
export function shuffleDeck(rng: () => number = Math.random): TarotCard[] {
  const deck = [...TAROT_DECK];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

/**
 * 洗牌并按顺序抽 `count` 张（不放回），每张独立定正逆位。
 *
 * 逆位概率取 1/3：现实里逆位来自"洗牌时牌翻过来了"，大体三成左右；
 * 全随机 50% 会有太多逆位，读起来像在吓人。
 */
export function drawCards(count: number, rng: () => number = Math.random): DrawnCard[] {
  const deck = shuffleDeck(rng);
  return deck.slice(0, count).map((card) => ({ card, reversed: rng() < 1 / 3 }));
}

/** 罗马数字（大阿卡纳的编号；0 显示成 0） */
export function romanOf(n: number): string {
  const table: [number, string][] = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  if (n === 0) return "0";
  let left = n;
  let out = "";
  for (const [v, sym] of table) {
    while (left >= v) {
      out += sym;
      left -= v;
    }
  }
  return out;
}

/** 牌面标题：`愚者 · Il Matto`，逆位时加一句 */
export function cardTitle(drawn: DrawnCard): string {
  return `${drawn.card.zh} · ${drawn.card.it}${drawn.reversed ? "（逆位）" : ""}`;
}

/** 给他看的一行牌义：位置 + 牌名 + 正逆位关键词 */
export function describeDraw(positions: string[], drawn: DrawnCard[]): string {
  return drawn
    .map((d, i) => {
      const pos = positions[i] ?? `第 ${i + 1} 张`;
      const face = d.reversed ? "逆位" : "正位";
      return `${pos}：${d.card.zh}（${d.card.it}）${face} —— ${d.reversed ? d.card.down : d.card.up}`;
    })
    .join("\n");
}
