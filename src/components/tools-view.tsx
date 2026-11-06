import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, FileText, Puzzle, Trash2, Zap } from "lucide-react";
import { HttpTools } from "@/components/tools/http-tools";
import { McpServers } from "@/components/tools/mcp-servers";
import { SummaryList } from "@/components/tools/summary-list";
import { useApp } from "@/lib/store";
import { recallUiState, rememberUiState, useScrollMemory } from "@/lib/ux";
import { cn, formatDay } from "@/lib/utils";

// 原来的「思考」标签已经去掉：思考链不再归档（回复时当场就能看到）
const TABS = [
  { id: "http", label: "HTTP", icon: Zap },
  { id: "mcp", label: "MCP", icon: Puzzle },
  { id: "summary", label: "摘要", icon: FileText },
  /**
   * **文档**（2026-11 用户 m07602）："工具区的表情包做好之后也可以删了，把文档换过去吧"。
   *
   * 表情管理已经并进对话里的表情面板（`composer.tsx` 的 `.sticker-sheet`，
   * 带分组页签/导入/长按删除），工具区这一格就腾出来给文档用 ——
   * 之前文档是藏在「摘要」下面的折叠区里，几乎没人点开。
   */
  { id: "docs", label: "文档", icon: FileText },
] as const;

type TabId = (typeof TABS)[number]["id"];

/*
 * 纸世界 Step7（用户 m01676「动手吧」）：纯色材质下，这排四个标签挂到一根绳上。
 * 吊线长短/微斜/摆动周期都是纯视觉参数——标签本体仍是原来的 button，
 * 点击、sessionStorage 记忆、无障碍名字都不变。
 */
const TAG_DROPS = ["26px", "46px", "22px", "52px"] as const;
const TAG_ROTS = ["-2.4deg", "1.6deg", "-1.2deg", "2.2deg"] as const;
const TAG_SWAYS = ["4.6s", "5.4s", "6.1s", "4.9s"] as const;
const TAG_LATIN = ["RETE", "PONTE", "SINTESI", "CARTE"] as const;
/* 每张牌吊线起点=绳在它正上方的纵坐标（绳是微垂的，四段不一样高） */
const TAG_ROPE_Y = ["19px", "22px", "21px", "16px"] as const;

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
  const solidPaper = useApp((s) => (s.settings.material ?? "frost") === "solid");
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  function pick(next: TabId) {
    setTab(next);
    rememberUiState(TAB_MEMORY, next);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="px-5 inset-top-100 pb-3">
        <p className="text-xs tracking-wide text-muted">功能区</p>
        <h1 className="mt-1 font-serif text-2xl font-medium">工具</h1>
      </header>
      <div className="px-4">
        {solidPaper ? (
          /* 纸世界 Step7：一根绳串四张吊牌（装饰层 pointer-events:none，不挡点击） */
          <div className="tool-tabs">
            <div className="tool-rope" aria-hidden="true">
              <svg viewBox="0 0 412 44" preserveAspectRatio="none">
                <path
                  d="M-6 16 Q 206 30 418 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.3}
                  strokeOpacity={0.34}
                />
                <path
                  d="M-6 16 Q 206 30 418 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.3}
                  strokeOpacity={0.16}
                  strokeDasharray="2 3.2"
                />
              </svg>
              <i className="tool-knot left" />
              <i className="tool-knot right" />
              <i className="tool-tassel">
                <i />
                <b />
                <em />
              </i>
              <i className="tool-clip">
                <i />
                <b />
              </i>
              <span className="tool-leaf">
                <svg viewBox="0 0 14 22">
                  <path
                    d="M7 1 C12 5 13 12 7 21 C1 12 2 5 7 1Z"
                    fill="rgba(138,115,85,.22)"
                    stroke="rgba(90,74,52,.55)"
                    strokeWidth={0.8}
                  />
                  <path d="M7 4 L7 19" stroke="rgba(90,74,52,.4)" strokeWidth={0.6} />
                </svg>
              </span>
              <i className="tool-tape" />
            </div>
            {TABS.map((t, i) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                className={cn("tool-tag", tab === t.id && "on")}
                style={
                  {
                    "--drop": TAG_DROPS[i],
                    "--rot": TAG_ROTS[i],
                    "--sway": TAG_SWAYS[i],
                    "--ropeY": TAG_ROPE_Y[i],
                  } as CSSProperties
                }
              >
                <span className="tool-tag-str" aria-hidden="true" />
                <span className="tool-tag-card">
                  <span className="tool-tag-no" aria-hidden="true">
                    {`0${i + 1}`}
                  </span>
                  {t.label}
                  <span className="tool-tag-en" aria-hidden="true">
                    {TAG_LATIN[i]}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          /* 注意：这里是 4 个标签，必须是 grid-cols-4（加了「表情」之后从 3 变 4）。*/
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
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-above-nav">
        {tab === "http" && <HttpTools />}

        {tab === "mcp" && <McpServers />}

        {/*
          ── 摘要（2026-11）──────────────────────────────────────
          用户原话："这个摘要总结完在哪，没看到啊" → 然后："你把摘要后的直接写到工具区的
          那个文档里面……" 后来 m07602 又改成："把文档换过去吧" ——
          文档拿回一个**自己的标签**（就是原来表情那格），不再折叠在摘要下面。
        */}
        {tab === "summary" && <SummaryList />}

        {tab === "docs" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1 pb-0.5">
              <p className="font-mono text-[9px] tracking-[0.14em] text-subtle">
                文档 · {docs.length} 篇
              </p>
              <Link to="/tools/docs" className="text-[11px] text-muted">
                ＋ 新建
              </Link>
            </div>
            {docs.length === 0 && (
              <p className="py-8 text-center text-[12px] text-muted">还没有文档</p>
            )}
            <div className="tool-stack space-y-2">
            {docs.map((d, i) => {
              const open = openDoc === d.id;
              return (
                <article key={d.id} data-method="NOTE" className={cn("overflow-hidden rounded-xl border border-line bg-surface p-3", "tool-card", open && "open")}>
                  <span className="tool-tab" aria-hidden />
                  <span className="tool-fold" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setOpenDoc(open ? null : d.id)}
                    aria-expanded={open}
                    className="tool-hit w-full"
                  >
                    <span className="tool-r1">
                      <span className="tool-name">{d.title}</span>
                      <ChevronDown
                        className={cn(
                          "size-3.5 shrink-0 text-subtle transition-transform duration-200",
                          open && "rotate-180",
                        )}
                      />
                      <span className="tool-host">{formatDay(d.createdAt)}</span>
                    </span>
                    <span className="tool-r2">
                      <span className="tool-mk">{d.source === "chat" ? "来自对话" : "手写"}</span>
                      <span className="tool-no">No.{String(i + 1).padStart(2, "0")}</span>
                    </span>
                  </button>
                  {open && (
                    <div className="tool-zone">
                      <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-sans text-[12px] leading-[1.7] text-muted">
                        {d.content}
                      </pre>
                      <div className="tool-acts">
                        <button
                          type="button"
                          aria-label="删除文档"
                          onClick={() => useApp.getState().deleteDoc(d.id)}
                          className="flex items-center gap-1 rounded-full bg-chip px-3 py-1.5 text-[12px] text-muted"
                        >
                          <Trash2 className="size-3" />
                          删除
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
