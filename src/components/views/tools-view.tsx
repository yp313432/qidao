import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { HttpTools } from "@/components/tools/http-tools";
import { McpServers } from "@/components/tools/mcp-servers";
import { SummaryList } from "@/components/tools/summary-list";
import { ToolCard } from "@/components/tools/tool-card";
import { KButton, KChip, KEmpty, KHead } from "@/components/ui-kit";
import { useApp } from "@/lib/store";
import { recallUiState, rememberUiState, useScrollMemory } from "@/lib/ux";
import { formatDay } from "@/lib/utils";

// 原来的「思考」标签已经去掉：思考链不再归档（回复时当场就能看到）
const TABS = [
  { id: "http", label: "HTTP" },
  { id: "mcp", label: "MCP" },
  { id: "summary", label: "摘要" },
  /**
   * **文档**（2026-11 用户 m07602）："工具区的表情包做好之后也可以删了，把文档换过去吧"。
   *
   * 表情管理已经并进对话里的表情面板（`composer.tsx` 的 `.sticker-sheet`，
   * 带分组页签/导入/长按删除），工具区这一格就腾出来给文档用 ——
   * 之前文档是藏在「摘要」下面的折叠区里，几乎没人点开。
   */
  { id: "docs", label: "文档" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** 进编辑器（独立页面）之前，把"我现在在哪个标签"记一下，回来接着显示。 */
const TAB_MEMORY = "tools-tab";

/**
 * **工具页**。
 *
 * 2026-11-07 阶段3 迁移（用户选定方向 C「工程蓝图」）：
 *   旧版在纯色模式下把这四个标签挂在一根绳上（吊牌 + 穗子 + 叶子 + 无限摆动），
 *   那是"纸世界"皮肤的做法 —— 文字跟着每帧旋转要反复栅格化，是掉帧和发虚的来源；
 *   而且它是**写死的一堆纯色选择器**（`.tool-tag/.tool-rope/.tool-tassel/...`）。
 *   现在四种材质共用同一条 `.k-tabs` 标签条：纯色下它是 2px 墨框、选中格压成实墨块，
 *   磨砂/液态下自动变成圆角浅底 —— 页面里一个颜色都不写。
 */
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
    <div className="k-page min-h-0 flex flex-1 flex-col">
      <KHead kicker="功能区" title="工具" />

      <div className="k-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            data-active={tab === t.id ? "true" : undefined}
            className="k-tab"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="k-scroll k-nav-space mt-3 min-h-0 flex-1">
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
          <div className="k-list">
            <div className="k-sect">
              <p className="k-sect__title">文档 · {docs.length} 篇</p>
              <Link to="/tools/docs" className="k-sect__act">
                ＋ 新建
              </Link>
            </div>
            {docs.length === 0 && (
              <KEmpty title="还没有文档" hint="对话里摘下来的内容也能存成文档。" />
            )}
            <div className="k-list">
              {docs.map((d, i) => {
                const open = openDoc === d.id;
                return (
                  <ToolCard
                    key={d.id}
                    title={d.title}
                    open={open}
                    onToggle={() => setOpenDoc(open ? null : d.id)}
                    meta={
                      <>
                        <KChip>{d.source === "chat" ? "来自对话" : "手写"}</KChip>
                        <span className="k-stat">{formatDay(d.createdAt)}</span>
                        <span className="k-stat">No.{String(i + 1).padStart(2, "0")}</span>
                      </>
                    }
                  >
                    <p className="k-long">{d.content}</p>
                    <div className="k-acts">
                      <KButton
                        aria-label="删除文档"
                        onClick={() => useApp.getState().deleteDoc(d.id)}
                      >
                        <Trash2 aria-hidden="true" />
                        删除
                      </KButton>
                    </div>
                  </ToolCard>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
