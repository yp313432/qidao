import { useState } from "react";
import { Check, ListChecks, Plus, Trash2 } from "lucide-react";
import { SceneBackdrop } from "@/components/background-layer";
import { PlayHeader } from "@/components/play-header";
import { useApp } from "@/lib/store";
import { cn, formatClock, formatDay } from "@/lib/utils";

/** 待办：一件件要做的事。做完打勾留着，也可以一把清掉。 */
export function ToolsTodo() {
  const settings = useApp((s) => s.settings);
  const todos = useApp((s) => s.todos);
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(true);

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  function add() {
    const t = text.trim();
    if (!t) return;
    useApp.getState().addTodo(t);
    setText("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBackdrop image={settings.diaryImage} />
      <PlayHeader title="待办" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-above-nav">
        <p className="text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          things to do, softly
        </p>

        <div className="mt-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            aria-label="加一件待办"
            placeholder="要做什么…"
            className="min-w-0 flex-1 rounded-2xl bg-chip px-4 py-3 text-[14px] outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            aria-label="加一件"
            onClick={add}
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ink text-ink-fg"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <p className="mt-3 px-1 text-[11px] text-subtle">
          {open.length === 0
            ? done.length > 0
              ? "都做完了 👍"
              : "还没有待办。"
            : `${open.length} 件没做`}
          {done.length > 0 ? ` · ${done.length} 件做完` : ""}
        </p>

        {todos.length === 0 ? (
          <div className="mt-4 rounded-3xl border border-dashed border-line px-6 py-10 text-center">
            <ListChecks className="mx-auto size-6 text-muted" strokeWidth={1.5} />
            <p className="mt-3 text-[13px] text-muted">上面加一件试试。</p>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {[...open, ...(showDone ? done : [])].map((t) => (
              <li key={t.id}>
                <div
                  className={cn(
                    "flex items-center gap-1 overflow-hidden rounded-3xl border border-line pr-1",
                    t.done ? "bg-surface/60" : "bg-surface",
                  )}
                >
                  <button
                    type="button"
                    aria-label={t.done ? `标记未完成：${t.text}` : `标记完成：${t.text}`}
                    onClick={() => useApp.getState().toggleTodo(t.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border",
                        t.done ? "border-accent bg-accent text-ink-fg" : "border-line",
                      )}
                    >
                      {t.done && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-[14px] leading-5",
                          t.done && "text-muted line-through",
                        )}
                      >
                        {t.text}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-subtle">
                        {t.done && t.doneAt
                          ? `${formatDay(t.doneAt)} 做完`
                          : `${formatDay(t.createdAt)} ${formatClock(t.createdAt)} 加的`}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`删掉：${t.text}`}
                    onClick={() => useApp.getState().deleteTodo(t.id)}
                    className="shrink-0 px-2 text-subtle"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="flex-1 rounded-2xl bg-chip py-2.5 text-[12px] font-medium"
            >
              {showDone ? `收起做完的 ${done.length} 件` : `看看做完的 ${done.length} 件`}
            </button>
            <button
              type="button"
              onClick={() => useApp.getState().clearDoneTodos()}
              className="rounded-2xl bg-chip px-4 py-2.5 text-[12px] text-muted"
            >
              清掉
            </button>
          </div>
        )}

        <p className="mt-8 text-center text-[10px] tracking-[0.28em] text-subtle uppercase">
          one thing at a time
        </p>
      </div>
    </div>
  );
}
