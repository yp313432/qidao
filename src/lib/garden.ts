/**
 * 花园地图的**唯一配置**：底图 + 地点落位 + 踪迹。
 *
 * 为什么单独一个文件：
 *   · 用户明确说了"后续留个口子换底图" —— 换图只要覆盖 `public/garden/base.jpg`
 *     （建议 9:16，780×1688 或更大），**坐标不用动**；
 *   · 如果换的新图构图不一样、地点对不上，只改下面这张表里的 x / y（画面百分比，
 *     左上角是 0,0），界面一行都不用碰；
 *   · 现在只有「棋桌」有 to（能点进去下五子棋）。小屋 / 拱廊 / 花圃 / 池塘
 *     是地图上已经画出来的房间，还没建，所以**留空当装饰**——不做点了没反应的假入口。
 *
 * 视觉规矩（用户定的意式罗马浪漫风格）：
 *   地名是"印在画上的题字"（象牙白 + 一道极细深边），不是胶囊、不是角标；
 *   毛玻璃只留给交互层。字色/描边在 styles.css 的 `.garden-spot` 里。
 */

/** 底图（`public/garden/base.jpg`）。换图就是换这个文件，代码不用改。 */
export const GARDEN_BASE = "/garden/base.jpg";

/**
 * 池塘专用的水面底图（`public/garden/pond-b.jpg`，928×1664）。
 *
 * 为什么单独一张：用户 m01839 看预览时选了 B（石栏爬玫瑰 + 柏树 + 木栈桥那版），
 * 说"池塘风格单独一张"比把花园图右下角推近当水面好。
 * 换图同样是换文件就行；水面的范围在 `components/play/pond-life.tsx` 的 `WATER` 里改。
 */
export const GARDEN_POND = "/garden/pond-b.jpg";

export type GardenSpot = {
  id: string;
  /** 中文名（题字主行） */
  zh: string;
  /** 意大利语（题字副行，斜体） */
  la: string;
  /** 题字中心点：画面百分比（防止不同机型缩放后跑位） */
  x: number;
  y: number;
  /** 有 to 才是能点的房间；留着空 = 地图上的装饰 */
  to?: "/play/garden/qi" | "/play/garden/stagno" | "/play/garden/tavolo" | "/play/garden/fiori";
};

/**
 * 五个房间在**这张粉色海景别墅图**上的落位。
 *
 * 映射（按画面内容，不是按名字硬塞）：
 *   小屋 = 左上别墅主体     拱廊 = 右侧连着的那排拱
 *   花圃 = 中间喷泉外的玫瑰环  池塘 = 右下海湾 / 木栈桥
 *   棋桌 = 左下露台的小圆桌
 */
export const GARDEN_SPOTS: GardenSpot[] = [
  { id: "casa", zh: "小屋", la: "Casa", x: 32.8, y: 20.4 },
  { id: "portico", zh: "拱廊", la: "Portico", x: 80, y: 38.2 },
  { id: "fiori", zh: "花圃", la: "Fiori", x: 22.6, y: 58.5, to: "/play/garden/fiori" },
  { id: "stagno", zh: "池塘", la: "Stagno", x: 84.6, y: 65.4, to: "/play/garden/stagno" },
  { id: "tavolo", zh: "棋桌", la: "Tavolo", x: 13.3, y: 75.4, to: "/play/garden/tavolo" },
];

/**
 * 他此刻在哪儿。
 *
 * 现在只有"长椅"一个位置，写死在这里 —— 等花园能让他走动起来，
 * 位置就该由他的状态（`wake-schedule` / 感知层）驱动，而不是这张表。
 */
export const GARDEN_AI = {
  x: 20,
  y: 44.8,
  place: "长椅",
};

/**
 * 他待在长椅上随口说的话。
 * 不接模型：这一句是"空气里的声音"，专门用短句、安静的话，别抢戏。
 */
export const GARDEN_AI_LINES = [
  "今天这里很安静。",
  "风把花吹得一晃一晃的。",
  "我一直在这儿，你慢慢来。",
  "刚才有只鸟停在水池边上。",
];

/**
 * 踪迹：一条虚线石板路 + 三个时刻。
 *
 * 这一版只当地标（还没做时间线页），所以压得极淡、不接点击。
 * 坐标是 390×844 画面里的绝对像素，SVG 用同一个 viewBox。
 */
export const GARDEN_TRAIL = {
  /** 390×844 坐标系里的路径（从喷泉边往左下走） */
  d: "M168 505 C 178 528 190 560 198 600 C 206 640 212 690 226 736",
  marks: [
    { t: "09:26", x: 186, y: 540 },
    { t: "10:03", x: 202, y: 640 },
    { t: "11:04", x: 244, y: 734 },
  ],
  /** 入口题字的位置（画面百分比） */
  label: { zh: "踪迹", la: "Vestigia", x: 44, y: 90.6, to: "/play/garden/vestigia" as const },
};

/** 棋桌页顶部那句题词 —— 意大利语 + 中文，跟花园同一套语气。 */
export const CHESS_EPIGRAPH = {
  it: "Non giochiamo per vincere — giochiamo per restare.",
  cn: "不是为了赢才下棋，是为了还能一起坐着。",
};
