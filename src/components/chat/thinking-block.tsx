import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

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
    ? "正在思考"
    : thinking
      ? `思考了 ${secs} 秒`
      : "已完成内部推理";

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[13px] text-muted"
      >
        <span className={cn(live && "thinking-shimmer")}>{label}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line bg-chip/60 px-3 py-2 text-[13px] leading-6 text-muted whitespace-pre-wrap">
          {thinking || (live ? "梳理问题、组织回答…" : "模型完成了内部推理，明文思考链未返回；时长已记录。")}
        </div>
      )}
    </div>
  );
}
