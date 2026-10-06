import { DIMS, ZERO_PETAL, strongest, type DimId } from "@/lib/state-dims";
import { cn } from "@/lib/utils";

/**
 * 「内在」的那朵花：一圈花瓣，每瓣一个情绪维度，长度=数值。
 *
 * 为什么手写 SVG 而不是用 recharts（虽然是现成依赖）：
 *   recharts 的雷达图带坐标轴和网格，画出来是"图表"；用户要的是
 *   **一朵花的形状**（他给的参考图就是一瓣一瓣、没有轴的）。
 *   手写反而更短、颜色直接跟全站令牌走、也好测。
 *
 * 数值**不编造**：`dims` 是「他每轮自己报的」。没报过的维度是 0，
 * 这里给一个小到几乎看不见的底（`state-dims.ts` 的 ZERO_PETAL），
 * 好让人看得出"词表里还有这些"。
 */
export function InnerFlower({
  dims,
  mode = "now",
  className,
}: {
  dims: Record<DimId, number>;
  /** now = 此刻那朵（花心写名字和数值）；avg = 一段时间平均（花心写日期区间） */
  mode?: "now" | "avg";
  className?: string;
}) {
  const top = strongest(dims);
  const n = DIMS.length;
  const R0 = 8; // 花瓣起点半径（留出花心）
  const R_LABEL = 43; // 标签半径

  return (
    <svg
      viewBox="-9 -9 118 118"
      className={cn("mx-auto block h-auto w-full max-w-[320px]", className)}
      role="img"
      aria-label={`情绪分布：${DIMS.map((d) => `${d.label} ${Math.round(dims[d.id] * 100)}%`).join("，")}`}
    >
      {/* 花瓣：**画的时候**才加"零值底"（数据层没报就是 0，不能污染平均值） */}
      {DIMS.map((d, i) => {
        const raw = dims[d.id];
        const v = Math.max(ZERO_PETAL, raw);
        const len = 9 + v * 27;
        const angle = (360 / n) * i;
        const cy = 50 - (R0 + len / 2);
        const isTop = d.id === top.id && mode === "now";
        return (
          <ellipse
            key={d.id}
            cx={50}
            cy={cy}
            rx={isTop ? 5.2 : 4.4}
            ry={len / 2}
            fill={d.color}
            // 没报过的维度只有很淡的一层：能看出"词表里有它"，但不抢眼
            opacity={0.14 + raw * 0.82}
            stroke={isTop ? d.color : "none"}
            strokeWidth={isTop ? 0.7 : 0}
            transform={`rotate(${angle} 50 50)`}
          />
        );
      })}

      {/* 花心：此刻写"最明显的那一瓣 + 数值"（跟参考图一样） */}
      <circle cx={50} cy={50} r={11} className="fill-surface" opacity={0.92} />
      {mode === "now" ? (
        <>
          <text x={50} y={47} textAnchor="middle" className="fill-muted" style={{ fontSize: 4.6 }}>
            {top.label}
          </text>
          <text
            x={50}
            y={55}
            textAnchor="middle"
            className="fill-fg"
            style={{ fontSize: 9, fontWeight: 500 }}
          >
            {top.value.toFixed(2)}
          </text>
        </>
      ) : (
        <>
          <text x={50} y={47} textAnchor="middle" className="fill-muted" style={{ fontSize: 4.6 }}>
            平均
          </text>
          <text
            x={50}
            y={55}
            textAnchor="middle"
            className="fill-fg"
            style={{ fontSize: 9, fontWeight: 500 }}
          >
            {top.value.toFixed(2)}
          </text>
        </>
      )}

      {/* 标签（不旋转：中文竖排会很难读，索性都横着放） */}
      {DIMS.map((d, i) => {
        const rad = ((360 / n) * i - 90) * (Math.PI / 180);
        const x = 50 + R_LABEL * Math.cos(rad);
        const y = 50 + R_LABEL * Math.sin(rad) + 1.6;
        const v = dims[d.id];
        const lit = v > 0.15;
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
