import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FileText, Plus, Puzzle, Smile, Trash2, Zap } from "lucide-react";
import { HttpTools } from "@/components/tools/http-tools";
import { McpServers } from "@/components/tools/mcp-servers";
import { StickerLibrary } from "@/components/tools/sticker-library";
import { useApp } from "@/lib/store";
import { recallUiState, rememberUiState, useScrollMemory } from "@/lib/ux";
import { cn, formatDay } from "@/lib/utils";

// 原来的「思考」标签已经去掉：思考链不再归档（回复时当场就能看到）
const TABS = [
  { id: "http", label: "HTTP", icon: Zap },
  { id: "mcp", label: "MCP", icon: Puzzle },
  { id: "docs", label: "文档", icon: FileText },
  /**
   * **表情库**（2026-11 用户要的）："表情包能不能做成一个库，我传到库里，
   * 他从我传的库里挑，并且库里带分组，我自己分，然后他就可以用了。"
   * 放在工具区、跟 HTTP / MCP / 文档 并排（用户原话："把库放文档那里吧"）。
   */
  { id: "stickers", label: "表情", icon: Smile },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** 进编辑器（独立页面）之前，把"我现在在哪个标签"记一下，回来接着显示。 */
const TAB_MEMORY = "tools-tab";

export function ToolsView() {
  /*
    ⚠️ 这里**不能**在 `useState` 的初始化里读 sessionStorage。
    这是个 SSR 应用：服务端没有 sessionStorage，首帧会渲染成默认的 HTTP 标签；
    客户端却读到了 "mcp" —— 两边对不上，React 直接报
    "Hydration failed because the server rendered HTML didn't match"。
    （实测踩过：一开始就是这么写的，验收脚本把这条报错抓出来了。）

    正确姿势：首帧跟服务端一致（HTTP），挂载后再同步到记住的标签。
    代价是极端情况下有一帧闪动，换来的是没有 hydration 报错。
  */
  const [tab, setTab] = useState<TabId>("http");

  useEffect(() => {
    const saved = recallUiState(TAB_MEMORY);
    const found = TABS.find((t) => t.id === saved)?.id;
    if (found) setTab(found);
  }, []);

  const scrollRef = useScrollMemory("tools");
  const docs = useApp((s) => s.docs);
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  function pick(next: TabId) {
    setTab(next);
    rememberUiState(TAB_MEMORY, next);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <p className="text-xs tracking-wide text-muted">功能区</p>
        <h1 className="mt-1 font-serif text-2xl font-medium">工具</h1>
      </header>
      <div className="px-4">
        {/* 注意：这里是 4 个标签，必须是 grid-cols-4（加了「表情」之后从 3 变 4）。*/}
        <div className="grid grid-cols-4 gap-1 rounded-full bg-chip p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t.id)}
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

        {tab === "stickers" && <StickerLibrary />}

        {tab === "docs" && (
          <div className="space-y-2">
            {/*
              原来是 window.prompt 弹两次原生输入框（标题一次、正文一次）——
              同一个「新建」动作，HTTP / MCP 是自绘表单，文档是浏览器弹窗，
              就是用户说的"换一个组件又是另一套写法"。现在跳同一个编辑器页面。
            */}
            <Link
              to="/tools/docs"
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm text-muted"
            >
              <Plus className="size-4" />
              新建文档
            </Link>
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
