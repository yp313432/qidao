/**
 * 花园里的「走动」—— 位置表 + 落点换算。
 *
 * 为什么单独一个文件：
 *   · 底图会换（`public/garden/base.jpg`），换图后地点对不上，只改 `WALK_PLACES`
 *     的 x / y（画面百分比，左上角 0,0），界面和动作都不用动；
 *   · 他站哪儿由 store 里的 `gardenWalk` 决定，页面、动作、后台唤醒都读同一个值。
 *
 * 立绘怎么换（用户 m05335 定的路子："你给图，我接"）：
 *   把透明底的全身 PNG 放到 `public/garden/walker.png`，然后把下面的
 *   `WALKER_IMAGE` 从 null 改成该路径即可 —— 走路/停下的逻辑全都不用改。
 *   没有图时用组件里内置的占位小人（`components/play/garden-walker.tsx`）。
 */

/**
 * 立绘地址。
 *
 * 用户 m05721 说"直接用图片这个"——就是他给的那张 Q 版立绘（1024×1536，灰底）。
 * 灰底已经抠成透明（`cut_walker.py`：低饱和+亮＝背景，只抠与画布边缘连通的那片，
 * 鞋底投影一并抹掉），裁到人物外框后存 `public/garden/walker.png`（254×600）。
 */
export const WALKER_IMAGE: string | null = "/garden/walker.png";

/**
 * 立绘在画面里的显示尺寸（px）。
 * 图片实际比例 254:600 ≈ 1:2.36，这里给 63×150 保持同比例（高 ≈ 屏高的 18%）。
 */
export const WALKER_SIZE = { w: 63, h: 150 };

export type WalkPlace = {
  id: string;
  /** 中文名，回执和提示里用 */
  zh: string;
  /** 画面百分比 */
  x: number;
  y: number;
  /** 面向：1 = 朝右，-1 = 朝左（贴图翻转） */
  face: 1 | -1;
};

/**
 * 他能站下来的地方。
 *
 * 只收「画上真的能站」的点：喷泉广场、长椅、棋桌旁、池塘边、花圃边、小屋门口。
 * 不做的：点花丛/水面/栏杆 —— 那些地方没有落脚点，点过去也会被 `nearestPlace` 拉回来。
 */
export const WALK_PLACES: WalkPlace[] = [
  { id: "fountain", zh: "喷泉前", x: 46, y: 56, face: 1 },
  { id: "bench", zh: "长椅", x: 21, y: 54, face: 1 },
  { id: "tavolo", zh: "棋桌旁", x: 22, y: 72, face: -1 },
  { id: "stagno", zh: "池塘边", x: 72, y: 70, face: 1 },
  { id: "fiori", zh: "花圃边", x: 33, y: 62, face: 1 },
  { id: "casa", zh: "小屋门口", x: 36, y: 30, face: 1 },
  { id: "portico", zh: "拱廊下", x: 70, y: 42, face: 1 },
  { id: "vestigia", zh: "石板路口", x: 46, y: 84, face: 1 },
];

/** 默认站的位置：长椅（跟旧版 `GARDEN_AI` 一致） */
export const WALK_HOME = WALK_PLACES.find((p) => p.id === "bench")!;

export function placeOf(id: string): WalkPlace | null {
  return WALK_PLACES.find((p) => p.id === id) ?? null;
}

/** 按中文名找地方（模型可能直接说"池塘边"） */
export function placeByZh(zh: string): WalkPlace | null {
  const q = zh.trim();
  return (
    WALK_PLACES.find((p) => p.zh === q) ??
    WALK_PLACES.find((p) => q.includes(p.zh)) ??
    WALK_PLACES.find((p) => p.id === q) ??
    null
  );
}

/** 离某个画面坐标最近的地方（点哪儿都先落到最近的落脚点） */
export function nearestPlace(x: number, y: number): WalkPlace {
  let best = WALK_PLACES[0]!;
  let bestD = Infinity;
  for (const p of WALK_PLACES) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** 两个位置之间要走多久（毫秒）——按画面距离算，远的走得久 */
export function walkMs(from: { x: number; y: number }, to: { x: number; y: number }) {
  const d = Math.hypot(to.x - from.x, (to.y - from.y) * 2);
  return Math.max(420, Math.min(2200, Math.round(d * 34)));
}
