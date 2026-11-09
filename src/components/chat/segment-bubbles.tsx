/**
 * **分段气泡**：他一次回复被切成几段时，一段一个 `.k-bubble`（口径见 `lib/segment.ts`）。
 *
 * 抽成独立组件有两个理由：
 *   ① `chat-view.tsx` 已经顶到结构棘轮（最大部件行数）上限，这段 JSX 本来就该独立；
 *   ② **流式与收尾必须长得一模一样** —— 用户 m06419 第 3 条报的就是
 *      "先出一整条、过一两秒才切成几条"，两边分开写就一定会走样。
 */
import type { HTMLAttributes } from "react";
import { Markdown } from "@/components/shared/markdown";
import { cn } from "@/lib/utils";

type Props = {
  parts: string[];
  /**
   * 最后一段是"正在写"的那段（流式期间）：
   * 只出**纯文本**、不解析 Markdown —— 每 100ms 重解析一遍越来越长的正文会卡。
   */
  liveTail?: boolean;
  /** 段间浮现的间隔（ms，用户在设置里调的那个旋钮） */
  delay?: number;
  /** 刚生成的那 20 秒内才播浮现动画；翻历史时内容应该是全的 */
  fresh: boolean;
  /** 段级清理（进 Markdown 之前） */
  cleanPart: (raw: string) => string;
  /** 流式尾巴的清理（纯文本，去内部标签） */
  cleanTail: (raw: string) => string;
  /** 长按出卡片那套手势（`quotePress` 的返回值） */
  press?: (raw: string) => Record<string, unknown>;
  /** 渲染出来是空壳就把这个元素藏掉（`hideIfRenderedEmpty`） */
  hideIfEmpty?: (el: HTMLDivElement | null) => void;
};

export function SegmentBubbles({
  parts,
  liveTail = false,
  delay,
  fresh,
  cleanPart,
  cleanTail,
  press,
  hideIfEmpty,
}: Props) {
  const tail = parts.length - 1;
  return (
    <div className="space-y-1.5">
      {parts.map((part, index) => {
        const isTail = liveTail && index === tail;
        /* 流式时只有"已经写完的段"才播浮现；收尾时每段都播 */
        const animate = fresh && (!liveTail || index < tail);
        const moved = animate && delay ? { animationDelay: `${index * delay}ms` } : undefined;
        return (
          <div
            key={index}
            ref={hideIfEmpty}
            {...(isTail || !press
              ? {}
              : (press(cleanPart(part)) as HTMLAttributes<HTMLDivElement>))}
            data-role="ai"
            className={cn(
              /* 与单气泡同壳（`.k-bubble`）；`bubble-in` 只动 opacity/transform，
                 浮签的 rotate 是独立属性，不会被按死 */
              "k-bubble w-max min-w-0 max-w-full select-none [-webkit-touch-callout:none] [touch-action:manipulation]",
              animate && "bubble-in",
            )}
            style={moved}
          >
            {isTail ? (
              <p className="bubble-text whitespace-pre-wrap break-words">{cleanTail(part)}</p>
            ) : (
              <Markdown text={cleanPart(part)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
