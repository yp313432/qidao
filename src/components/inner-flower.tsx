import { DIMS, ZERO_PETAL, strongest, type DimId } from "@/lib/state-dims";
import { cn } from "@/lib/utils";

/**
 * 「内在」的那朵花：一圈花瓣，每瓣一个情绪维度，长度=数值。
 *
 * 为什么手写 SVG 而不用现成的 recharts：雷达图带坐标轴和网格，画出来是"图表"；
 * 要的是一朵花。手写更短、颜色直接跟全站令牌走、也好测。
 *
 * 形状上迭代过一版（用户："圆润一点，不要太紧凑，而且不用突出这么长"）：
 *   · 花瓣从"扁椭圆"换成**水滴形路径**（尖端是圆弧，不是切平的椭圆头）
 *   · 最长从 36 缩到 24（单位），半径起点外移（R0 8 → 13）——
 *     短花瓣不再挤在花心那一坨
 *   · 每瓣更窄（半宽 3.4），11 瓣之间留出明显缝隙
 *
 * 数值**不编造**：`dims` 是他每轮自己报的；没报过的是 0，
 * 画的时候才加一点"零值底"，好让人看出词表里还有它。
 */
export function InnerFlower({
  dims,
  mode = "now",
  className,
}: {
  dims: Record<DimId, number>;
  /** now = 此刻那朵（花心写名字和数值）；avg = 一段时间平均 */
  mode?: "now" | "avg";
  className?: string;
}) {
  const top = strongest(dims);
  const n = DIMS.length;
  const R0 = 13; // 花瓣起点半径（外移，别挤在花心）
  const R_LABEL = 46; // 标签半径
  const MAX_LEN = 24; // 满值时花瓣有多长（不许再长，会长得吓人）

  /** 水滴形花瓣：从 (0,-R0) 出发，尖端是圆弧（比椭圆头好看） */
  const petalPath = (len: number, halfW: number) => {
    const outer = R0 + len;
    const shoulder = R0 + len * 0.38;
    return `M 0 ${-R0} C ${-halfW} ${-shoulder} ${-halfW} ${-(outer - len * 0.18)} 0 ${-outer} C ${halfW} ${-(outer - len * 0.18)} ${halfW} ${-shoulder} 0 ${-R0} Z`;
  };

  return (
    <svg
      viewBox="-12 -12 124 124"
      className={cn("mx-auto block h-auto w-full max-w-[330px]", className)}
      role="img"
      aria-label={`情绪分布：${DIMS.map((d) => `${d.label} ${Math.round(dims[d.id] * 100)}%`).join("，")}`}
    >
      <defs>
        {/* 花心用一点径向渐变，比纯色圆片柔和 */}
        <radialGradient id="flower-core">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.10" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </radialGradient>
      </defs>

      {/* 花瓣 */}
      {DIMS.map((d, i) => {
        const raw = dims[d.id];
        const v = Math.max(ZERO_PETAL, raw);
        const len = 7 + v * MAX_LEN;
        const halfW = 3.1 + v * 0.9;
        const angle = (360 / n) * i;
        const isTop = d.id === top.id && mode === "now";
        return (
          <path
            key={d.id}
            data-petal={d.id}
            data-value={raw}
            d={petalPath(len, halfW)}
            fill={d.color}
            opacity={0.16 + raw * 0.8}
            stroke={isTop ? d.color : "none"}
            strokeWidth={isTop ? 0.5 : 0}
            /*
              ⚠️ 路径是**以原点为中心**的局部坐标（`M 0 -R0`），所以必须先
              `translate(50 50)` 挪到花心，再 rotate —— 只写 rotate(angle 50 50)
              的话，花瓣会"绕着花心旋转"到画面外面去（整个图看着是空的）。
            */
            transform={`translate(50 50) rotate(${angle})`}
          />
        );
      })}

      {/* 花心 */}
      <circle cx={50} cy={50} r={13} className="fill-surface" opacity={0.94} />
      <circle cx={50} cy={50} r={13} fill="url(#flower-core)" className="text-fg" />
      <text x={50} y={47.2} textAnchor="middle" className="fill-muted" style={{ fontSize: 4.4 }}>
        {mode === "now" ? top.label : "平均"}
      </text>
      <text
        x={50}
        y={55.5}
        textAnchor="middle"
        className="fill-fg"
        style={{ fontSize: 9.5, fontWeight: 500 }}
      >
        {top.value.toFixed(2)}
      </text>

      {/* 标签（横着放：中文竖排很难读） */}
      {DIMS.map((d, i) => {
        const rad = ((360 / n) * i - 90) * (Math.PI / 180);
        const x = 50 + R_LABEL * Math.cos(rad);
        const y = 50 + R_LABEL * Math.sin(rad) + 1.6;
        const lit = dims[d.id] > 0.15;
        return (
          <text
            key={d.id}
            x={x}
            y={y}
            textAnchor="middle"
            className={lit ? "fill-fg" : "fill-subtle"}
            style={{ fontSize: 4, fontWeight: lit ? 500 : 400 }}
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}
