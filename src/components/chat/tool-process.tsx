"use client";

import { useState } from "react";
import { Check, ChevronRight, TriangleAlert } from "lucide-react";
import { kindOfToolName } from "@/lib/action-schema";
import { toolCallTitle } from "@/lib/tool-title";
import type { ToolCallRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 「他刚才动了什么手、成没成」—— 挂在回复下面的一小颗胶囊，点开是明细。
 *
 * 为什么必须做（用户报过的原话）：
 *   "每次调用工具他说他没有回执，不知道自己到底用没用" +
 *   "他说他执行了，但是是空的" —— 两边对不上，而**动作闸门那张卡片是瞬时的**，
 *   点完就没了。事后回看这条回复，根本查不到他到底干了什么。
 *
 * 所以：原生 tools 每一轮的调用**存进这条消息里**（`ChatMessage.rounds`），
 * 这里如实显示 —— 成功的打勾、失败的标出来。**不美化失败**：
 * 这条规矩来自交接文档的 P5（"失败是静默的，这是最大差距"）。
 *
 * 样式复用思考链那颗胶囊（`bg-chip` + 胶囊圆角 + 11px），不新造玻璃层级。
 */
export function ToolProcess({ rounds }: { rounds: { round: number; calls: ToolCallRecord[] }[] }) {
  const [open, setOpen] = useState(false);
  const calls = rounds.flatMap((r) => r.calls);
  if (calls.length === 0) return null;

  const failed = calls.filter((c) => !c.ok).length;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full bg-chip px-3 py-1 text-[11px] text-muted"
      >
        {failed === 0 ? (
          <Check className="size-3 text-accent" strokeWidth={2} aria-hidden="true" />
        ) : (
          <TriangleAlert className="size-3 text-warn" strokeWidth={2} aria-hidden="true" />
        )}
        <span>
          动手 {calls.length} 次
          {failed > 0 ? `（${failed} 次没成）` : ""}
        </span>
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5 rounded-2xl border border-line bg-chip px-3.5 py-2.5">
          {calls.map((c, i) => {
            const kind = kindOfToolName(c.name);
            /** 认得的 kind 说人话（「切换到页面 /play/learn」），认不得就照原样报（模型瞎编的） */
            const title = toolCallTitle(kind, c.name, c.args);
            return (
              <div key={`${c.name}-${i}`} className="text-[11px] leading-4">
                <p className={cn("font-medium", c.ok ? "text-muted" : "text-warn")}>
                  {c.ok ? "✅" : "❌"} {title}
                  <span className="ml-1 font-mono text-[10px] text-subtle">{c.name}</span>
                </p>
                {c.args && (
                  <p className="mt-0.5 font-mono text-[10px] break-all text-subtle">
                    {c.args.length > 160 ? `${c.args.slice(0, 160)}…` : c.args}
                  </p>
                )}
                {c.result && (
                  <p className="mt-0.5 whitespace-pre-wrap text-subtle">{c.result}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
