import { useState } from "react";
import { KButton } from "@/components/ui-kit";
import { cacheHitRate, summarizeUsage, type InputEstimate } from "@/lib/request-accounting";
import { prettyBytes } from "@/lib/tokens";
import type { RequestLogEntry } from "@/lib/types";
import { formatClock } from "@/lib/utils";

const purpose = (entry: RequestLogEntry) => ({ chat: "聊天", tool: "工具续答", continuation: "截断续写", recovery: "补充答案", summary: "回忆总结" }[entry.purpose ?? "chat"]);
const number = (value: number | undefined) => value === undefined ? "未返回" : value.toLocaleString();
const rate = (value: number | undefined) => value === undefined ? "未返回" : `${value.toFixed(1)}%`;
const labels: { key: keyof InputEstimate; label: string }[] = [
  { key: "system", label: "系统提示词（含常驻世界书与补充设定）" },
  { key: "tools", label: "原生工具定义" },
  { key: "history", label: "对话正文（含当前问题）" },
  { key: "dynamic", label: "动态注入（状态、权限、命中世界书、近期回执）" },
  { key: "summary", label: "摘要及其他系统消息" },
  { key: "toolResults", label: "工具结果消息" },
  { key: "reasoning", label: "回传的历史思考内容" },
  { key: "images", label: "图片（按每张 260 粗估）" },
  { key: "protocol", label: "调用记录及消息格式开销" },
];

function Breakdown({ entry }: { entry: RequestLogEntry }) {
  const input = entry.inputEstimate;
  if (!input) return <p className="k-hint mt-2">旧记录没有发送内容的分项估算，新请求会自动记录。</p>;
  const difference = entry.prompt === undefined ? undefined : entry.prompt - input.total;
  return <>
    <p className="mt-3 text-[13px] font-medium">本地发送 · 约 {input.total.toLocaleString()} tokens</p>
    <dl className="mt-2 space-y-1.5 text-[11px] leading-4 text-muted">
      {labels.map(({ key, label }) => <div key={key} className="flex justify-between gap-3">
        <dt>{label}</dt><dd className="shrink-0 tabular-nums">约 {number(input[key] as number)}</dd>
      </div>)}
    </dl>
    {Boolean(input.toolGroups?.length) && <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[11px] leading-4 text-muted">
      {input.toolGroups!.map((group) => <div key={group.id} className="flex justify-between gap-3">
        <dt>{group.label} · {group.count} 个</dt><dd className="shrink-0">约 {group.tokens.toLocaleString()}</dd>
      </div>)}
    </dl>}
    <p className="k-hint mt-2">按需查到的参数说明计入工具结果；读取的 Skill 正文也计入工具结果，不重复算作工具定义。</p>
    <p className="k-hint mt-3">{input.messageCount} 条消息 · {input.toolCount} 个原生工具 · 消息与工具正文 {prettyBytes(input.payloadBytes)}</p>
    {difference !== undefined && <p className="mt-2 text-[12px] leading-5">
      上游输入 − 本地估算：{difference > 0 ? "+" : ""}{difference.toLocaleString()} tokens
    </p>}
    <details className="mt-3">
      <summary className="cursor-pointer text-[12px] text-muted">系统提示词各段用量</summary>
      {input.sections.length ? <dl className="mt-2 space-y-1.5 text-[11px] leading-4 text-muted">
        {input.sections.map((section) => <div key={section.id} className="flex justify-between gap-3">
          <dt>{section.title}</dt><dd className="shrink-0">约 {section.tokens.toLocaleString()} · {section.chars.toLocaleString()} 字符</dd>
        </div>)}
      </dl> : <p className="k-hint mt-2">该请求的系统正文未匹配当前章节，保留系统总量。</p>}
    </details>
    <p className="k-hint mt-3 break-all">系统指纹 {entry.promptHash || "—"} · 工具指纹 {input.toolsHash} · 输入指纹 {input.inputHash}</p>
  </>;
}

/** 数字来自每次真正发送的消息，而不是按工具数量倒推；缺失 usage 不能显示成 0。 */
export function RequestUsage({ entries, onClear }: { entries: RequestLogEntry[]; onClear: () => void }) {
  const [scope, setScope] = useState<"reply" | "all">("reply");
  const latest = entries[0];
  const reply = latest?.replyId ? entries.filter((entry) => entry.replyId === latest.replyId) : entries.slice(0, 1);
  const selected = scope === "reply" ? reply : entries;
  const stats = summarizeUsage(selected);
  const latestRate = latest ? cacheHitRate(latest) : undefined;
  return <section className="mt-5">
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="k-sect__title">发送明细与上游用量</h2>
      {entries.length > 0 && <KButton onClick={onClear}>清空记录</KButton>}
    </div>
    <div className="k-card">
      {!latest ? <p className="k-hint">发一条消息后，显示每次请求的系统提示词、工具、对话和动态信息，以及上游返回的用量。</p> : <>
        <p className="text-[13px] font-medium">最近一次请求 · {purpose(latest)} · {formatClock(latest.at)}</p>
        <p className="k-hint mt-1 break-all">{latest.upstream || "旧记录"} · {latest.model}{latest.requestIndex ? ` · 本次回复第 ${latest.requestIndex} 次请求` : ""}</p>
        <p className="mt-3 text-[14px] leading-6">上游报告：输入 {number(latest.prompt)} · 输出 {number(latest.completion)}</p>
        <p className="mt-1 text-[12px] text-muted">缓存命中 {number(latest.cached)} tokens · 命中率 {rate(latestRate)}</p>
        <Breakdown entry={latest} />
      </>}
      <p className="k-hint mt-3">本地 token 为字符估算，不是模型的精确分词；上游数字来自接口 usage。差额可能来自分词、图片、计费口径或中转处理，不能直接认定为中转添加的提示词，也无法据此还原其内容。</p>
    </div>
    {latest && <div className="k-card mt-3">
      <div className="flex flex-wrap gap-2">
        <KButton variant={scope === "reply" ? "primary" : "default"} onClick={() => setScope("reply")} aria-pressed={scope === "reply"}>最近一次回复</KButton>
        <KButton variant={scope === "all" ? "primary" : "default"} onClick={() => setScope("all")} aria-pressed={scope === "all"}>全部记录</KButton>
      </div>
      <p className="mt-3 text-[13px] font-medium">{scope === "reply" ? "这次回复" : "已保留记录"} · {stats.count} 次请求</p>
      <p className="mt-2 text-[12px] leading-5">上游输入合计 {stats.known ? number(stats.prompt) : "未返回"} · 输出合计 {stats.outputKnown ? number(stats.completion) : "未返回"}</p>
      <p className="mt-1 text-[12px] text-muted">缓存命中率 {rate(stats.hitRate)} · 命中 {stats.cacheKnown ? number(stats.cached) : "未返回"} tokens</p>
      <p className="k-hint mt-2">输入用量已返回 {stats.known}/{stats.count} 次；缓存比例仅统计同时返回输入和命中量的 {stats.cacheKnown} 次请求。工具执行后再次请求模型，会再次计算输入。</p>
      {selected.some((entry) => entry.purpose === "summary") && <p className="k-hint mt-2">本合计含回忆总结请求；聊天消息下方只统计生成那次回答的请求。</p>}
      <p className="k-hint mt-2">同一上游与模型内，系统指纹变化 {stats.prefixChanges} 次，工具指纹变化 {stats.toolChanges} 次。指纹相同不代表服务商必然命中缓存。</p>
    </div>}
    {entries.length > 1 && <details className="k-card mt-3">
      <summary className="cursor-pointer text-[12px] text-muted">逐次请求记录（最近 {Math.min(entries.length, 12)} 次）</summary>
      <div className="mt-3 space-y-3">
        {entries.slice(0, 12).map((entry, index) => <details key={`${entry.replyId ?? entry.at}-${entry.requestIndex ?? index}`} className="border-t border-line pt-3">
          <summary className="cursor-pointer text-[12px] leading-5">
            {formatClock(entry.at)} · {purpose(entry)} · 输入 {number(entry.prompt)} · 输出 {number(entry.completion)} · 缓存 {rate(cacheHitRate(entry))}
          </summary>
          <p className="k-hint mt-2 break-all">{entry.upstream || "旧记录"} · {entry.model}</p>
          <Breakdown entry={entry} />
        </details>)}
      </div>
    </details>}
  </section>;
}
