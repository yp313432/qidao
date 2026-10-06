import { useEffect, useRef, useState } from "react";
import { DIMS, ZERO_PETAL, strongest, type DimId } from "@/lib/state-dims";
import { cn } from "@/lib/utils";

/**
 * 「心潮」—— 内在页那朵花。
 *
 * 分层（自下而上，见 styles.css 的 `.flower-stage` 一段）：
 *   1. 粉→紫流体渐变（两块大模糊色斑在慢慢游）
 *   2. 珍珠粒子（少量、各错开漂移 —— 不用几百个点的 canvas）
 *   3. 两条正弦波（海面横向无限平移）
 *   4. 花：贝塞尔花瓣（径向渐变填充 + 发光描边）+ 呼吸 + 玻璃花心
 *
 * 为什么手写 SVG 而不用 recharts：雷达图带坐标轴和网格，画出来是"图表"；
 * 要的是一朵花。
 *
 * 数值**是他每轮自己报的**，不编造。没报过的是 0 —— 画的时候才给一点零值底，
 * 好让人看出词表里还有这些维度（数据层不加底，否则会污染平均值）。
 */
export function InnerFlower({
  dims,
  mode = "now",
  variant = "full",
  className,
}: {
  dims: Record<DimId, number>;
  mode?: "now" | "avg";
  /**
   * full = 完整的"海"（此刻那朵）；lite = 只有渐变底和波纹（平均那朵）。
   * 为什么要两档：模糊色斑和珍珠都是 `filter: blur()` 的重活，
   * 一页两朵都用满，手机上是白白的电量。
   */
  variant?: "full" | "lite";
  className?: string;
}) {
  const top = strongest(dims);
  const n = DIMS.length;
  /**
   * 几何参数（对着用户那张手绘改的）：
   *   · `R0 = 3.5`：花瓣**从花心根部**长出来，不是从半径 14 起 ——
   *     原来花心周围有一圈空白（"中间不要空着"）。内端会被花心珠盖住，所以看不见杂线。
   *   · 顶端是**半圆头**（见 petalPath 里的 `A`），不是贝塞尔收窄的尖头。
   *   · 宽度加大（`halfW` 4.6 起）：11 瓣相邻几乎相接，像手绘那样紧凑，不是一圈瘦条。
   */
  const R0 = 3.5;
  const R_LABEL = 47;
  const MIN_LEN = 17; // 最短：刚够从花心珠后面露出来一点（"没报过"的维度也看得见）
  const MAX_LEN = 17; // 在此之上按数值追加
  const gid = mode === "now" ? "now" : "avg"; // 两个 <defs> 的 id 不能撞

  /** 悬浮感：指针在舞台里移动时，花心/花瓣轻轻跟一下（只有能 hover 的设备才开） */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [hoverable, setHoverable] = useState(false);
  useEffect(() => {
    setHoverable(
      typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches === true,
    );
  }, []);

  /**
   * 圆头花瓣（对着手绘的"没有尖头"改的）。
   *
   * 形状顺序：细颈根部 → 往外张开 → **半圆头**（`A` 弧，半径 = 半宽）→ 对称收回。
   * 半圆头是关键：原来顶端用贝塞尔收窄，看着还是个尖儿。
   */
  const petalPath = (len: number, halfW: number) => {
    const tip = R0 + len; // 最外端
    const capC = tip - halfW; // 圆头的圆心（离花心多远）
    return [
      `M 0 ${-R0}`,
      `C ${-halfW * 0.42} ${-(R0 + len * 0.22)} ${-halfW} ${-(R0 + len * 0.52)} ${-halfW} ${-capC}`,
      // sweep=1：在 y 向下的坐标里是"顺时针"，正好从左侧绕过顶端到右侧 → 半圆头
      `A ${halfW} ${halfW} 0 0 1 ${halfW} ${-capC}`,
      `C ${halfW} ${-(R0 + len * 0.52)} ${halfW * 0.42} ${-(R0 + len * 0.22)} 0 ${-R0}`,
      "Z",
    ].join(" ");
  };

  /** 海面正弦波：画两个周期，平移 50% 正好一个周期 → 看不出接缝 */
  const wavePath = (amp: number, base: number) =>
    `M0 ${base} Q 25 ${base - amp} 50 ${base} T 100 ${base} T 150 ${base} T 200 ${base} V 100 H0 Z`;

  const pearls = [
    { left: "12%", top: "18%", size: 10, delay: "0s" },
    { left: "78%", top: "26%", size: 7, delay: "-3s" },
    { left: "26%", top: "64%", size: 6, delay: "-6s" },
    { left: "64%", top: "72%", size: 12, delay: "-1.5s" },
    { left: "44%", top: "12%", size: 5, delay: "-8s" },
    { left: "88%", top: "58%", size: 8, delay: "-4.5s" },
  ];

  return (
    <div
      ref={stageRef}
      className={cn("flower-stage", className)}
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
      {/* 1. 流体 */}
      {variant === "full" && (
        <>
          <span className="flower-blob flower-blob-a" aria-hidden="true" />
          <span className="flower-blob flower-blob-b" aria-hidden="true" />
        </>
      )}

      {/* 2. 珍珠 / 光斑 */}
      {variant === "full" &&
        pearls.map((p, i) => (
          <span
            key={i}
            className="flower-pearl"
            aria-hidden="true"
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
            }}
          />
        ))}

      {/* 3. 海面 */}
      <span className="flower-wave flower-wave-far" aria-hidden="true">
        <svg viewBox="0 0 200 100" preserveAspectRatio="none">
          <path d={wavePath(10, 46)} fill="rgba(255,255,255,0.55)" />
        </svg>
      </span>
      <span className="flower-wave flower-wave-near" aria-hidden="true">
        <svg viewBox="0 0 200 100" preserveAspectRatio="none">
          <path d={wavePath(14, 62)} fill="rgba(214,186,255,0.5)" />
        </svg>
      </span>

      {/* 4. 花 */}
      <div className="relative px-2 py-3">
        <svg
          viewBox="-16 -16 132 132"
          className="flower-grow mx-auto block h-auto w-full max-w-[340px]"
          role="img"
          aria-label={`情绪分布：${DIMS.map((d) => `${d.label} ${Math.round(dims[d.id] * 100)}%`).join("，")}`}
        >
          <defs>
            {/* 花瓣填充：花心偏白/粉 → 边缘淡紫。
                ⚠️ 必须用 userSpaceOnUse：花瓣是绕花心旋转的，
                默认的 objectBoundingBox 会让渐变跟着转，"从中心向外渐淡"就废了 */}
            <radialGradient id={`petal-fill-${gid}`} gradientUnits="userSpaceOnUse" cx="50" cy="50" r="44">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#ffd9ec" stopOpacity="0.88" />
              <stop offset="100%" stopColor="#cfb8ff" stopOpacity="0.8" />
            </radialGradient>
            {/* 边缘发光：先模糊再叠回原图 */}
            <filter id={`petal-glow-${gid}`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.7" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id={`core-shadow-${gid}`} x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="1.6" stdDeviation="2.4" floodColor="#3a1f45" floodOpacity="0.35" />
            </filter>
          </defs>

          {/* 花瓣 + 标签：整体呼吸，并在可 hover 的设备上跟指针轻移 */}
          <g className="flower-breathe">
            <g transform={`translate(${tilt.y} ${tilt.x})`}>
              <g filter={`url(#petal-glow-${gid})`}>
                {DIMS.map((d, i) => {
                  const raw = dims[d.id];
                  const v = Math.max(ZERO_PETAL, raw);
                  const len = MIN_LEN + v * MAX_LEN;
                  const halfW = 4.6 + v * 1.7;
                  const angle = (360 / n) * i;
                  const isTop = d.id === top.id;
                  const shape = petalPath(len, halfW);
                  return (
                    /* 两层：底层是"中心白→边缘淡紫"的渐变（柔软感），
                       上面再叠一层**这一瓣自己的颜色** ——
                       只有渐变的话 11 瓣看起来都是一团白的，情绪色读不出来 */
                    <g key={d.id} transform={`translate(50 50) rotate(${angle})`}>
                      <path
                        data-petal={d.id}
                        data-value={raw}
                        className={cn("flower-petal", isTop && "flower-lobe-glow")}
                        d={shape}
                        fill={`url(#petal-fill-${gid})`}
                        opacity={0.55 + raw * 0.45}
                        stroke="#ffffff"
                        strokeWidth={0.7}
                        strokeOpacity={0.5 + raw * 0.3}
                      />
                      <path
                        className="flower-petal"
                        d={shape}
                        fill={d.color}
                        opacity={0.2 + raw * 0.42}
                        stroke={d.color}
                        strokeWidth={isTop ? 0.9 : 0.5}
                        strokeOpacity={isTop ? 0.95 : 0.3 + raw * 0.45}
                      />
                    </g>
                  );
                })}
              </g>

              {/* 标签 */}
              {DIMS.map((d, i) => {
                const rad = ((360 / n) * i - 90) * (Math.PI / 180);
                const x = 50 + R_LABEL * Math.cos(rad);
                const y = 50 + R_LABEL * Math.sin(rad) + 1.7;
                const lit = dims[d.id] > 0.15;
                return (
                  <text
                    key={d.id}
                    x={x}
                    y={y}
                    textAnchor="middle"
                    fill="#4b2f57"
                    fillOpacity={lit ? 0.92 : 0.42}
                    style={{ fontSize: 4.1, fontWeight: lit ? 600 : 400, letterSpacing: 0.1 }}
                  >
                    {d.label}
                  </text>
                );
              })}
            </g>
          </g>

          {/* 花心：深灰水滴（比正圆更像"悬浮的玻璃珠"）+ 衬线数字
              ⚠️ 比上一版略小一点：花瓣现在从根部就长，珠太大就把花瓣全挡住了 */}
          <g filter={`url(#core-shadow-${gid})`}>
            <ellipse cx={50} cy={50.4} rx={13.6} ry={11.9} fill="rgba(40,32,48,0.88)" />
            <ellipse cx={50} cy={47.2} rx={10} ry={5.4} fill="rgba(255,255,255,0.14)" />
          </g>
          <text
            x={50}
            y={46.8}
            textAnchor="middle"
            fill="#f4e9ff"
            fillOpacity={0.82}
            style={{ fontSize: 4.2, letterSpacing: 0.3 }}
          >
            {mode === "now" ? top.label : "平均"}
          </text>
          <text
            x={50}
            y={56.2}
            textAnchor="middle"
            fill="#ffffff"
            style={{ fontSize: 10, fontWeight: 500, fontFamily: "Georgia, 'Songti SC', serif" }}
          >
            {top.value.toFixed(2)}
          </text>
        </svg>
      </div>
    </div>
  );
}
