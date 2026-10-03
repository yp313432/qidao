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
 * 卡片四周那圈**波浪细边框**。
 *
 * 用户："我说的横折只是他的**走向**，还是要用波浪，而且**不是做边框吗**，
 * 你为啥反着包？"
 * → 我上一版理解错了：画成了只有两个角的直角折线，而且方向还反了。
 *   正解是**一条波浪线绕着卡片走一圈**（四个圆角都包上），
 *   "横折"只是说它沿边走、拐弯，线本身要保持波浪。
 *
 * 做法：一条带波浪段的闭合圆角路径 + `vector-effect: non-scaling-stroke`
 * （这样拉伸到任意卡片尺寸时，线宽都保持 pt 级粗细，不会被拉粗）。
 */
export function WavyFrame({ className }: { className?: string }) {
  /*
    一条"波浪 + 圆角"的闭合路径。
    每边用两段小 S 弯（C 曲线）拼出起伏，四个角用 A 圆弧过渡，
    这样既有波浪又有圆角，一整圈连下来不接头。
    viewBox 100×100 靠 preserveAspectRatio="none" 拉满整张卡片。
  */
  const d = [
    // 上边：从左到右，两个起伏
    "M 6 3.2",
    "C 14 0.6, 20 5.4, 28 3.0",
    "C 36 0.6, 42 5.4, 50 3.0",
    "C 58 0.6, 64 5.4, 72 3.0",
    "C 80 0.6, 86 5.0, 94 3.2",
    // 右上圆角
    "A 4 4 0 0 1 96.8 6",
    // 右边
    "C 99.4 14, 94.6 20, 97 28",
    "C 99.4 36, 94.6 42, 97 50",
    "C 99.4 58, 94.6 64, 97 72",
    "C 99.4 80, 95 86, 96.8 94",
    // 右下圆角
    "A 4 4 0 0 1 94 96.8",
    // 下边（从右往左）
    "C 86 99.4, 80 94.6, 72 97",
    "C 64 99.4, 58 94.6, 50 97",
    "C 42 99.4, 36 94.6, 28 97",
    "C 20 99.4, 14 95, 6 96.8",
    // 左下圆角
    "A 4 4 0 0 1 3.2 94",
    // 左边（从下往上）
    "C 0.6 86, 5.4 80, 3.0 72",
    "C 0.6 64, 5.4 58, 3.0 50",
    "C 0.6 42, 5.4 36, 3.0 28",
    "C 0.6 20, 5.0 14, 3.2 6",
    // 左上圆角
    "A 4 4 0 0 1 6 3.2",
    "Z",
  ].join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 size-full text-[color:var(--decor)]", className)}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeOpacity="0.3"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      {/* 第二圈：错开半拍、更淡 —— 让"波浪"更明显，也有一点厚度感 */}
      <path
        d={d}
        fill="none"
        stroke="#fff"
        strokeWidth="0.5"
        strokeOpacity="0.2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        transform="translate(0.6 0.6)"
      />
    </svg>
  );
}

/**
 * 蝴蝶：照参考图那种**飘逸唯美**（不是卡通）。
 *
 * 用户："这个蝴蝶为啥看着这么怪，像卡通，没有图片上的飘逸唯美"。
 *
 * 卡通感的来源是：**短圆翅 + 实心填充 + 粗身体**。
 * 参考图那只是：**细长水滴状的翅 + 全渐变（几乎不填色）+ 发光的翅脉 + 拖长的丝带**。
 * 所以这一版：
 *   · 翅膀拉长成**尖头水滴**，四片大小差异明显（前翅长、后翅带尾尖）
 *   · 用线性渐变（根部白亮 → 翅尖几乎透明），**不留硬边**
 *   · 翅脉用**曲线**从根部散出去，末端收细
 *   · 加散落的微粒和小闪点
 *   · 丝带**又长又软**，一条从翅下拖出去
 */
export function ButterflyRibbon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 170 150"
      aria-hidden="true"
      className={cn("pointer-events-none absolute", className)}
    >
      <defs>
        <linearGradient id="bwLong" x1="0.9" y1="0.8" x2="0.1" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="28%" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="65%" stopColor="var(--decor)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--decor)" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="bwShort" x1="0.9" y1="0.2" x2="0.1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="40%" stopColor="var(--decor)" stopOpacity="0.26" />
          <stop offset="100%" stopColor="var(--decor)" stopOpacity="0.06" />
        </linearGradient>
      </defs>

      {/*
        整只向左微斜 + 一点点横向压扁 —— 这就是"侧面飞过来"的透视，
        四片翅膀也因此有远近差异（不压扁时四片一样大，就平了）。
      */}
      <g transform="rotate(-14 85 70) skewY(-3) scale(0.97 1)">
        {/* 长长的丝带：从翅下拖出去，两条交叠（透视上一条在另一条后面） */}
        <g fill="none" stroke="var(--decor)" strokeLinecap="round" className="aster-drift">
          {/* 后面那条 */}
          <path d="M74 92 C60 108, 38 114, 24 130" strokeWidth="0.6" opacity="0.16" />
          {/* 前面那条（更清楚一点） */}
          <path
            d="M78 94 C66 112, 44 120, 32 138 C28 144, 32 147, 40 144"
            strokeWidth="0.85"
            opacity="0.3"
          />
        </g>

        {/* 散落的微粒（参考图那种星尘感） */}
        <g fill="#fff">
          <circle cx="118" cy="26" r="1.3" opacity="0.5" />
          <circle cx="139" cy="52" r="0.9" opacity="0.38" />
          <circle cx="34" cy="42" r="1.1" opacity="0.4" />
          <circle cx="22" cy="74" r="0.8" opacity="0.3" />
          <circle cx="128" cy="98" r="1" opacity="0.34" />
        </g>

        <g className="aster-flutter">
          {/* 左上：细长水滴，最先扬起来 */}
          <path
            d="M78 66 C58 30, 22 8, 10 22 C-1 35, 40 62, 78 66 Z"
            fill="url(#bwLong)"
          />
          {/* 左下：带尾尖的后翅 */}
          <path
            d="M78 72 C56 86, 28 104, 24 92 C20 80, 52 68, 78 72 Z"
            fill="url(#bwShort)"
          />
          {/* 右下：镜像的后翅（尾尖往下拖） */}
          <path
            d="M92 72 C114 86, 142 106, 146 93 C150 80, 118 68, 92 72 Z"
            fill="url(#bwShort)"
          />
          {/* 右上：最长的一片，往上扬 */}
          <path
            d="M92 66 C112 28, 150 6, 162 20 C173 33, 130 62, 92 66 Z"
            fill="url(#bwLong)"
          />

          {/* 翅脉：从根部散出去的曲线，末端收细（不是直线） */}
          <g fill="none" stroke="#fff" strokeLinecap="round">
            <path d="M80 64 C64 46, 42 30, 24 22" strokeWidth="0.8" opacity="0.45" />
            <path d="M80 66 C64 54, 44 44, 26 40" strokeWidth="0.6" opacity="0.32" />
            <path d="M90 64 C106 46, 128 30, 146 24" strokeWidth="0.8" opacity="0.4" />
            <path d="M90 66 C106 54, 126 46, 144 42" strokeWidth="0.6" opacity="0.3" />
            <path d="M80 72 C66 78, 46 84, 32 86" strokeWidth="0.55" opacity="0.26" />
            <path d="M90 72 C104 78, 124 86, 138 88" strokeWidth="0.55" opacity="0.24" />
            {/* 根部那圈浅纹（"里面还有一层"的感觉） */}
            <path d="M78 62 C68 56, 58 52, 48 50" strokeWidth="1.3" opacity="0.28" />
            <path d="M92 62 C102 56, 112 52, 122 50" strokeWidth="1.3" opacity="0.24" />
          </g>
        </g>

        {/* 身体：细，根部亮（不是粗黑条） */}
        <path d="M85 54 V82" stroke="#fff" strokeWidth="1.5" opacity="0.55" strokeLinecap="round" />
        <path d="M85 54 V82" stroke="var(--decor)" strokeWidth="0.6" opacity="0.35" strokeLinecap="round" />
        {/* 触角：细长、往外弯 */}
        <path
          d="M85 54 C80 42, 72 34, 62 30 M85 54 C90 42, 98 34, 108 30"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="0.6"
          opacity="0.38"
          strokeLinecap="round"
        />
        {/* 根部发光核 */}
        <circle cx="85" cy="66" r="4" fill="#fff" opacity="0.28" />
      </g>
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
      {/* 底下那张纸（正方形色块），比夹子大、略微歪 */}
      <g transform="rotate(-9 52 52)">
        <rect
          x="16"
          y="16"
          width="66"
          height="66"
          rx="3"
          fill="currentColor"
          opacity="0.11"
          stroke="currentColor"
          strokeWidth="0.7"
          strokeOpacity="0.3"
        />
        {/* 纸上几行"手写" */}
        <g stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.3">
          <path d="M26 34 H70" />
          <path d="M26 44 H64" />
          <path d="M26 54 H52" />
        </g>
        {/* 纸的投影：往下偏移一点、更淡，做出"纸是浮在卡上"的层次 */}
        <rect
          x="18"
          y="20"
          width="66"
          height="66"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeOpacity="0.07"
        />
      </g>

      {/* 回形针：骑在纸片和卡片边缘上（部分出画，才像夹住） */}
      <g fill="none" strokeLinecap="round" transform="rotate(-4 48 52)">
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

/**
 * 糖果玻璃罐 + 散落的糖果。
 *
 * 糖果的画法按用户说的（也搜了素材确认）：**椭圆身子 + 中间一个蝴蝶结
 * + 两头拧起来的包装纸**，不是一颗光球。
 * 参考：https://clipart-library.com/clipart/candies-clipart-11.htm
 *
 * 罐子也重画了：上一版被人说"像一个立着的椭圆"，
 * 现在按**矮胖的玻璃罐**（上窄、肚子鼓、平底、厚底边）来画，
 * 并且给罐子加了**接触投影**，让它"坐在"卡片上而不是浮着。
 */
export function CandyJar({ className }: { className?: string }) {
  /** 马卡龙糖果色（降饱和）。糖果是这里唯一的颜色例外。 */
  const C = {
    peach: "#e8a58e",
    mint: "#8fc9b4",
    lilac: "#b3a3d4",
    lemon: "#e0c579",
    rose: "#dfa0b4",
  };

  /**
   * 一颗扭結糖果（**带透视**）。
   *
   * 按参考画法：身子是**椭圆**（正面宽、上下扁），两头拧出的包装纸
   * 是**梯形**（近端宽、远端收窄），中间一个小蝴蝶结。
   * `tilt` 是整体的倾斜，`squash` 是"侧过去"的程度（侧面看身子更窄）——
   * 这两个参数就是"透视"：一罐糖不会颗颗正对镜头。
   */
  function Candy({
    x,
    y,
    s,
    color,
    tilt = 0,
    squash = 1,
  }: {
    x: number;
    y: number;
    s: number;
    color: string;
    tilt?: number;
    squash?: number;
  }) {
    return (
      <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${s})`}>
        <g transform={`scale(${squash} 1)`}>
          {/* 两头拧出来的包装纸：近端宽、远端收（梯形 = 透视） */}
          <path d="M-13 -3.4 L-22 -7.5 L-22 7.5 L-13 3.4 Z" fill={color} opacity="0.4" />
          <path d="M13 -3.4 L22 -7.5 L22 7.5 L13 3.4 Z" fill={color} opacity="0.4" />
          {/* 折痕：从拧结处往外发散的两三根 */}
          <path d="M-14 -2 L-20 -5 M-14 2 L-20 5" stroke="#fff" strokeWidth="0.7" opacity="0.32" />
          <path d="M14 -2 L20 -5 M14 2 L20 5" stroke="#fff" strokeWidth="0.7" opacity="0.32" />
          {/* 身子：椭圆，先一层淡的当"背面"，再叠正面 */}
          <ellipse cx="0" cy="0" rx="13" ry="8.6" fill={color} opacity="0.5" />
          <ellipse cx="0" cy="-0.8" rx="12" ry="7.4" fill={color} opacity="0.3" />
          {/* 中间的蝴蝶结：两片小三角 + 结心 */}
          <path d="M0 0 L-6 -5.6 L-6 5.6 Z" fill={color} opacity="0.9" />
          <path d="M0 0 L6 -5.6 L6 5.6 Z" fill={color} opacity="0.9" />
          <path d="M0 0 L-6 -5.6 L-6 5.6 Z" fill="#fff" opacity="0.18" />
          <circle cx="0" cy="0" r="1.7" fill="#fff" opacity="0.75" />
          {/* 上半的高光（光从左上来） */}
          <ellipse cx="-4.2" cy="-3.4" rx="4.6" ry="2.3" fill="#fff" opacity="0.5" />
          {/* 底部的接触暗（坐得住的重量感） */}
          <path d="M-9 6 C-4 8.4, 4 8.4, 9 6" fill="none" stroke={color} strokeWidth="1.6" opacity="0.35" />
        </g>
      </g>
    );
  }

  return (
    <svg
      viewBox="0 0 150 152"
      aria-hidden="true"
      className={cn("pointer-events-none absolute", className)}
    >
      <defs>
        <linearGradient id="jarBody" x1="0" y1="0" x2="1" y2="0">
          {/* 左右内壁亮、中间几乎全透 —— 玻璃的横截面反光 */}
          <stop offset="0%" stopColor="var(--decor)" stopOpacity="0.26" />
          <stop offset="14%" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="30%" stopColor="var(--decor)" stopOpacity="0.04" />
          <stop offset="55%" stopColor="var(--decor)" stopOpacity="0.015" />
          <stop offset="78%" stopColor="var(--decor)" stopOpacity="0.05" />
          <stop offset="92%" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="100%" stopColor="var(--decor)" stopOpacity="0.26" />
        </linearGradient>
      </defs>

      {/* 罐子的接触投影 —— 它"坐"在卡片上 */}
      <ellipse cx="78" cy="141" rx="42" ry="6.5" fill="var(--decor)" opacity="0.12" />

      <g className="aster-breathe">
        {/* 盖子：顶面是个**椭圆**（这就是俯视透视），侧面一条窄带，下面一圈厚沿 */}
        <ellipse cx="78" cy="24" rx="27" ry="6" fill="var(--decor)" opacity="0.14" />
        <path
          d="M51 24 V31 C51 34.5, 63 37, 78 37 C93 37, 105 34.5, 105 31 V24 Z"
          fill="var(--decor)"
          opacity="0.1"
        />
        <ellipse
          cx="78"
          cy="24"
          rx="27"
          ry="6"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="0.7"
          strokeOpacity="0.3"
        />
        <ellipse
          cx="78"
          cy="35"
          rx="30"
          ry="6.5"
          fill="var(--decor)"
          opacity="0.1"
          stroke="var(--decor)"
          strokeWidth="0.7"
          strokeOpacity="0.26"
        />

        {/* 罐身：口沿椭圆 → 收一点腰 → 肚子最鼓 → 平底（上窄下圆，矮胖） */}
        <path
          d="M48 38 C48 38, 42 56, 42 82 C42 108, 49 128, 60 133 C68 136.5, 88 136.5, 96 133 C107 128, 114 108, 114 82 C114 56, 108 38, 108 38"
          fill="url(#jarBody)"
          stroke="var(--decor)"
          strokeWidth="1"
          strokeOpacity="0.34"
        />
        {/* 底沿：一条略弯的厚边（玻璃的厚度） */}
        <path
          d="M55 129 C64 134, 92 134, 101 129"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="1.6"
          opacity="0.22"
        />
        <ellipse
          cx="78"
          cy="38"
          rx="30"
          ry="5"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="0.7"
          strokeOpacity="0.24"
        />

        {/* 内壁高光：左边一条长白，右边一小段（光从左上来） */}
        <path d="M52 56 V116" stroke="#fff" strokeWidth="3" opacity="0.32" strokeLinecap="round" />
        <path d="M104 70 V98" stroke="#fff" strokeWidth="1.4" opacity="0.16" strokeLinecap="round" />

        {/*
          罐里的糖果：**从下往上堆**，越上面的越小、越靠后（就是透视）——
          这样才有"装了一罐"的量感，而不是几颗飘着。
        */}
        <g>
          {/* 最底层（最大、最前、最暗一点 = 近处） */}
          <Candy x={64} y={122} s={1.02} color={C.lilac} tilt={-6} />
          <Candy x={94} y={124} s={0.98} color={C.rose} tilt={10} />
          <Candy x={80} y={112} s={1.06} color={C.peach} tilt={-3} />
          {/* 中层 */}
          <Candy x={58} y={100} s={0.94} color={C.mint} tilt={16} squash={0.88} />
          <Candy x={98} y={102} s={0.9} color={C.lemon} tilt={-14} squash={0.9} />
          <Candy x={78} y={94} s={0.96} color={C.rose} tilt={4} />
          {/* 上层（更小、更淡 = 更远） */}
          <Candy x={66} y={80} s={0.82} color={C.lemon} tilt={-22} squash={0.86} />
          <Candy x={92} y={82} s={0.78} color={C.lilac} tilt={18} squash={0.84} />
          <Candy x={80} y={70} s={0.72} color={C.mint} tilt={-8} squash={0.9} />
          {/* 顶上一颗，贴着罐颈 */}
          <Candy x={74} y={58} s={0.6} color={C.peach} tilt={12} squash={0.84} />
        </g>
      </g>

      {/* 罐外散落的几颗：各有自己的小投影，方向不一致（散落的自然感） */}
      <g>
        <ellipse cx="134" cy="135" rx="9" ry="2.2" fill="var(--decor)" opacity="0.09" />
        <Candy x={134} y={128} s={0.78} color={C.rose} tilt={22} />
        <Candy x={18} y={134} s={0.68} color={C.mint} tilt={-18} />
        <Candy x={148} y={104} s={0.58} color={C.lemon} tilt={38} squash={0.86} />
        {/* 一颗侧躺的（身体压扁 = 侧视） */}
        <Candy x={30} y={106} s={0.62} color={C.lilac} tilt={-40} squash={0.6} />
      </g>
    </svg>
  );
}
