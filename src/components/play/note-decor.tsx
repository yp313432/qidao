import { cn } from "@/lib/utils";

/**
 * 玩乐区那些小组件上的**装饰**。
 *
 * ── 用户给的核心原则（改了四版才问明白，别再忘）────────────────
 *
 * "你要知道我这个装饰是**立体**的，像花一样，他们的关系是**跟透视一样**的，
 *  不要只是单纯的组合叠加。"
 *
 * 也就是说：装饰是**立体的物件**待在卡片上，不是贴纸叠在玻璃上。所以：
 *   · 有**接触关系**：回形针要真的咬住卡片的角、纸张要压在它下面
 *   · 有**遮挡次序**：谁在前谁在后要一致（比如夹子在后、纸在前）
 *   · 有**投影/厚度**：近处深一点、远处淡一点，别一层平贴
 *   · 整体色调统一、**细、透、低对比**（视觉 Skill）
 *   · 动效只有缓慢漂浮和极轻呼吸，**禁止弹跳**
 *   · 全部 `pointer-events-none`；靠 html[data-motion] 自动降级
 */


/**
 * 玩乐区卡片角上那只蝴蝶 —— **立体的、真的在振翅**。
 *
 * 用户第 N 版的要求："不是合拢扇动，是上下振翅，蝴蝶得靠这个飞起来"。
 * SVG 内部元素做不了 3D 变换（rotateX/Y 对 SVG 子元素无效），所以换成
 * 四个 `<div>` 各装一片翅膀，外面套一层 perspective —— 翅根固定、翅膀绕
 * 身体轴在三维里上下翻，抬起来时被透视压窄，落下去时摊平。
 *
 * 约束（沿用这个文件开头那段原则）：
 *   · 仍然 `pointer-events-none`、细、透、低对比，颜色全走 `var(--decor)`
 *   · 不弹跳，只有缓慢漂浮 + 振翅；`prefers-reduced-motion` 时停在第 1 帧
 *   · 细线只在下翼，跟着那片翅膀一起动
 */

/** 用确定性采样生成一片翅膀的轮廓（铰链在 viewBox 底边中点） */
function wingPath({
  len,
  wid,
  waves,
  amp,
  phase,
  skew,
  sharp,
  asym,
  cx,
  cy,
}: {
  len: number;
  wid: number;
  waves: number;
  amp: number;
  phase: number;
  skew: number;
  sharp: number;
  asym: number;
  cx: number;
  cy: number;
}): string {
  const N = 24;
  const pts: [number, number][] = [];
  const pt = (t: number): [number, number] => {
    const y = -len * Math.pow(t, sharp);
    const w = wid * Math.pow(Math.sin(Math.PI * t), 0.86);
    const wav = amp * Math.sin(waves * Math.PI * t + phase) * Math.sin(Math.PI * t);
    return [w + wav + skew * t * t, y];
  };
  for (let i = 0; i <= N; i += 1) pts.push(pt(i / N));
  for (let i = N - 1; i >= 1; i -= 1) {
    const t = i / N;
    const y = -len * Math.pow(t, sharp);
    const w = wid * asym * Math.pow(Math.sin(Math.PI * t), 0.9);
    const wav = amp * 1.25 * Math.sin(waves * Math.PI * t + phase + 1.15) * Math.sin(Math.PI * t);
    pts.push([-(w + wav) + skew * t * t, y]);
  }
  const n = pts.length;
  const f = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "0");
  let d = `M ${f(cx + pts[0][0])} ${f(cy + pts[0][1])}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = cx + p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = cy + p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = cx + p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = cy + p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(cx + p2[0])} ${f(cy + p2[1])}`;
  }
  return `${d} Z`;
}

const FORE_WING = wingPath({
  len: 126,
  wid: 18,
  waves: 3,
  amp: 2.4,
  phase: 0.4,
  skew: 6,
  sharp: 0.74,
  asym: 1.08,
  cx: 50,
  cy: 150,
});
const HIND_WING = wingPath({
  len: 56,
  wid: 18,
  waves: 2.1,
  amp: 5.2,
  phase: 1.1,
  skew: 7,
  sharp: 1.16,
  asym: 1.14,
  cx: 50,
  cy: 150,
});

function Wing({
  d,
  id,
  mirror,
  silk,
  box,
}: {
  d: string;
  id: string;
  mirror: boolean;
  silk: boolean;
  box: { w: number; h: number; top: number };
}) {
  return (
    <svg
      viewBox={`0 ${box.top} ${box.w} ${box.h}`}
      aria-hidden="true"
      style={{ display: "block", width: "100%", height: "100%", overflow: "visible" }}
    >
      <defs>
        {/* 填充走**白玻璃**，不用 --decor —— 这个变量在卡片上是近黑的深棕
            （#1c1917 78% + #c17b5a 22%），铺上去整只蝴蝶发灰发脏。
            --decor 只留给描边/翅脉，浓度压到 .3 以下。 */}
        <linearGradient id={`bwG-${id}`} x1="0%" y1="100%" x2="6%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="22%" stopColor="#fdfbff" stopOpacity="0.66" />
          <stop offset="62%" stopColor="#efe7f4" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#e2d6ea" stopOpacity="0.26" />
        </linearGradient>
        <radialGradient id={`bwR-${id}`} cx="34%" cy="86%" r="66%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.62" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform={mirror ? "translate(100 0) scale(-1 1)" : undefined}>
        <path d={d} fill={`url(#bwG-${id})`} />
        <path d={d} fill={`url(#bwR-${id})`} />
        {/* 轮廓：浅色卡片上用一点点墨色勾边才看得清形状；
            线要够粗（1.1）不然 0.7 在缩小的 SVG 里会断成虚线（抗锯齿假象）。 */}
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.1" />
        <path d={d} fill="none" stroke="#ffffff" strokeWidth="0.7" opacity="0.55" />
        {silk ? (
          <g fill="none" stroke="#ffffff" strokeLinecap="round">
            <path
              d="M 56 62 C 66 42, 80 30, 94 28 C 100 27, 101 34, 95 34"
              strokeWidth="0.8"
              opacity="0.5"
            />
            <path d="M 50 74 C 60 58, 72 46, 84 42" strokeWidth="0.45" opacity="0.32" />
          </g>
        ) : null}
      </g>
    </svg>
  );
}

const FORE_BOX = { w: 100, h: 160, top: -10 };
const HIND_BOX = { w: 100, h: 100, top: -6 };

export function ButterflyWings({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("bw3d pointer-events-none absolute", className)}>
      <div className="bw3d-scene">
        <div className="bw3d-fly">
          <div className="bw3d-wing bw3d-hr">
            <div className="bw3d-wing-in">
              <Wing d={HIND_WING} id="hr" mirror={false} silk box={HIND_BOX} />
              <span className="bw3d-veil" />
            </div>
          </div>
          <div className="bw3d-wing bw3d-hl">
            <div className="bw3d-wing-in">
              <Wing d={HIND_WING} id="hl" mirror silk box={HIND_BOX} />
              <span className="bw3d-veil" />
            </div>
          </div>
          <div className="bw3d-wing bw3d-fr">
            <div className="bw3d-wing-in">
              <Wing d={FORE_WING} id="fr" mirror={false} silk={false} box={FORE_BOX} />
              <span className="bw3d-veil" />
            </div>
          </div>
          <div className="bw3d-wing bw3d-fl">
            <div className="bw3d-wing-in">
              <Wing d={FORE_WING} id="fl" mirror silk={false} box={FORE_BOX} />
              <span className="bw3d-veil" />
            </div>
          </div>
          <span className="bw3d-core" />
          <span className="bw3d-body" />
        </div>
      </div>
    </div>
  );
}

/**
 * 回形针 + 底下那张纸：**真的咬住卡片的角**。
 *
 * 用户两条："回形针要真卡在组件角上，后面还有个正方形色块"。
 * 上一版的问题：夹子整个躺在卡片**里面**（离角还差一截），没"咬住"；
 * 而且没有底下那张纸，所以看着是个孤零零的图标。
 *
 * 现在：
 *   · 底下先放一张**方的纸片**（略微歪、比卡片角大一点，有一部分被裁在卡外）
 *   · 回形针**骑在纸片和卡片边缘上**，一半在卡外 —— 这才是"卡住"
 *   · 纸片带一点**投影**（近处深），跟卡片产生层次
 */
export function ClipStamp({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 104"
      aria-hidden="true"
      className={cn("pointer-events-none absolute text-[color:var(--decor)]", className)}
    >
      {/* 底下那张纸：**浅色**，不要用装饰色铺满 ——
          用户说"回形针后面还是有个大方块，棕色的"，
          因为纸是用 currentColor（深灰棕）铺的，一铺满就是个棕方块。
          现在改成"很淡的纸 + 一道很轻的边"，才像纸不像块。 */}
      <g transform="rotate(-9 52 52)">
        <rect
          x="16"
          y="16"
          width="66"
          height="66"
          rx="3"
          fill="#fff"
          opacity="0.22"
          stroke="currentColor"
          strokeWidth="0.6"
          strokeOpacity="0.22"
        />
        {/* 纸上几行"手写" */}
        <g stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.22">
          <path d="M26 34 H70" />
          <path d="M26 44 H64" />
          <path d="M26 54 H52" />
        </g>
        {/* 纸右下那点投影：纸是"浮"在卡上的（近处深、远处淡） */}
        <path
          d="M18 80 C40 84, 66 84, 80 78"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          opacity="0.08"
        />
      </g>

      {/* 回形针：骑在纸片和卡片边缘上。
          用户按他圈的**黄色椭圆**给了角度 —— 比他之前说的"往左斜一点"更斜。 */}
      <g fill="none" strokeLinecap="round" transform="rotate(-20 48 52)">
        <path
          d="M40 2 C28 2, 22 10, 22 22 V58 C22 71, 31 78, 40 78 C49 78, 58 71, 58 58 V25 C58 17, 53 12, 47 12 C41 12, 36 17, 36 25 V56"
          stroke="currentColor"
          strokeWidth="2.4"
          opacity="0.5"
        />
        {/* 金属高光 */}
        <path
          d="M40 2 C28 2, 22 10, 22 22 V58 C22 71, 31 78, 40 78 C49 78, 58 71, 58 58 V25 C58 17, 53 12, 47 12 C41 12, 36 17, 36 25 V56"
          stroke="#fff"
          strokeWidth="0.8"
          opacity="0.45"
        />
      </g>
    </svg>
  );
}


