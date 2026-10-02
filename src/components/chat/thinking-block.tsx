import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 思考过程。
 *
 * 视觉上照用户给的参照改过：**不框起来**，小字，左侧一条细线做缩进，
 * 标题写成「已思考（用时 N 秒）」。
 * 原来是一个带边框的块、字还跟正文一样大 —— 用户原话："不好显示"。
 */
export function ThinkingBlock({
  thinking,
  durationMs,
  live,
}: {
  thinking: string;
  durationMs: number;
  live?: boolean;
}) {
  const [open, setOpen] = useState(live ?? false);
  const secs = Math.max(1, Math.round(durationMs / 1000));
  const label = live
    ? "正在思考…"
    : thinking
      ? `已思考（用时 ${secs} 秒）`
      : "已完成内部推理";

  return (
    // px-3.5 跟气泡一致；外面在 chat-view 里还会套一层 max-w-[86%]，
    // 这样思考链跟气泡的**左右两条边**都对得上（用户反馈过对不齐）
    <div className="mt-1 mb-1.5 px-3.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // 不加左内缩：整块（含下面那条竖线）跟气泡的左边缘对齐成一条线 ——
        // 原来这里多缩进了一点，看起来跟气泡错位（用户实测反馈）
        className="flex items-center gap-1.5 text-[0.8em] text-subtle"
      >
        <span className={cn(live && "thinking-shimmer")}>{label}</span>
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-1.5 border-l border-line pl-3 text-[0.8em] leading-[1.7] whitespace-pre-wrap text-subtle">
          {thinking || (live ? "梳理问题、组织回答…" : "模型完成了内部推理，明文思考链未返回；时长已记录。")}
        </div>
      )}
    </div>
  );
}
