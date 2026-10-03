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


