import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Search, Sparkles, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { summarizeNow } from "@/lib/summarizer";
import { summaryEntries } from "@/lib/summary-library";
import { useApp } from "@/lib/store";
import { chatFontPx } from "@/lib/ux";
import "./summary-list.css";

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

export function SummaryList() {
  const conversations = useApp((state) => state.conversations);
  const activeId = useApp((state) => state.activeId);
  const fontSize = useApp((state) => chatFontPx(state.settings.chatFontSize));
  const source = useRouterState({ select: (state) => state.location.hash });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<{ source: string; id: string }>();
  const dialog = useRef<HTMLDialogElement>(null);
  const entries = useMemo(() => summaryEntries(conversations), [conversations]);
  const needle = query.trim().toLowerCase();
  const visible = entries.filter(({ title, summary }) =>
    [title, summary.title, summary.text].join("\n").toLowerCase().includes(needle),
  );
  const selectedId = selection?.source === source ? selection.id : source;
  const selected = entries.find((entry) => entry.id === selectedId);
  const active = conversations.find((conversation) => conversation.id === activeId);

  useEffect(() => {
    if (!dialog.current) return;
    if (!selectedId || !dialog.current.querySelector("[data-summary-body]")) {
      dialog.current.close();
      return;
    }
    if (!dialog.current.open) dialog.current.showModal();
    dialog.current.querySelector("[data-summary-body]")?.scrollTo(0, 0);
  }, [selectedId, selected?.id]);

  function close() {
    dialog.current?.close();
    setSelection({ source, id: "" });
  }

  async function summarize() {
    if (!active || busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (!(await summarizeNow(active.id))) {
        setNotice("当前会话没有可保存的新摘要。");
        return;
      }
      setQuery("");
      const newest = summaryEntries(useApp.getState().conversations)
        .find((entry) => entry.conversationId === active.id && entry.latest);
      setSelection({ source, id: newest?.id ?? "" });
      setNotice("摘要已保存。");
    } catch {
      setNotice("摘要生成失败，可以重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="summary-library flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ fontSize }}>
      <PageHeader title="摘要库" />
      <div className="summary-library__content">
        <div className="summary-library__actions">
          <label>
            <Search size={16} aria-hidden="true" />
            <input type="search" aria-label="搜索摘要" value={query}
              onChange={(event) => setQuery(event.target.value)} placeholder="搜索摘要" />
          </label>
          <button type="button" disabled={busy || !active || active.incognito} onClick={() => void summarize()}>
            <Sparkles size={16} aria-hidden="true" />
            {busy ? "正在写摘要…" : "让 AI 写摘要"}
          </button>
        </div>
        {notice && <p role="status">{notice}</p>}
        {!visible.length && <p className="summary-library__empty">{needle ? "没有匹配的摘要" : "还没有摘要"}</p>}
        <ol className="summary-library__trail">
          {visible.map(({ id, summary }, index) => (
            <li key={id} id={id} data-side={index % 2 ? "right" : "left"}>
              {index < visible.length - 1 && (
                <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path d={index % 2
                    ? "M 78 0 C 78 52, 22 48, 22 100"
                    : "M 22 0 C 22 52, 78 48, 78 100"} />
                </svg>
              )}
              <button type="button" aria-haspopup="dialog" data-lit={id === selectedId}
                onClick={() => setSelection({ source, id })}>
                <i aria-hidden="true" />
                <span>
                  <strong>{summary.title || "旧摘要"}</strong>
                  <time>{dateFormat.format(summary.updatedAt)}</time>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <dialog ref={dialog} className="summary-library__dialog" aria-labelledby="summary-reading-title"
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        {selected && (
          <div className="summary-library__reading">
            <header>
              <div>
                <h2 id="summary-reading-title">{selected.summary.title || "旧摘要"}</h2>
                <time>{dateFormat.format(selected.summary.updatedAt)}</time>
              </div>
              <button type="button" aria-label="关闭摘要" onClick={close}><X size={22} /></button>
            </header>
            <div data-summary-body tabIndex={0}>{selected.summary.text}</div>
          </div>
        )}
      </dialog>
    </section>
  );
}
