import { cn } from "@/lib/utils";

/**
 * 玩乐区那些小组件上的**装饰**。
 *
 * 定调（照视觉 Skill）：**细、透、低对比、慢**。
 *   · 颜色走 `--decor`（跟文字色走）；只有糖果是**特例**，见 CandyJar 的说明
 *   · 动效只有缓慢漂浮和极轻呼吸，**禁止弹跳**（Skill 第 10 节）
 *   · 全部 `pointer-events-none`，绝不挡点击
 *   · 靠全局 html[data-motion] 规则自动降级
 *
 * 全部手写 SVG，不引图片 —— 放大不糊，也不占体积。
 */

/**
 * 角落的**横折半包**：一条线横着来、拐个直角再竖着去，末端收掉。
 *
 * 用户："有一道波纹就行了，我是想做横折一样的半包" ——
 * 上一版我画了三条正弦波，理解错了。现在是一条折线，
 * 横竖各一段、转角是小圆角，两头淡出 = "半包"（不是一整圈边框）。
 *
 * `corner` 决定画哪个角，靠 scale 镜像，不用画四份。
 */
export function CornerBracket({
  className,
  corner = "tl",
}: {
  className?: string;
  corner?: "tl" | "br";
}) {
  /*
    几何要**撑满 viewBox**，否则 SVG 默认的 preserveAspectRatio="xMidYMid meet"
    会把图形缩小居中，看着就是一条孤零零的线（第一版 72×48 的框里只画到
    x=43/y=45，等于只用了 60% 的面积，所以那个"横折"根本没成形）。
    现在横段铺满 0→60、竖段铺满 0→64，转角在 (60,16) 收圆角。
  */
  const transform = corner === "br" ? "scale(-1,-1) translate(-80 -68)" : undefined;
  return (
    <svg
      viewBox="0 0 80 68"
      aria-hidden="true"
      className={cn("pointer-events-none absolute text-[color:var(--decor)]", className)}
    >
      <g transform={transform} fill="none" stroke="currentColor" strokeLinecap="round">
        {/* 横段：从左边进来（带一点起伏），到右端拐直角 */}
        <path
          d="M2 4 C20 4, 38 7, 52 14 C57 16.5, 60 20, 60 25"
          strokeWidth="1.5"
          opacity="0.55"
        />
        {/* 竖段：从转角往下，越往下越淡 —— "半包"就收在这儿，不是一整圈 */}
        <path
          d="M60 25 V50 C60 58, 57 63, 51 65"
          strokeWidth="1.2"
          opacity="0.34"
        />
        {/* 转角内侧一点柔光，让拐弯处不生硬 */}
        <path d="M60 18 C60 27, 53 32, 45 32" stroke="#fff" strokeWidth="0.9" opacity="0.28" />
      </g>
    </svg>
  );
}

/**
 * 蝴蝶丝带：照着参考图那种**发光、带翅脉**的透明蝴蝶。
 *
 * 用户："这个蝴蝶我怎么看着有点不对呀……和我图片上的差距有点大呀，
 * 是这种代码做不出来吗" —— 做得出来。上一版是平涂（一坨灰），
 * 参考图那种是靠**径向渐变 + 内部细纹 + 发光边**堆出来的：
 *   · 翅膀用 center-outward 的径向渐变（根部亮、边缘透）
 *   · 加翅脉细纹和内圈的浅色纹路
 *   · 边缘一圈极淡的亮描边 = 发光
 *   · 整只**向左微斜**（用户："向左微斜"）
 */
export function ButterflyRibbon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 150 130"
      aria-hidden="true"
      className={cn("pointer-events-none absolute", className)}
    >
      <defs>
        <radialGradient id="wingA" cx="82%" cy="70%" r="95%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="30%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="70%" stopColor="var(--decor)" stopOpacity="0.42" />
          <stop offset="100%" stopColor="var(--decor)" stopOpacity="0.16" />
        </radialGradient>
        <radialGradient id="wingB" cx="80%" cy="35%" r="95%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="35%" stopColor="#fff" stopOpacity="0.42" />
          <stop offset="100%" stopColor="var(--decor)" stopOpacity="0.12" />
        </radialGradient>
        <linearGradient id="wingEdge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--decor)" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* 整只往左微斜（用户："向左微斜"） */}
      <g transform="rotate(-12 75 60)">
        {/* 拖出来的丝带尾巴（落在组件内） */}
        <g className="aster-drift" fill="none" stroke="var(--decor)" strokeLinecap="round">
          <path d="M70 78 C62 92, 44 100, 34 112 C29 118, 33 121, 40 118" strokeWidth="0.85" opacity="0.3" />
          <path d="M74 80 C68 94, 52 104, 44 116" strokeWidth="0.55" opacity="0.18" />
        </g>

        <g className="aster-flutter">
          {/* 左上翅：细长、往外扬 */}
          <path
            d="M72 52 C52 24, 20 18, 14 34 C8.5 48, 42 60, 72 52 Z"
            fill="url(#wingA)"
            stroke="url(#wingEdge)"
            strokeWidth="0.7"
          />
          {/* 左下翅 */}
          <path
            d="M72 56 C52 72, 28 84, 26 70 C24.5 58, 50 52, 72 56 Z"
            fill="url(#wingB)"
            stroke="url(#wingEdge)"
            strokeWidth="0.6"
          />
          {/* 右上翅（稍窄，像侧身） */}
          <path
            d="M78 52 C96 28, 124 24, 129 39 C133.5 52, 104 60, 78 52 Z"
            fill="url(#wingA)"
            stroke="url(#wingEdge)"
            strokeWidth="0.7"
          />
          {/* 右下翅 */}
          <path
            d="M78 56 C96 70, 116 80, 118 68 C119.5 57, 96 52, 78 56 Z"
            fill="url(#wingB)"
            stroke="url(#wingEdge)"
            strokeWidth="0.6"
          />

          {/* 翅脉：细纹 + 内圈浅色纹（参考图那种"里面还有一层"的感觉） */}
          <g fill="none" stroke="#fff" strokeLinecap="round">
            <path d="M70 50 C56 40, 40 33, 24 32" strokeWidth="0.7" opacity="0.4" />
            <path d="M70 54 C58 58, 44 66, 34 68" strokeWidth="0.6" opacity="0.3" />
            <path d="M80 50 C92 40, 108 34, 122 34" strokeWidth="0.7" opacity="0.36" />
            <path d="M80 54 C92 60, 104 66, 112 66" strokeWidth="0.6" opacity="0.28" />
            {/* 靠近根部的那圈浅纹 */}
            <path
              d="M68 50 C60 46, 52 44, 44 44"
              strokeWidth="1.1"
              opacity="0.3"
            />
            <path
              d="M82 50 C90 46, 98 44, 106 44"
              strokeWidth="1.1"
              opacity="0.26"
            />
          </g>
        </g>

        {/* 身体：根部一条亮线（参考图的中心发光点） */}
        <path d="M75 40 V68" stroke="#fff" strokeWidth="1.6" opacity="0.5" strokeLinecap="round" />
        <path d="M75 40 V68" stroke="var(--decor)" strokeWidth="0.7" opacity="0.4" strokeLinecap="round" />
        {/* 触角 */}
        <path
          d="M75 40 C71 33, 67 29, 62 26 M75 40 C79 33, 83 29, 88 26"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="0.7"
          opacity="0.4"
          strokeLinecap="round"
        />
        {/* 身体根部那点小亮（发光核） */}
        <circle cx="75" cy="50" r="3.2" fill="#fff" opacity="0.3" />
      </g>
    </svg>
  );
}

/**
 * 便签戳子：**回形针正卡在卡片右上角**。
 *
 * 用户："那个回形针稍微要大一点，然后正好卡到右上角去" ——
 * 所以尺寸放大，位置摆到让回形针"咬"住卡片的圆角边。
 */
export function ClipStamp({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 96"
      aria-hidden="true"
      className={cn("pointer-events-none absolute text-[color:var(--decor)]", className)}
    >
      <g transform="rotate(-10 40 48)">
        {/* 斜贴的标签纸 */}
        <rect
          x="12"
          y="22"
          width="56"
          height="48"
          rx="4"
          fill="currentColor"
          opacity="0.1"
          stroke="currentColor"
          strokeWidth="0.7"
          strokeOpacity="0.32"
        />
        <g stroke="currentColor" strokeWidth="0.85" strokeLinecap="round" opacity="0.32">
          <path d="M20 40 H58" />
          <path d="M20 49 H52" />
          <path d="M20 58 H42" />
        </g>

        {/* 回形针：比上一版大一圈，且压在卡片角上 */}
        <g fill="none" strokeLinecap="round">
          <path
            d="M34 4 C24 4, 19 11, 19 21 V54 C19 65, 27 71, 34 71 C41 71, 49 65, 49 54 V24 C49 17, 45 13, 40 13 C35 13, 31 17, 31 24 V52"
            stroke="currentColor"
            strokeWidth="2.2"
            opacity="0.5"
          />
          {/* 一道白高光，让金属感出来 */}
          <path
            d="M34 4 C24 4, 19 11, 19 21 V54 C19 65, 27 71, 34 71 C41 71, 49 65, 49 54 V24 C49 17, 45 13, 40 13 C35 13, 31 17, 31 24 V52"
            stroke="#fff"
            strokeWidth="0.7"
            opacity="0.4"
          />
        </g>
      </g>
    </svg>
  );
}

/**
 * 糖果玻璃罐 + 散落的糖果。
 *
 * 用户三条反馈：
 *   ① "那个时间下面的玻璃框怎么像一个立着的椭圆呀"
 *      → 上一版罐身画得太瘦太高（30→90 宽、23→134 高 ≈ 1:2.2），
 *        看着就是个立起来的椭圆。现在**压扁、变矮、肚子鼓**，
 *        并按"上窄 → 下鼓 → 平底"来收底，才像个罐子。
 *   ② "糖果咋就一颗球一样啊" → 加数量、加大、分散开（原来挤在底部一团）
 *   ③ "颜色是黑的，糖果不应该五彩缤纷吗" → **糖果是这里唯一的颜色例外**：
 *        它们不跟 --decor（那是深灰棕，所以看着像黑球），
 *        改用一组降饱和的马卡龙色 —— 跟 Skill 的"降饱和、降面积"也不冲突。
 */
export function CandyJar({ className }: { className?: string }) {
  /** 马卡龙糖果色（降饱和，不刺眼） */
  const C = {
    peach: "#e8a58e",
    mint: "#8fc9b4",
    lilac: "#b3a3d4",
    lemon: "#e0c579",
    rose: "#dfa0b4",
  };
  /* 糖果 [cx, cy, r, 颜色] —— 分散在罐子中下部，不是挤成一团 */
  const candies: [number, number, number, string][] = [
    [48, 96, 9, C.peach],
    [68, 100, 8, C.mint],
    [58, 82, 8, C.lemon],
    [78, 88, 7, C.lilac],
    [40, 84, 6.5, C.rose],
    [64, 112, 7.5, C.peach],
    [50, 112, 6, C.lilac],
  ];

  return (
    <svg
      viewBox="0 0 140 150"
      aria-hidden="true"
      className={cn("pointer-events-none absolute", className)}
    >
      <defs>
        {/* 罐身：几乎全透，只有两侧边缘亮 —— 才像玻璃不是白块 */}
        <linearGradient id="jarGlass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--decor)" stopOpacity="0.22" />
          <stop offset="16%" stopColor="var(--decor)" stopOpacity="0.05" />
          <stop offset="50%" stopColor="var(--decor)" stopOpacity="0.02" />
          <stop offset="84%" stopColor="var(--decor)" stopOpacity="0.05" />
          <stop offset="100%" stopColor="var(--decor)" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      <g className="aster-breathe">
        {/*
          罐身：上窄 → 下鼓 → 平底。
          （宽 34→106 = 72；高 44→136 = 92，比例约 1:1.3，不再是个立椭圆）
        */}
        <path
          d="M40 44 C40 44, 34 58, 34 78 C34 100, 40 128, 52 134 C60 138, 80 138, 88 134 C100 128, 106 100, 106 78 C106 58, 100 44, 100 44 Z"
          fill="url(#jarGlass)"
          stroke="var(--decor)"
          strokeWidth="1"
          strokeOpacity="0.36"
        />
        {/* 罐口 + 盖 */}
        <rect x="36" y="36" width="68" height="9" rx="4.5" fill="var(--decor)" opacity="0.18" />
        <rect
          x="44"
          y="30"
          width="52"
          height="8"
          rx="4"
          fill="var(--decor)"
          opacity="0.13"
          stroke="var(--decor)"
          strokeWidth="0.7"
          strokeOpacity="0.28"
        />
        {/* 内壁高光：左边一条长的、右边一小段 */}
        <path d="M43 58 V116" stroke="#fff" strokeWidth="2.6" opacity="0.3" strokeLinecap="round" />
        <path d="M97 66 V92" stroke="#fff" strokeWidth="1.3" opacity="0.15" strokeLinecap="round" />

        {/* 糖果（在罐身之上、玻璃高光之下，像真装在罐里） */}
        {candies.map(([cx, cy, r, color]) => (
          <g key={`${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r={r} fill={color} opacity="0.62" />
            <circle cx={cx - r * 0.3} cy={cy - r * 0.35} r={r * 0.3} fill="#fff" opacity="0.5" />
          </g>
        ))}
      </g>

      {/* 罐外散落的几颗（静态，更真实） */}
      <g>
        <circle cx="118" cy="126" r="6" fill={C.rose} opacity="0.55" />
        <circle cx="116" cy="124" r="1.6" fill="#fff" opacity="0.45" />
        <circle cx="22" cy="130" r="5" fill={C.mint} opacity="0.5" />
        <circle cx="20.6" cy="128.4" r="1.3" fill="#fff" opacity="0.4" />
        <circle cx="126" cy="108" r="4" fill={C.lemon} opacity="0.5" />
        {/* 一颗长条软糖 */}
        <rect
          x="18"
          y="106"
          width="13"
          height="6"
          rx="3"
          fill={C.lilac}
          opacity="0.5"
          transform="rotate(-22 24.5 109)"
        />
      </g>
    </svg>
  );
}
