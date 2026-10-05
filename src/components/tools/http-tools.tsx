import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/store";
import type { HttpTool } from "@/lib/types";
import { cn } from "@/lib/utils";

type Result = { status: number; ms: number; text: string; error?: string };

/**
 * HTTP 工具**列表**。
 *
 * 新建 / 编辑不在这里弹层了 —— 跳到独立页面 `/tools/http`（编辑某一条带 `?id=`）。
 * 见 `editor-page.tsx` 开头的说明：弹层会被底部导航压住，而且跟 MCP 那份
 * 长得几乎一样却各写一遍。
 */
export function HttpTools() {
  const tools = useApp((s) => s.httpTools);
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
              {/* 用 Link（真链接）而不是 button + navigate：能长按、能新开、无障碍也对 */}
              <Link
                to="/tools/http"
                search={{ id: t.id }}
                aria-label="编辑"
                className="rounded-full bg-chip p-2 text-muted"
              >
                <Pencil className="size-3.5" />
              </Link>
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

      <Link
        to="/tools/http"
        search={{}}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm text-muted"
      >
        <Plus className="size-4" />
        新建 HTTP 工具
      </Link>
    </div>
  );
}
