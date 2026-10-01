import { useState } from "react";
import { Loader2, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/store";
import type { HttpTool } from "@/lib/types";
import { cn } from "@/lib/utils";

type ToolDraft = Omit<HttpTool, "id"> & { id?: string };
type Result = { status: number; ms: number; text: string; error?: string };

const EMPTY: ToolDraft = {
  name: "",
  description: "",
  method: "GET",
  url: "",
  headersText: "",
  body: "",
  enabled: true,
};

const METHODS: HttpTool["method"][] = ["GET", "POST", "PUT", "DELETE"];

/**
 * 真的 HTTP 工具面板。
 *
 * 不是 MCP 协议（那需要 AI 才能被调用），而是「你自己配一个请求，
 * 点一下真的发出去」。现在就能用；以后接上 AI，同一份定义可以直接
 * 暴露给模型当工具。
 */
export function HttpTools() {
  const tools = useApp((s) => s.httpTools);
  const [draft, setDraft] = useState<ToolDraft | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});

  async function run(tool: HttpTool) {
    setRunning(tool.id);
    const started = performance.now();
    try {
      const headers = new Headers();
      for (const line of tool.headersText.split(/\r?\n/)) {
        const i = line.indexOf(":");
        if (i > 0) headers.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
      }
      const init: RequestInit = { method: tool.method, headers };
      if (tool.method !== "GET" && tool.method !== "DELETE" && tool.body.trim()) {
        init.body = tool.body;
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
      }
      const res = await fetch(tool.url, init);
      const text = (await res.text()).slice(0, 4000);
      setResults((m) => ({
        ...m,
        [tool.id]: { status: res.status, ms: Math.round(performance.now() - started), text },
      }));
    } catch (err) {
      setResults((m) => ({
        ...m,
        [tool.id]: {
          status: 0,
          ms: Math.round(performance.now() - started),
          text: "",
          error: `${(err as Error).message || "请求失败"}\n\n常见原因：对方服务器没开跨域(CORS)、地址写错、或网络不通。`,
        },
      }));
    } finally {
      setRunning(null);
    }
  }

  function save() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.url.trim()) return;
    const st = useApp.getState();
    if (draft.id) {
      const { id, ...patch } = draft;
      st.patchHttpTool(id, patch);
    } else {
      const { id: _ignored, ...rest } = draft;
      st.addHttpTool(rest);
    }
    setDraft(null);
  }

  return (
    <div className="space-y-2">
      <p className="px-1 pb-1 text-[12px] leading-5 text-muted">
        自己填地址和请求头，点「调用」会<span className="font-medium text-fg">真的</span>
        发一次请求 —— 不依赖 AI。浏览器有跨域（CORS）限制，对方服务器不放开的话会被挡住。
      </p>

      {tools.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">还没有工具，点下面新建一个</p>
      )}

      {tools.map((t) => {
        const r = results[t.id];
        const ok = r && !r.error && r.status >= 200 && r.status < 300;
        return (
          <article key={t.id} className="rounded-3xl border border-line bg-surface px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 rounded-full bg-chip px-2.5 py-1 font-mono text-[11px]">
                {t.method}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.name}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted">{t.url}</p>
                {t.description && (
                  <p className="mt-1 text-[12px] leading-5 text-muted">{t.description}</p>
                )}
              </div>
              <Switch
                checked={t.enabled}
                label={t.name}
                onCheckedChange={(v) => useApp.getState().patchHttpTool(t.id, { enabled: v })}
              />
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void run(t)}
                disabled={running === t.id}
                className="flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[13px] font-medium text-ink-fg disabled:opacity-60"
              >
                {running === t.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                调用
              </button>
              <button
                type="button"
                aria-label="编辑"
                onClick={() => setDraft({ ...t })}
                className="rounded-full bg-chip p-2 text-muted"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="删除"
                onClick={() => useApp.getState().removeHttpTool(t.id)}
                className="rounded-full bg-chip p-2 text-muted"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {r && (
              <div className="mt-2.5 rounded-2xl bg-chip px-3 py-2.5">
                <p className={cn("text-[12px] font-medium", ok ? "text-ok" : "text-warn")}>
                  {r.error ? "请求失败" : `HTTP ${r.status}`} · {r.ms}ms
                </p>
                <pre className="mt-1.5 max-h-52 overflow-auto font-mono text-[11px] leading-5 break-all whitespace-pre-wrap text-muted">
                  {r.error ?? (r.text || "(空响应)")}
                </pre>
              </div>
            )}
          </article>
        );
      })}

      <button
        type="button"
        onClick={() => setDraft({ ...EMPTY })}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm text-muted"
      >
        <Plus className="size-4" />
        新建 HTTP 工具
      </button>

      {draft && (
        <div className="fixed inset-0 z-40 flex items-end">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 bg-fg/20"
            onClick={() => setDraft(null)}
          />
          <div className="glass-panel relative z-10 max-h-[88vh] w-full overflow-y-auto rounded-t-[2.5rem] px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between">
              <p className="font-serif text-lg">{draft.id ? "编辑工具" : "新建 HTTP 工具"}</p>
              <button type="button" aria-label="关闭" onClick={() => setDraft(null)} className="size-9">
                <X className="mx-auto size-5" />
              </button>
            </div>

            <label className="mt-4 block">
              <span className="text-[12px] text-muted">名称</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="例如：查天气"
                className="mt-1 w-full rounded-2xl border border-line bg-chip px-4 py-2.5 text-[15px] outline-none placeholder:text-subtle"
              />
            </label>

            <label className="mt-3 block">
              <span className="text-[12px] text-muted">说明（可选）</span>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="这个工具是干什么的"
                className="mt-1 w-full rounded-2xl border border-line bg-chip px-4 py-2.5 text-[15px] outline-none placeholder:text-subtle"
              />
            </label>

            <div className="mt-3 flex gap-2">
              <label className="w-28 shrink-0">
                <span className="text-[12px] text-muted">方法</span>
                <select
                  value={draft.method}
                  onChange={(e) =>
                    setDraft({ ...draft, method: e.target.value as HttpTool["method"] })
                  }
                  className="mt-1 w-full rounded-2xl border border-line bg-chip px-3 py-2.5 text-[15px] outline-none"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 flex-1">
                <span className="text-[12px] text-muted">地址</span>
                <input
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-2xl border border-line bg-chip px-4 py-2.5 font-mono text-[13px] outline-none placeholder:text-subtle"
                />
              </label>
            </div>

            <label className="mt-3 block">
              <span className="text-[12px] text-muted">请求头（每行一个 Key: Value）</span>
              <textarea
                value={draft.headersText}
                onChange={(e) => setDraft({ ...draft, headersText: e.target.value })}
                rows={3}
                placeholder={"Authorization: Bearer xxx\nAccept: application/json"}
                className="mt-1 w-full resize-none rounded-2xl border border-line bg-chip px-4 py-3 font-mono text-[12px] leading-5 outline-none placeholder:text-subtle"
              />
            </label>

            {draft.method !== "GET" && draft.method !== "DELETE" && (
              <label className="mt-3 block">
                <span className="text-[12px] text-muted">请求体</span>
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={4}
                  placeholder={'{\n  "key": "value"\n}'}
                  className="mt-1 w-full resize-none rounded-2xl border border-line bg-chip px-4 py-3 font-mono text-[12px] leading-5 outline-none placeholder:text-subtle"
                />
              </label>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={!draft.name.trim() || !draft.url.trim()}
                className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-ink-fg disabled:opacity-50"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-full px-4 py-2.5 text-sm text-muted"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
