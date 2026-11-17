import { useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/page-header";
import { KButton, KEmpty } from "@/components/ui-kit";
import { summarizeNow } from "@/lib/summarizer";
import { summaryEntries } from "@/lib/summary-library";
import { useApp } from "@/lib/store";
import { materialOf } from "@/lib/material";

export function SummaryList() {
  const conversations = useApp((state) => state.conversations);
  const activeId = useApp((state) => state.activeId);
  const liquid = useApp((state) => materialOf(state.settings) === "liquid");
  const surface = liquid ? "lq-glass" : "border border-line bg-elevated";
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const source = useRouterState({ select: (state) => state.location.hash });
  const [selected, setSelected] = useState<string | null>(null);
  const entries = summaryEntries(conversations);
  const needle = query.trim().toLowerCase();
  const visible = entries.filter(({ title, summary }) =>
    (title + "\n" + summary.text).toLowerCase().includes(needle),
  );
  const active = conversations.find((conversation) => conversation.id === activeId);

  async function summarize() {
    if (!active || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const text = await summarizeNow(active.id);
      if (!text) {
        setNotice("当前会话没有可保存的新摘要。");
        return;
      }
      setQuery("");
      const newest = summaryEntries(useApp.getState().conversations)
        .find((entry) => entry.conversationId === active.id && entry.latest);
      setSelected(newest?.id ?? "");
      setNotice("摘要已保存。");
    } catch {
      setNotice("摘要生成失败，可以重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader title="摘要库" />
      <div className="space-y-4 px-4">
        <KButton onClick={() => void navigate({ to: "/play/plugins" })}>返回插件</KButton>
        <label className="block">
          <span className="sr-only">搜索摘要</span>
          <input className={`w-full rounded-xl px-4 py-3 ${surface}`}
            value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索摘要" />
        </label>
        <KButton disabled={busy || !active || active.incognito} onClick={() => void summarize()}>
          {busy ? "正在写摘要…" : "让 AI 写摘要"}
        </KButton>
        {notice && <p role="status" className="text-sm text-subtle">{notice}</p>}
        {!visible.length && <KEmpty title={needle ? "没有匹配的摘要" : "还没有摘要"} />}
        <ol className="mx-auto max-w-xl">
          {visible.map(({ id, title, summary }, index) => {
            const left = index % 2 === 0;
            const open = (selected ?? source) === id;
            return (
              <li key={id} id={id} className="relative pb-10">
                {index < visible.length - 1 && (
                  <div aria-hidden="true"
                    className={`pointer-events-none absolute inset-y-4 left-5 right-5 rounded-[48%] border-line ${left ? "border-l-2 border-b-2" : "border-r-2 border-b-2"}`} />
                )}
                <button type="button" aria-expanded={open}
                  onClick={() => setSelected(open ? "" : id)}
                  className={`relative block w-[85%] rounded-2xl px-4 py-3 text-left ${surface} ${left ? "" : "ml-auto"}`}>
                  <time className="block text-xs text-subtle" dateTime={new Date(summary.updatedAt).toISOString()}>
                    {new Date(summary.updatedAt).toLocaleString("zh-CN")}
                  </time>
                  <span className="block font-serif">{title || "未命名会话"}</span>
                  <span className="mt-1 block text-sm text-subtle">{summary.text.slice(0, 68)}</span>
                </button>
                {open && <div className={`relative mt-2 whitespace-pre-wrap rounded-2xl p-4 ${surface}`}>
                  <p className="mb-2 text-xs text-subtle">
                    对话消息 {(summary.fromIndex ?? 0) + 1}–{summary.upToIndex}
                  </p>
                  {summary.text}
                </div>}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
