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
 * ── 用户拿手绘给我讲明白的（第四版才对）────────────────────────
 *
 * "边框不应该**包住**组件里面的东西吗，你反着来，不就像一个正 C 和一个反 C 吗，
 *  我们要的不应该是**两个 C 能合起来**吗，不然为啥叫边框"
 *
 * 两个错误：
 *   ① **朝向全反了**。正解：
 *        左上 —— 从左边过来 → 沿**上边往右**走，再沿**左边往下**走
 *        右下 —— 从右边过来 → 沿**下边往左**走，再沿**右边往上**走
 *      也就是两个 C 的**胳膊朝内对着伸**，合起来围成一圈。
 *      我之前是往外甩的（正 C / 反 C）。
 *   ② **没贴边**。线要**贴着组件边沿**走（"包住"），不是飘在卡片里面。
 *
 * 所以这里把锚点放在 (0,0)：波浪的外侧正好落在卡片边上，
 * 波峰只往**内**鼓（不往外），右下角靠 scale(-1,-1) 镜像。
 */
export function CornerWave({
  className,
  corner = "tl",
}: {
  className?: string;
  corner?: "tl" | "br";
}) {
  /** 一段波浪：`from`→`to` 沿主轴，`at` 是另一轴的位置（0 = 贴边），`amp` 往内鼓 */
  const wave = (from: number, to: number, at: number, amp: number, horiz: boolean) => {
    const steps = 3;
    const len = (to - from) / steps;
    let d = "";
    for (let i = 0; i < steps; i++) {
      const a = from + len * i;
      const b = a + len;
      const c1 = a + len * 0.35;
      const c2 = b - len * 0.35;
      // 单向鼓包（都在 at 的同一侧 = 往内），不是来回摆 —— 来回摆就成了"蚯蚓"
      const off = at + amp;
      if (horiz) {
        d += ` C ${c1.toFixed(1)} ${off.toFixed(1)}, ${c2.toFixed(1)} ${off.toFixed(1)}, ${b.toFixed(1)} ${at}`;
      } else {
        d += ` C ${off.toFixed(1)} ${c1.toFixed(1)}, ${off.toFixed(1)} ${c2.toFixed(1)}, ${at} ${b.toFixed(1)}`;
      }
    }
    return d;
  };

  /*
    viewBox 130×104，锚点 (0,0) 就是卡片的左上角：
      上边那条：从 (0,6) 往右到 x=78，往内鼓 7
      转角：一条内收的弧（贴着圆角走）
      左边那条：从 (6,26) 往下到 y=100，往内鼓 7
  */
  const d =
    `M 0 6` +
    wave(6, 78, 6, 7, true) +
    // 贴着卡片圆角拐过去（控制点都往里收，才是"包"）
    ` C 92 6, 102 16, 104 30` +
    wave(30, 100, 6, 7, false);

  const transform = corner === "br" ? "scale(-1,-1) translate(-130 -104)" : undefined;

  return (
    /*
      外面再套一层：往里缩 3（用 +3 而不是负的 —— 负的会把线推到卡片外面，
      被卡片边裁掉，第一版就是这样少了半截）。
      线本身在 (0,0) 起步，缩 3 之后就贴着边沿了。
    */
    <svg
      viewBox="-3 -3 136 110"
      aria-hidden="true"
      className={cn("pointer-events-none absolute text-[color:var(--decor)]", className)}
    >
      <g transform={transform}>
        {/* 主波浪：贴着边、往内鼓，加粗到 1.5 */}
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeOpacity="0.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* 内侧跟一条更淡更细的，做出丝带的厚度 */}
        <path
          d={d}
          fill="none"
          stroke="#fff"
          strokeWidth="0.8"
          strokeOpacity="0.3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          transform="translate(2.4 2.4)"
        />
      </g>
    </svg>
  );
}

/**
 * 卡片顶边那条**直线**（在用户画橙色横线的位置）。
 *
 * 用户："第一个现在我也不要求波浪了，你看我画的黄色的那条线……你就在我画的
 * 横线上加一条横线就行了，位置和大小我也画好了，材质和厚度如上"。
 * —— 所以不要波浪，就一条直的；长度和位置对着他画的那条来。
 */
export function TopLine({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("pointer-events-none absolute text-[color:var(--decor)]", className)}
    >
      <path
        d="M 0 6 H 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* 内侧跟一条更淡更细的，厚度感跟角上那条一致 */}
      <path
        d="M 0 8 H 100"
        fill="none"
        stroke="#fff"
        strokeWidth="0.8"
        strokeOpacity="0.28"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * 一朵**小花**（替换贝壳）。
 *
 * 用户："那个贝壳算了，你也画不好，你就在我那个时间组件里的画的那个圆上
 * 画一朵小花，这个你总会画吧"。
 *
 * 五瓣花：每瓣一个椭圆，绕中心均分 72°；花心一个小圆 + 一点点花蕊。
 * 不追求写实，简单干净就好 —— 反正是装饰。
 */
export function Flower({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={cn("pointer-events-none absolute", className)}
    >
      <g className="aster-flower-breathe">
        {/* 五片花瓣：绕中心均分，从正上方开始 */}
        {[0, 72, 144, 216, 288].map((deg) => (
          <ellipse
            key={deg}
            cx="50"
            cy="28"
            rx="13"
            ry="21"
            fill="var(--decor)"
            opacity="0.24"
            stroke="var(--decor)"
            strokeWidth="0.6"
            strokeOpacity="0.3"
            transform={`rotate(${deg} 50 50)`}
          />
        ))}
        {/* 花瓣上再叠一层更小的，做出层次（像真花的内层） */}
        {[36, 108, 180, 252, 324].map((deg) => (
          <ellipse
            key={`in${deg}`}
            cx="50"
            cy="34"
            rx="9"
            ry="14"
            fill="#fff"
            opacity="0.24"
            transform={`rotate(${deg} 50 50)`}
          />
        ))}
        {/* 花心 */}
        <circle cx="50" cy="50" r="8" fill="var(--decor)" opacity="0.3" />
        <circle cx="50" cy="50" r="8" fill="none" stroke="var(--decor)" strokeWidth="0.6" strokeOpacity="0.35" />
        {/* 花蕊：几颗小点 */}
        <g fill="#fff" opacity="0.5">
          <circle cx="47" cy="48" r="1.2" />
          <circle cx="53" cy="49" r="1" />
          <circle cx="50" cy="53" r="1.1" />
        </g>
      </g>
    </svg>
  );
}

export function ButterflyWings({ className }: { className?: string }) {
  const wings = `
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
  `;

  return (
    <svg
      viewBox="0 0 180 130"
      aria-hidden="true"
      className={cn("pointer-events-none absolute", className)}
    >
      <defs>
        <radialGradient id="wingG2" cx="72%" cy="50%" r="72%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="26%" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="58%" stopColor="var(--decor)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--decor)" stopOpacity="0.05" />
        </radialGradient>
      </defs>

      <g transform="rotate(-13 88 62) skewY(-2.5)">
        <g className="aster-flutter">
          <path d={wings} fill="url(#wingG2)" />
          {/* 发光边 */}
          <path d={wings} fill="none" stroke="#fff" strokeWidth="0.8" opacity="0.4" />
          {/* 翅脉：从中间（原来身体的位置）散出去 */}
          <g fill="none" stroke="#fff" strokeLinecap="round">
            <path d="M84 62 C64 48, 40 30, 22 22" strokeWidth="0.9" opacity="0.42" />
            <path d="M84 64 C62 66, 38 76, 26 88" strokeWidth="0.8" opacity="0.34" />
            <path d="M92 62 C112 48, 136 30, 154 22" strokeWidth="0.9" opacity="0.38" />
            <path d="M92 64 C114 66, 138 76, 150 88" strokeWidth="0.8" opacity="0.3" />
          </g>
          {/* 中间那层柔光（代替身体，把四片"粘"在一起） */}
          <ellipse cx="88" cy="64" rx="15" ry="11" fill="#fff" opacity="0.22" />
        </g>
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


