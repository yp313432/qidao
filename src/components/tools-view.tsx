import { useState } from "react";
import { FileText, Puzzle, Trash2, Zap } from "lucide-react";
import { HttpTools } from "@/components/tools/http-tools";
import { McpServers } from "@/components/tools/mcp-servers";
import { useApp } from "@/lib/store";
import { useScrollMemory } from "@/lib/ux";
import { cn, formatDay } from "@/lib/utils";

// 原来的「思考」标签已经去掉：思考链不再归档（回复时当场就能看到）
const TABS = [
  { id: "http", label: "HTTP", icon: Zap },
  { id: "mcp", label: "MCP", icon: Puzzle },
  { id: "docs", label: "文档", icon: FileText },
] as const;

export function ToolsView() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("http");
  const scrollRef = useScrollMemory("tools");
  const docs = useApp((s) => s.docs);
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <p className="text-xs tracking-wide text-muted">功能区</p>
        <h1 className="mt-1 font-serif text-2xl font-medium">工具</h1>
      </header>
      <div className="px-4">
        <div className="grid grid-cols-4 gap-1 rounded-full bg-chip p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-full py-2 text-[12px] font-medium",
                tab === t.id ? "bg-elevated text-fg shadow-sm" : "text-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-above-nav">
        {tab === "http" && <HttpTools />}

        {tab === "mcp" && <McpServers />}

        {tab === "docs" && (
          <div className="space-y-2">
            <button
              type="button"
              className="w-full rounded-2xl border border-dashed border-line py-3 text-sm text-muted"
              onClick={() => {
                const title = window.prompt("文档标题");
                const content = window.prompt("正文");
                if (!title || !content) return;
                useApp.getState().saveDoc({ title, content, source: "manual" });
              }}
            >
              新建文档
            </button>
            {docs.length === 0 && <p className="py-10 text-center text-sm text-muted">还没有文档</p>}
            {docs.map((d) => (
              <article key={d.id} className="rounded-2xl border border-line bg-surface px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => setOpenDoc(openDoc === d.id ? null : d.id)}
                  >
                    <p className="font-medium">{d.title}</p>
                    <p className="text-[12px] text-muted">
                      {d.source === "chat" ? "来自对话" : "手写"} · {formatDay(d.createdAt)}
                    </p>
                  </button>
                  <button
                    type="button"
                    aria-label="删除文档"
                    onClick={() => useApp.getState().deleteDoc(d.id)}
                    className="size-9 text-muted"
                  >
                    <Trash2 className="mx-auto size-4" />
                  </button>
                </div>
                {openDoc === d.id && (
                  <pre className="mt-3 whitespace-pre-wrap font-sans text-[13px] leading-6 text-muted">
                    {d.content}
                  </pre>
                )}
              </article>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
