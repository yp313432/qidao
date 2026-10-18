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
 * 玩乐区卡片角上那只蝴蝶 —— **2D，一张平铺的 SVG**。
 *
 * 用户 m05129（真机）"3D 显示不出来，还会卡重叠，还是用 2D 的吧"。
 * 上一版是 div + perspective + 容器查询单位（cqw/cqh）+ @property：
 * 老一点的安卓 WebView 不认这些，四片翅膀尺寸全塌成 0，叠在翅根就是一团白斑。
 * 这个位置不值得冒兼容风险 —— 回到平铺 SVG：没有 3D、没有容器单位，
 * 只有一条极慢的呼吸（见 styles.css 的 .bw-svg）。
 *
 * 形状沿用被确认过的那一版：前翅细长带尖、后翅短而圆、后翅拖两条飘丝，
 * 白玻璃渐变 + 极轻墨边（浅色卡片上才看得清形状）。
 */

/** 用确定性采样生成一片翅膀的轮廓（铰链在原点，翅膀朝上长） */
function wingPath({
  len,
  wid,
  waves,
  amp,
  phase,
  skew,
  sharp,
  asym,
}: {
  len: number;
  wid: number;
  waves: number;
  amp: number;
  phase: number;
  skew: number;
  sharp: number;
  asym: number;
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
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

const FORE_WING = wingPath({
  len: 132,
  wid: 16,
  waves: 3,
  amp: 2.4,
  phase: 0.4,
  skew: 6,
  sharp: 0.74,
  asym: 1.08,
});
const HIND_WING = wingPath({
  len: 58,
  wid: 20,
  waves: 2.1,
  amp: 5.2,
  phase: 1.1,
  skew: 7,
  sharp: 1.16,
  asym: 1.14,
});

/** 翅根在画布上的位置 */
const HINGE = { x: 100, y: 158 };

function WingArt({ d, silk }: { d: string; silk?: boolean }) {
  return (
    <>
      <path d={d} fill="url(#bwG)" />
      <path d={d} fill="url(#bwR)" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.08" />
      <path d={d} fill="none" stroke="#ffffff" strokeWidth="0.7" opacity="0.55" />
      {silk ? (
        <g fill="none" stroke="#ffffff" strokeLinecap="round">
          <path
            d="M 7 -50 C 16 -66, 30 -76, 42 -77 C 48 -77, 48 -69, 42 -70"
            strokeWidth="0.8"
            opacity="0.5"
          />
          <path d="M 4 -40 C 12 -54, 24 -64, 35 -67" strokeWidth="0.45" opacity="0.32" />
        </g>
      ) : null}
    </>
  );
}

export function ButterflyWings({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden="true"
      className={cn("bw-svg pointer-events-none absolute text-[color:var(--decor)]", className)}
    >
      <defs>
        {/* 填充走**白玻璃**：--decor 在卡片上是近黑的深棕，铺上去整只发灰发脏。
            它只留给描边/翅脉，浓度压到 .1 以下。 */}
        <linearGradient id="bwG" x1="0%" y1="100%" x2="10%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="22%" stopColor="#fdfbff" stopOpacity="0.66" />
          <stop offset="62%" stopColor="#efe7f4" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#e2d6ea" stopOpacity="0.24" />
        </linearGradient>
        <radialGradient id="bwR" cx="34%" cy="86%" r="66%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="bwCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="42%" stopColor="#fffaf6" stopOpacity="0.6" />
          <stop offset="78%" stopColor="#fff6f0" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 后翅先画（在下层），左右各一；左翼用 scale(-1 1) 镜像 */}
      <g transform={`translate(${HINGE.x} ${HINGE.y}) rotate(116)`}>
        <WingArt d={HIND_WING} silk />
      </g>
      <g transform={`translate(${HINGE.x} ${HINGE.y}) scale(-1 1) rotate(116)`}>
        <WingArt d={HIND_WING} silk />
      </g>

      {/* 前翅后画（压在上面）。左右角度差 3°，不对称才活 */}
      <g transform={`translate(${HINGE.x} ${HINGE.y}) rotate(34)`}>
        <WingArt d={FORE_WING} />
      </g>
      <g transform={`translate(${HINGE.x} ${HINGE.y}) scale(-1 1) rotate(37)`}>
        <WingArt d={FORE_WING} />
      </g>

      {/* 身体：一根很淡的白线，从翅根往上 */}
      <path
        d={`M ${HINGE.x} ${HINGE.y - 2} L ${HINGE.x} ${HINGE.y - 36}`}
        stroke="#ffffff"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* 触角：两根很淡的细线从身体顶端往外挑 —— 有没有它，一眼认不认得出是蝴蝶差很多 */}
      <path
        d={`M ${HINGE.x} ${HINGE.y - 34} C ${HINGE.x - 4} ${HINGE.y - 46}, ${HINGE.x - 12} ${HINGE.y - 54}, ${HINGE.x - 17} ${HINGE.y - 57}`}
        fill="none"
        stroke="#ffffff"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d={`M ${HINGE.x} ${HINGE.y - 34} C ${HINGE.x + 4} ${HINGE.y - 47}, ${HINGE.x + 12} ${HINGE.y - 56}, ${HINGE.x + 18} ${HINGE.y - 59}`}
        fill="none"
        stroke="#ffffff"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* 胸口那点光 */}
      <circle cx={HINGE.x} cy={HINGE.y} r="10" fill="url(#bwCore)" opacity="0.85" />
    </svg>
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


