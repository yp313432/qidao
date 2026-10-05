import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 一行**放不下就自己往左滚**的小字（跑马灯）。
 *
 * 用户："点开展示吧，或者你能做成那种滚动的吗？就是字往左滚动显示全文，
 *       如果做不了的话，就用点击展开吧。"
 *
 * 能做，而且比点击展开好：不占地方、不用操作。
 *
 * ── 几个刻意的选择 ────────────────────────────────────────────
 *  · **只在放不下时才滚**：短句子居中静止。什么都滚会晕。
 *  · **速度恒定**：时长按文字宽度算（约 36px/秒），长句子滚得久、但不会更快。
 *  · **两端各停一下**：开头和结尾各留 12% 的停顿，读者能看清首尾。
 *  · 动效开关（html[data-motion]）一关就静止 —— 全局那套降级规则自动生效。
 */
export function Ticker({
  text,
  className,
  prefix,
}: {
  text: string;
  className?: string;
  /** 前面那个小标签（比如"小克 现在知道"），不参与滚动 */
  prefix?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [dist, setDist] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    const el = textRef.current;
    if (!box || !el) return;

    const measure = () => {
      // 文字比容器宽多少 → 就要往左滚多少
      const over = el.scrollWidth - box.clientWidth;
      if (over > 4) {
        setDist(over);
        // 恒定速度：约 36px/秒；再给两端停顿留点时间（12%×2）
        setDur(Math.max(7, (over / 36) * 1.28));
      } else {
        setDist(0);
        setDur(0);
      }
    };

    measure();
    // 字体加载完宽度会变，再量一次
    void document.fonts?.ready.then(measure).catch(() => undefined);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [text]);

  const scrolling = dist > 0;

  /*
    ⚠️ 标签和正文必须在**同一个**滚动元素里。
    原来我把标签放在动画元素**外面**，于是标签钉在原地不动，
    而正文从它底下滚过去 → 两段字**重叠**（用户实测："跟着后面一起滚动，
    不然他不动，后面的动会重叠"）。
    现在合成一句整的，一起滚。
  */
  const full = prefix ? `${prefix} ${text}` : text;

  return (
    <div ref={boxRef} className={cn("min-w-0 overflow-hidden", className)}>
      <div className={cn("flex items-center", !scrolling && "justify-center")}>
        <span
          ref={textRef}
          className={cn(
            "whitespace-nowrap text-[10px] text-subtle",
            scrolling && "aster-ticker",
          )}
          style={
            scrolling
              ? ({
                  "--scroll-dist": `${dist}px`,
                  "--scroll-dur": `${dur}s`,
                } as React.CSSProperties)
              : undefined
          }
        >
          {full}
        </span>
      </div>
    </div>
  );
}
