import { useEffect, useRef, useState } from "react";
import { DIMS, ZERO_PETAL, strongest, type DimId } from "@/lib/state-dims";
import { cn } from "@/lib/utils";

/**
 * 「心潮」那朵花（只有花本身 —— 背景是整页的 `tide-bg`，在这里画会把整页盖住）。
 *
 * ⚠️ 2026-10 真机反馈后大改：
 *   1. **删掉所有 SVG 滤镜**。原来花瓣过 `feGaussianBlur`（22 条路径）+ 花心过
 *      `feDropShadow`：用户真机实测"滑动很卡手"，而且**偶尔整朵花的中心渲染不出来**
 *      （图二那样）。滤镜链在安卓 WebView 上又贵又容易失败，现在改用
 *      纯色描边 + 每瓣两层填充，观感接近、稳得多。
 *   2. **花瓣加长、变细、整朵放大**（"花瓣太短""有的胖胖的""花整体拉长拉大点"）。
 *   3. **花心圆缩到约一半**（原来那个大黑圆太抢戏："中间的圆太大，显得突兀"）。
 *
 * 数值是他每轮自己报的，不编造；没报过的是 0，画的时候才给一点零值底
 * （数据层不加底，否则会污染平均值）。
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

  /**
   * 几何（对着真机反馈调的第二版）：
   *   · `R0 = 3.5`：花瓣从花心根部长出来（花喉是实的，不空）
   *   · `MIN_LEN 18 / MAX_LEN 22`：花瓣明显变长（上一版太短）
   *   · `halfW = 3.4 + v * 1.3`：变细（上一版"有的胖胖的"）
   *   · 花心圆 rx/ry 缩到 7.6/6.4（约上一版的一半）
   */
  const R0 = 3.5;
  const R_LABEL = 47;
  const MIN_LEN = 18;
  const MAX_LEN = 22;

  /** 悬浮感：指针移动时花瓣轻跟（只有能 hover 的设备才开，触摸不走这条路） */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [hoverable, setHoverable] = useState(false);
  useEffect(() => {
    setHoverable(
      typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches === true,
    );
  }, []);

  /** 圆头花瓣：细颈根部 → 往外张开 → **半圆头**（`A` 弧，半径 = 半宽）→ 对称收回 */
  const petalPath = (len: number, halfW: number) => {
    const tip = R0 + len;
    const capC = tip - halfW;
    return [
      `M 0 ${-R0}`,
      `C ${-halfW * 0.42} ${-(R0 + len * 0.22)} ${-halfW} ${-(R0 + len * 0.52)} ${-halfW} ${-capC}`,
      `A ${halfW} ${halfW} 0 0 1 ${halfW} ${-capC}`,
      `C ${halfW} ${-(R0 + len * 0.52)} ${halfW * 0.42} ${-(R0 + len * 0.22)} 0 ${-R0}`,
      "Z",
    ].join(" ");
  };

  return (
    <div
      ref={hostRef}
      className={cn("relative", className)}
      onPointerMove={
        hoverable
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const dx = (e.clientX - r.left) / r.width - 0.5;
              const dy = (e.clientY - r.top) / r.height - 0.5;
              setTilt({ x: Number((-dy * 4).toFixed(2)), y: Number((dx * 4).toFixed(2)) });
            }
          : undefined
      }
      onPointerLeave={hoverable ? () => setTilt({ x: 0, y: 0 }) : undefined}
    >
      <svg
        viewBox="-12 -12 124 124"
        className="flower-grow mx-auto block h-auto w-full max-w-[360px]"
        role="img"
        aria-label={`情绪分布：${DIMS.map((d) => `${d.label} ${Math.round(dims[d.id] * 100)}%`).join("，")}`}
      >
        <defs>
          {/* 花瓣填充：花心偏白/粉 → 边缘淡紫。
              ⚠️ 必须 userSpaceOnUse：花瓣绕花心旋转，默认的 objectBoundingBox
              会让渐变跟着转，"从中心向外渐淡"就废了 */}
          <radialGradient id={`petal-fill-${mode}`} gradientUnits="userSpaceOnUse" cx="50" cy="50" r="46">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.96" />
            <stop offset="42%" stopColor="#ffdcee" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#d3bcff" stopOpacity="0.85" />
          </radialGradient>
        </defs>

        {/*
          ⚠️ 三层 <g> 是**必须**的，别合并：
            ① 最外层吃 CSS 动画（呼吸的 scale）
            ② 中间那层放属性 `translate(50 50)` 把花挪到 viewBox 中心
            ③ 最内层放跟指针的位移
          为什么不能合并：**CSS 的 transform 会顶掉同元素的 SVG `transform` 属性**
          （SVG2 里它们是同一个属性）。第一版把呼吸动画和 translate 写在同一个 <g> 上，
          结果 translate 被顶掉 → 整朵花跑到左上角、标签散了一屏。截图才看出来。
        */}
        <g className="flower-breathe">
          <g transform="translate(50 50)">
            <g transform={`translate(${tilt.y} ${tilt.x})`}>
            {DIMS.map((d, i) => {
              const raw = dims[d.id];
              const v = Math.max(ZERO_PETAL, raw);
              const len = MIN_LEN + v * MAX_LEN;
              const halfW = 3.4 + v * 1.3;
              const angle = (360 / n) * i;
              const isTop = d.id === top.id;
              const shape = petalPath(len, halfW);
              return (
                /* 两层：底层是"中心白→边缘淡紫"的渐变（柔软感），
                   上面叠**这一瓣自己的颜色** —— 只有渐变的话 11 瓣是一团白 */
                <g key={d.id} transform={`rotate(${angle})`}>
                  <path
                    data-petal={d.id}
                    data-value={raw}
                    className={cn("flower-petal", isTop && "flower-lobe-glow")}
                    d={shape}
                    fill={`url(#petal-fill-${mode})`}
                    opacity={0.6 + raw * 0.4}
                    stroke="#ffffff"
                    strokeWidth={0.6}
                    strokeOpacity={0.55 + raw * 0.3}
                  />
                  <path
                    className="flower-petal"
                    d={shape}
                    fill={d.color}
                    opacity={0.22 + raw * 0.4}
                    stroke={d.color}
                    strokeWidth={isTop ? 0.8 : 0.45}
                    strokeOpacity={isTop ? 0.95 : 0.32 + raw * 0.45}
                  />
                </g>
              );
            })}

            {/* 标签（横着放：中文竖排很难读） */}
            {DIMS.map((d, i) => {
              const rad = ((360 / n) * i - 90) * (Math.PI / 180);
              const x = R_LABEL * Math.cos(rad);
              const y = R_LABEL * Math.sin(rad) + 1.7;
              const lit = dims[d.id] > 0.15;
              return (
                <text
                  key={d.id}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  fill="#4b2f57"
                  fillOpacity={lit ? 0.92 : 0.42}
                  style={{ fontSize: 4.3, fontWeight: lit ? 600 : 400 }}
                >
                  {d.label}
                </text>
              );
            })}
          </g>

          {/* 花心：圆缩到约一半（原来那个大黑圆太抢戏）。
              投影用"更深的椭圆垫在后面"来模拟 —— 不用滤镜，安卓 WebView 才不会画崩 */}
          <ellipse cx={0} cy={1.1} rx={7.8} ry={6.6} fill="rgba(40,32,48,0.28)" />
          <ellipse cx={0} cy={0} rx={7.6} ry={6.4} fill="rgba(40,32,48,0.9)" />
          <ellipse cx={0} cy={-1.6} rx={5.2} ry={2.5} fill="rgba(255,255,255,0.16)" />
          <text
            x={0}
            y={-1.5}
            textAnchor="middle"
            fill="#f4e9ff"
            fillOpacity={0.85}
            style={{ fontSize: 2.7, letterSpacing: 0.15 }}
          >
            {mode === "now" ? top.label : "平均"}
          </text>
          <text
            x={0}
            y={4.2}
            textAnchor="middle"
            fill="#ffffff"
            style={{ fontSize: 6.6, fontWeight: 500, fontFamily: "Georgia, 'Songti SC', serif" }}
          >
            {top.value.toFixed(2)}
          </text>
          </g>
        </g>
      </svg>
    </div>
  );
}
