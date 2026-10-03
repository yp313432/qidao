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
 * 卡片角上那道**波浪半包**（只包左上 + 右下两个角）。
 *
 * 用户（改了第三版才对）："**半包**啊D老师，不是全边框，左上和右下有就行了，
 * 而且**波纹太细了**"。
 *
 * 之前的两次错误：
 *   第一版 → 画成了直角折线（他说"要波浪"）
 *   第二版 → 画成了**绕一圈的全边框**（他说"半包就行"）
 * 正解：一条**波浪线**，从角上探进去、拐个弯再收掉，**只覆盖一段**。
 *
 * 线也加粗了（原来 0.7 / 0.3 太细看不出来），现在 1.6 / 0.5。
 * 用 `non-scaling-stroke` 保证拉到任何卡片尺寸都不被拉粗。
 */
export function CornerWave({
  className,
  corner = "tl",
}: {
  className?: string;
  corner?: "tl" | "br";
}) {
  /** 一段波浪：`from`→`to` 沿主轴，`at` 是另一轴的位置，`amp` 是波幅 */
  const wave = (from: number, to: number, at: number, amp: number, horiz: boolean) => {
    const steps = 4;
    const len = (to - from) / steps;
    let d = "";
    for (let i = 0; i < steps; i++) {
      const a = from + len * i;
      const b = a + len;
      // 两段 C 拼一个完整的波峰 + 波谷（半个波长一段）
      const c1 = a + len * 0.35;
      const c2 = b - len * 0.35;
      const dy = i % 2 === 0 ? -amp : amp;
      if (horiz) {
        d += ` C ${c1.toFixed(1)} ${(at + dy).toFixed(1)}, ${c2.toFixed(1)} ${(at + dy).toFixed(1)}, ${b.toFixed(1)} ${at}`;
      } else {
        d += ` C ${(at + dy).toFixed(1)} ${c1.toFixed(1)}, ${(at + dy).toFixed(1)} ${c2.toFixed(1)}, ${at} ${b.toFixed(1)}`;
      }
    }
    return d;
  };

  /*
    viewBox 120×96，只画左上那一块：
      横边从左往右（y≈8，波幅 6）到 x≈72 → 圆角拐弯 → 竖边往下（x≈112，波幅 6）到 y≈88
    右下角靠 scale(-1,-1) 镜像，不用画两份。
  */
  const d =
    `M 8 8` +
    wave(8, 72, 8, 5.5, true) +
    // 转角（往内收一点，像"包"过来的感觉）
    ` C 84 8, 92 12, 98 18` +
    wave(20, 86, 112, 5.5, false);

  const transform = corner === "br" ? "scale(-1,-1) translate(-120 -96)" : undefined;

  return (
    <svg
      viewBox="0 0 120 96"
      aria-hidden="true"
      className={cn("pointer-events-none absolute text-[color:var(--decor)]", className)}
    >
      <g transform={transform}>
        {/* 主波浪：加粗到 1.6，透明度 0.5 */}
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeOpacity="0.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* 内侧再跟一条更淡更细的，做出"丝带"的厚度感 */}
        <path
          d={d}
          fill="none"
          stroke="#fff"
          strokeWidth="0.9"
          strokeOpacity="0.3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          transform="translate(2.2 2.2)"
        />
      </g>
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
      viewBox="0 0 180 150"
      aria-hidden="true"
      className={cn("pointer-events-none absolute", className)}
    >
      <defs>
        {/*
          渐变全部**从身体附近向外**发散 —— 这是关键：
          上一版四片各用一条线性渐变，结果四片颜色/走向都不一样，
          看着就是"四个独立的水滴"。现在统一从根部（右上）出发，
          四片才是**同一只蝴蝶的翅膀**。
        */}
        <radialGradient id="wingG" cx="72%" cy="52%" r="72%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="26%" stopColor="#fff" stopOpacity="0.52" />
          <stop offset="58%" stopColor="var(--decor)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--decor)" stopOpacity="0.06" />
        </radialGradient>
      </defs>

      {/* 向左微斜 + 一点点侧身的透视 */}
      <g transform="rotate(-13 88 70) skewY(-2.5)">
        {/* 丝带（在最后面） */}
        <g fill="none" stroke="var(--decor)" strokeLinecap="round" className="aster-drift">
          <path d="M80 96 C66 112, 44 120, 30 136" strokeWidth="0.9" opacity="0.26" />
          <path d="M86 98 C74 116, 54 126, 44 142" strokeWidth="0.6" opacity="0.16" />
        </g>

        <g className="aster-flutter">
          {/*
            **一整块连体的翅膀轮廓**（不是四片分开的 path）。
            从身体根部出发：左上翅 → 收回来 → 左下翅 → 回到根部 →
            右下翅 → 收回来 → 右上翅 → 闭合。
            这样轮廓是一整条，翅膀之间没有缝，就不像"四个水滴"了。
          */}
          <path
            d="
              M 84 62
              C 74 34, 46 14, 24 14
              C 8 14, 6 30, 18 44
              C 26 53, 40 60, 50 64
              C 34 70, 18 82, 22 96
              C 26 110, 46 106, 62 94
              C 72 87, 80 76, 84 66
              L 92 66
              C 96 76, 104 87, 114 94
              C 130 106, 150 110, 154 96
              C 158 82, 142 70, 126 64
              C 136 60, 150 53, 158 44
              C 170 30, 168 14, 152 14
              C 130 14, 102 34, 92 62
              Z
            "
            fill="url(#wingG)"
          />
          {/* 翅膀边缘一圈极淡的亮线 = 发光边（也是把整体"框住"，更像一只） */}
          <path
            d="
              M 84 62
              C 74 34, 46 14, 24 14
              C 8 14, 6 30, 18 44
              C 26 53, 40 60, 50 64
              C 34 70, 18 82, 22 96
              C 26 110, 46 106, 62 94
              C 72 87, 80 76, 84 66
              L 92 66
              C 96 76, 104 87, 114 94
              C 130 106, 150 110, 154 96
              C 158 82, 142 70, 126 64
              C 136 60, 150 53, 158 44
              C 170 30, 168 14, 152 14
              C 130 14, 102 34, 92 62
              Z
            "
            fill="none"
            stroke="#fff"
            strokeWidth="0.8"
            opacity="0.4"
          />

          {/*
            翅脉：**减少到 4 条**，而且都从根部一点散出去。
            上一版 8 条线各画各的 → 看着就是"三条线"。
          */}
          <g fill="none" stroke="#fff" strokeLinecap="round">
            <path d="M84 62 C64 48, 40 30, 22 22" strokeWidth="0.9" opacity="0.42" />
            <path d="M84 64 C62 66, 38 76, 26 88" strokeWidth="0.8" opacity="0.34" />
            <path d="M92 62 C112 48, 136 30, 154 22" strokeWidth="0.9" opacity="0.38" />
            <path d="M92 64 C114 66, 138 76, 150 88" strokeWidth="0.8" opacity="0.3" />
          </g>

          {/* 根部一层柔光，把四片"粘"在身体上 */}
          <ellipse cx="88" cy="64" rx="16" ry="12" fill="#fff" opacity="0.2" />
        </g>

        {/* 身体：细长一点，不再是粗线 */}
        <path d="M88 48 C86 58, 86 70, 88 82" stroke="#fff" strokeWidth="1.6" opacity="0.55" fill="none" strokeLinecap="round" />
        <path d="M88 48 C86 58, 86 70, 88 82" stroke="var(--decor)" strokeWidth="0.6" opacity="0.4" fill="none" strokeLinecap="round" />
        {/* 触角 */}
        <path
          d="M88 48 C83 36, 76 28, 67 24 M88 48 C93 36, 100 28, 109 24"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="0.6"
          opacity="0.4"
          strokeLinecap="round"
        />
        <circle cx="88" cy="62" r="3.4" fill="#fff" opacity="0.3" />
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
      <ellipse cx="78" cy="141" rx="44" ry="6.5" fill="var(--decor)" opacity="0.12" />

      <g className="aster-breathe">
        {/*
          **圆柱罐 + 盖**（用户："玻璃罐改成圆柱那种吧，上面是盖子"）。
          圆柱的关键就是：**上下两个椭圆 + 两条直的侧壁**。
          上一版罐身在腰部鼓出来（像个坛子），所以看着还是怪。
        */}
        {/* 盖：顶面椭圆 + 一圈侧沿 + 一个小提钮 */}
        <ellipse cx="78" cy="20" rx="30" ry="7" fill="var(--decor)" opacity="0.13" />
        <path
          d="M48 20 V30 C48 34, 62 37, 78 37 C94 37, 108 34, 108 30 V20 Z"
          fill="var(--decor)"
          opacity="0.09"
        />
        <ellipse
          cx="78"
          cy="20"
          rx="30"
          ry="7"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="0.8"
          strokeOpacity="0.34"
        />
        <ellipse
          cx="78"
          cy="30"
          rx="30"
          ry="7"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="0.8"
          strokeOpacity="0.3"
        />
        {/* 提钮 */}
        <ellipse cx="78" cy="14" rx="7" ry="3.4" fill="var(--decor)" opacity="0.16" />
        <ellipse
          cx="78"
          cy="14"
          rx="7"
          ry="3.4"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="0.6"
          strokeOpacity="0.32"
        />

        {/* 罐身：**两条直侧壁** + 底部椭圆（圆柱） */}
        <path
          d="M48 34 V124 C48 131, 61 136, 78 136 C95 136, 108 131, 108 124 V34"
          fill="url(#jarBody)"
          stroke="var(--decor)"
          strokeWidth="1"
          strokeOpacity="0.34"
        />
        {/* 底部椭圆：圆柱的底（透视） */}
        <path
          d="M48 124 C48 131, 61 136, 78 136 C95 136, 108 131, 108 124"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="1.5"
          opacity="0.2"
        />
        {/* 罐口椭圆 */}
        <ellipse
          cx="78"
          cy="34"
          rx="30"
          ry="6"
          fill="none"
          stroke="var(--decor)"
          strokeWidth="0.7"
          strokeOpacity="0.26"
        />

        {/* 圆柱内壁的两条竖向高光（左长右短，光从左上来） */}
        <path d="M55 52 V118" stroke="#fff" strokeWidth="3" opacity="0.32" strokeLinecap="round" />
        <path d="M101 64 V100" stroke="#fff" strokeWidth="1.4" opacity="0.16" strokeLinecap="round" />

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
