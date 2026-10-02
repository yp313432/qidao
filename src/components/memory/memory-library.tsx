import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Clock, LayoutGrid, Network, Plus, Search } from "lucide-react";
import { MemoryCard } from "@/components/memory/memory-card";
import { MemoryDetail } from "@/components/memory/memory-detail";
import { MemoryGraph } from "@/components/memory/memory-graph";
import { MemoryTimeline } from "@/components/memory/memory-timeline";
import { ALL_KINDS, KIND_HINT, KIND_LABEL, retention, searchMemories } from "@/lib/memory";
import type { SearchOptions } from "@/lib/memory";
import { useApp } from "@/lib/store";
import type { Memory, MemoryKind } from "@/lib/types";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { cn } from "@/lib/utils";

type SortKey = NonNullable<SearchOptions["sort"]>;

const SORTS: { id: SortKey; label: string }[] = [
  { id: "recent", label: "最近改过" },
  { id: "strong", label: "记得最牢" },
  { id: "confidence", label: "最确定" },
  { id: "created", label: "最近记住" },
];

/**
 * 记忆库。
 *
 * 设计目标：**一眼看出他还记得什么、哪些快忘了、哪些连在一起**。
 * 所以每条都带类型色、清晰度、衰减走向和"连着几条"——
 * 而不是一串平铺的文字。
 */
export function MemoryLibrary() {
  useActivity("在看记忆库");
  const scrollRef = useScrollMemory("memories");
  const memories = useApp((s) => s.memories);
  const addMemoryItem = useApp((s) => s.addMemoryItem);
  const updateMemory = useApp((s) => s.updateMemory);
  const archiveMemory = useApp((s) => s.archiveMemory);
  const unarchiveMemory = useApp((s) => s.unarchiveMemory);
  const deleteMemory = useApp((s) => s.deleteMemory);
  const confirmMemory = useApp((s) => s.confirmMemory);

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MemoryKind | "all">("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<MemoryKind>("profile");
  /** 视图：卡片墙 / 神经元图 / 时间线 */
  const [view, setView] = useState<"cards" | "graph" | "timeline">("cards");
  const [picked, setPicked] = useState<string | null>(null);
  /** 打开详情面板的那条 */
  const [sheetId, setSheetId] = useState<string | null>(null);

  const hits = useMemo(
    () =>
      searchMemories(
        memories,
        query,
        {
          kinds: kind === "all" ? undefined : [kind],
          sort,
          includeArchived: showArchived,
        },
        Date.now(),
      ),
    [memories, query, kind, sort, showArchived],
  );

  const active = memories.filter((m) => m.status === "active");
  const avg =
    active.length > 0
      ? Math.round((active.reduce((n, m) => n + retention(m), 0) / active.length) * 100)
      : 0;

  const nameOf = (id: string) => memories.find((m) => m.id === id)?.content ?? "";
  const pickedMemory = picked ? (memories.find((m) => m.id === picked) ?? null) : null;

  function add() {
    const text = draft.trim();
    if (!text) return;
    addMemoryItem(draftKind, text, { source: "手动" });
    setDraft("");
    setAdding(false);
  }

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <header className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1">
        <Link to="/me" aria-label="返回我的" className="flex size-11 items-center justify-center">
          <ChevronLeft className="size-6" strokeWidth={1.6} />
        </Link>
        <h1 className="flex-1 font-serif text-lg font-medium">记忆库</h1>
        <button
          type="button"
          onClick={() =>
            setView((v) => (v === "cards" ? "graph" : v === "graph" ? "timeline" : "cards"))
          }
          aria-label={
            view === "cards" ? "看神经元图" : view === "graph" ? "看时间线" : "看卡片"
          }
          className="flex size-11 items-center justify-center rounded-full"
        >
          {view === "cards" ? (
            <Network className="size-5" strokeWidth={1.7} />
          ) : view === "graph" ? (
            <Clock className="size-5" strokeWidth={1.7} />
          ) : (
            <LayoutGrid className="size-5" strokeWidth={1.7} />
          )}
        </button>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-label="加一条"
          className="mr-1 flex size-11 items-center justify-center rounded-full"
        >
          <Plus className={cn("size-5 transition-transform", adding && "rotate-45")} strokeWidth={1.7} />
        </button>
      </header>

      {/* 概况：他到底记得多少、整体还清不清晰 */}
      <section className="px-4">
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-2xl">{active.length}</span>
            <span className="text-[12px] text-muted">条还在用</span>
            {memories.length > active.length && (
              <span className="text-[12px] text-subtle">· 归档 {memories.length - active.length}</span>
            )}
            <span className="ml-auto text-[12px] text-muted">平均清晰度 {avg}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chip">
            <div className="h-full rounded-full bg-accent/70" style={{ width: `${avg}%` }} />
          </div>
          <p className="mt-2 text-[11px] leading-4 text-subtle">
            他每轮对话只会看到<span className="text-fg">和当前话题相关</span>的那几条 —— 不是全塞给他。
          </p>
        </div>
      </section>

      {/* 加一条 */}
      {adding && (
        <section className="mt-3 px-4">
          <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {ALL_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDraftKind(k)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px]",
                    draftKind === k ? "bg-accent text-accent-fg" : "bg-chip text-muted",
                  )}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <p className="mb-2 text-[11px] text-subtle">{KIND_HINT[draftKind]}</p>
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                placeholder="一句话就行，比如「喜欢在晚上写东西」"
                className="h-10 min-w-0 flex-1 rounded-2xl bg-chip px-3 text-[13px] outline-none"
              />
              <button
                type="button"
                onClick={add}
                disabled={!draft.trim()}
                className="h-10 shrink-0 rounded-2xl bg-ink px-4 text-[13px] font-medium text-ink-fg disabled:opacity-40"
              >
                记住
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 神经元图：一眼看出哪些连在一起、哪些快忘了 */}
      {view === "graph" && (
        <section className="mt-3 px-4">
          <MemoryGraph
            memories={memories}
            selectedId={picked}
            onSelect={setPicked}
          />
          <p className="mt-2 px-1 text-[11px] leading-4 text-subtle">
            点大小 = 记忆强度 · 亮度 = 清晰度（快忘的会变暗）· 颜色 = 类型 ·
            线 = 关联（一起被想起过的会连起来）
          </p>
        </section>
      )}

      {/* 时间线：他这半年是怎么一点点认识你的 */}
      {view === "timeline" && (
        <section className="mt-3 px-4">
          <MemoryTimeline memories={memories} onOpen={(m) => setSheetId(m.id)} />
        </section>
      )}

      {/* 搜索 + 筛选 */}
      {view !== "timeline" && (
      <section className="mt-3 px-4">
        <div className="flex items-center gap-2 rounded-2xl bg-chip px-3">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜内容、标签…"
            className="h-11 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="text-[11px] text-muted">
              清空
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setKind("all")}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px]",
              kind === "all" ? "bg-accent text-accent-fg" : "bg-chip text-muted",
            )}
          >
            全部
          </button>
          {ALL_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px]",
                kind === k ? "bg-accent text-accent-fg" : "bg-chip text-muted",
              )}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px]",
                sort === s.id ? "bg-elevated text-fg" : "text-muted",
              )}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              "ml-auto rounded-full px-2.5 py-1 text-[11px]",
              showArchived ? "bg-elevated text-fg" : "text-subtle",
            )}
          >
            {showArchived ? "含已归档" : "不含归档"}
          </button>
        </div>
      </section>
      )}

      {/* 卡片墙（图视图只显示选中的那条；时间线视图不需要它） */}
      {view !== "timeline" && (
      <section className="mt-4 space-y-2.5 px-4">
        {view === "graph" ? (
          pickedMemory ? (
            <MemoryCard
              memory={pickedMemory}
              linkNames={pickedMemory.links.map(nameOf).filter(Boolean)}
              onConfirm={() => confirmMemory(pickedMemory.id)}
              onArchive={() =>
                pickedMemory.status === "active"
                  ? archiveMemory(pickedMemory.id)
                  : unarchiveMemory(pickedMemory.id)
              }
              onDelete={() => {
                deleteMemory(pickedMemory.id);
                setPicked(null);
              }}
            />
          ) : (
            <p className="py-6 text-center text-[12px] text-muted">
              {active.length > 0 ? "点图上的节点，看这条记忆的详情" : ""}
            </p>
          )
        ) : hits.length === 0 ? (
          <p className="py-12 text-center text-[13px] leading-6 text-muted">
            {memories.length === 0
              ? "还没有记忆。\n跟他聊几句，或者点右上角 + 自己加一条。"
              : "没有符合筛选的记忆。"}
          </p>
        ) : (
          hits.map((h) => (
            <MemoryCard
              key={h.memory.id}
              memory={h.memory}
              linkNames={h.memory.links.map(nameOf).filter(Boolean)}
              onConfirm={() => confirmMemory(h.memory.id)}
              onArchive={() =>
                h.memory.status === "active"
                  ? archiveMemory(h.memory.id)
                  : unarchiveMemory(h.memory.id)
              }
              onDelete={() => deleteMemory(h.memory.id)}
              onOpen={() => setSheetId(h.memory.id)}
            />
          ))
        )}
      </section>
      )}

      {/* 详情面板：点卡片或时间线里的一条就升起来 */}
      <MemoryDetail
        memory={sheetId ? (memories.find((m) => m.id === sheetId) ?? null) : null}
        linkNames={
          sheetId
            ? (memories.find((m) => m.id === sheetId)?.links ?? []).map(nameOf).filter(Boolean)
            : []
        }
        onClose={() => setSheetId(null)}
        onSave={(patch) => sheetId && updateMemory(sheetId, patch)}
        onConfirm={() => sheetId && confirmMemory(sheetId)}
        onArchive={() => {
          if (!sheetId) return;
          const m = memories.find((x) => x.id === sheetId);
          if (!m) return;
          if (m.status === "active") archiveMemory(sheetId);
          else unarchiveMemory(sheetId);
        }}
        onDelete={() => sheetId && deleteMemory(sheetId)}
      />
    </div>
  );
}
