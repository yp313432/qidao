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
 * P6 起多了一条**用户点名的规矩**（"执行结果那一栏永远有回话，别沉默"）：
 *   每一次调用都必然有一行结论 —— ✅ 成了 / ❌ 没成 / ⚠️ 没匹配上 / ⏳ 还在等确认。
 *   那一行来自 `tool-loop` 的 `notice`（跟回灌给模型的 tool 消息是同一个事实），
 *   这里只负责如实显示，**不美化失败、不吞掉"没匹配上"**。
 *
 * 样式复用思考链那颗胶囊（`bg-chip` + 胶囊圆角 + 11px），不新造玻璃层级。
 */
export function ToolProcess({ rounds }: { rounds: { round: number; calls: ToolCallRecord[] }[] }) {
  const [open, setOpen] = useState(false);
  const calls = rounds.flatMap((r) => r.calls);
  if (calls.length === 0) return null;

  const failed = calls.filter((c) => !c.ok).length;
  /** 名字压根不存在的调用（⚠️）—— 胶囊上单独提醒一句，这类最容易"看着像没啥事" */
  const unknown = calls.filter((c) => c.category === "unknown").length;

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
          {unknown > 0 ? `（${unknown} 次没匹配上）` : ""}
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
            /**
             * ⭐ 第一行就是**回话**：有 `notice` 用它（跟回给模型的是同一句），
             * 老存档没有这一格就按老样子拼一句 —— 但**绝不能没有这一行**。
             */
            const notice =
              c.notice ||
              `${c.ok ? "✅" : c.kind ? "❌" : "⚠️"} ${
                c.kind ? c.kind : `没有叫 ${c.name} 的动作（是不是名字写错了？）`
              }${c.ok ? "" : c.result ? ` · ${c.result}` : ""}`;
            return (
              <div key={`${c.name}-${i}`} className="text-[11px] leading-4">
                <p className={cn("font-medium", c.ok ? "text-muted" : "text-warn")}>{notice}</p>
                {/* 人话标题 + 上游给的原始工具名（排查"他瞎编了个名字"时看这个） */}
                <p className="mt-0.5 text-subtle">
                  {title}
                  <span className="ml-1 font-mono text-[10px]">{c.name}</span>
                </p>
                {c.args && (
                  <p className="mt-0.5 font-mono text-[10px] break-all text-subtle">
                    {c.args.length > 160 ? `${c.args.slice(0, 160)}…` : c.args}
                  </p>
                )}
                {/*
                  明细里的执行结果：`notice` 已经把它说完了就不重复第三遍
                  （老存档没有 notice 时才补这一行 —— 有回话是第一要求）。
                */}
                {c.result && !c.notice && (
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
