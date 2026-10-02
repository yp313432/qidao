import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, FileCode, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { useActivity } from "@/lib/use-activity";
import { IS_APP } from "@/lib/platform";
import { useScrollMemory } from "@/lib/ux";
import { cn } from "@/lib/utils";
import { prettyBytes } from "@/lib/tokens";

type WsFile = { type: "file"; name: string; path: string; bytes: number; lines: number };
type WsDir = { type: "dir"; name: string; path: string; children: (WsFile | WsDir)[] };
type WsNote = {
  at: string;
  title: string;
  detail: string;
  files: string[];
  source: "git" | "changelog";
};
type Payload = {
  ok: boolean;
  message?: string;
  generatedAt?: number;
  roots?: WsDir[];
  loose?: WsFile[];
  entries?: WsNote[];
  source?: "git" | "changelog";
  totals?: { files: number; dirs: number; lines: number; bytes: number };
};

export function WorkspaceView() {
  useActivity("在看工作区");
  const scrollRef = useScrollMemory("workspace");
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<"timeline" | "files">("timeline");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["src", "public", "scripts"]));
  const [highlight, setHighlight] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // App 里没有服务端，这个接口不存在 —— 直接说明白，
    // 别让用户看到一句 `Unexpected token '<'`（那是把 HTML 当 JSON 解析的报错）。
    if (IS_APP) {
      setData({
        ok: false,
        message: "App 里没有这个功能（工作区要看源码，需要服务端支持）。",
      });
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/workspace");
      const text = await res.text();
      try {
        setData(JSON.parse(text) as Payload);
      } catch {
        setData({ ok: false, message: "这个页面拿不到工作区数据（服务端接口不在）。" });
      }
    } catch (err) {
      setData({ ok: false, message: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const jumpTo = useCallback(
    (filePath: string) => {
      setTab("files");
      setHighlight(filePath);
      setExpanded((prev) => {
        const next = new Set(prev);
        const parts = filePath.split("/");
        for (let i = 1; i < parts.length; i += 1) next.add(parts.slice(0, i).join("/"));
        return next;
      });
      window.setTimeout(() => {
        document
          .querySelector(`[data-path="${CSS.escape(filePath)}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 120);
    },
    [],
  );

  const entries = data?.entries ?? [];
  const roots = data?.roots ?? [];
  const loose = data?.loose ?? [];
  const totals = data?.totals;

  const grouped = useMemo(() => {
    const map = new Map<string, WsNote[]>();
    for (const e of entries) {
      const d = new Date(e.at);
      const key = Number.isNaN(d.getTime())
        ? "未知时间"
        : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [entries]);

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <header className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1">
        <Link to="/me" aria-label="返回我的" className="flex size-11 items-center justify-center">
          <ChevronLeft className="size-6" strokeWidth={1.6} />
        </Link>
        <h1 className="flex-1 font-serif text-lg font-medium">工作区</h1>
        <button
          type="button"
          aria-label="刷新"
          onClick={() => void load()}
          className="flex size-10 items-center justify-center text-muted"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </button>
      </header>

      {/* 概览 */}
      <section className="mt-2 px-4">
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          {data && !data.ok ? (
            <p className="text-[12px] leading-5 text-warn">
              读不到工作区文件：{data.message}
              <br />
              <span className="text-subtle">
                这是本地开发工具 —— 部署到 Serverless 后源码通常不在运行时目录里，读不到是正常的。
              </span>
            </p>
          ) : (
            <>
              <p className="text-[13px] font-medium">
                {totals ? `${totals.files} 个文件 · ${totals.lines.toLocaleString()} 行` : "读取中…"}
                {totals ? ` · ${prettyBytes(totals.bytes)}` : ""}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                {entries.length} 条变更记录
                {data?.source === "git" ? "（来自 git log）" : "（来自 changelog.json）"}
                {data?.generatedAt ? ` · 刚刚更新` : ""}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-subtle">
                实时扫盘，所以你看到的永远是当前磁盘上的样子
              </p>
            </>
          )}
        </div>
      </section>

      {/* 分栏 */}
      <div className="mt-4 px-4">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-chip p-1">
          {(
            [
              ["timeline", "时间线"],
              ["files", "文件"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-full py-2 text-[12px] font-medium",
                tab === id ? "bg-elevated text-fg shadow-sm" : "text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 时间线 */}
      {tab === "timeline" && (
        <section className="mt-4 px-4">
          {grouped.length === 0 && (
            <p className="py-10 text-center text-sm text-muted">还没有变更记录</p>
          )}
          {grouped.map(([day, list]) => (
            <div key={day} className="mb-4">
              <h2 className="mb-2 px-1 text-[12px] tracking-wide text-muted">{day}</h2>
              <ul className="space-y-2">
                {list.map((e, i) => {
                  const d = new Date(e.at);
                  const time = Number.isNaN(d.getTime())
                    ? ""
                    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
                  return (
                    <li
                      key={`${e.at}-${i}`}
                      className="rounded-3xl border border-line bg-surface px-4 py-3"
                    >
                      <div className="flex gap-3">
                        <span className="w-10 shrink-0 text-[12px] tabular-nums text-muted">
                          {time}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] leading-5 font-medium">{e.title}</p>
                          {e.detail && (
                            <p className="mt-1 text-[11px] leading-4 text-muted">{e.detail}</p>
                          )}
                          {e.files.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {e.files.map((f) => (
                                <button
                                  key={f}
                                  type="button"
                                  onClick={() => jumpTo(f)}
                                  title="在文件树里定位"
                                  className="max-w-full truncate rounded-lg bg-chip px-2 py-1 font-mono text-[10px] text-muted"
                                >
                                  {f}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* 文件树 */}
      {tab === "files" && (
        <section className="mt-4 px-4">
          <div className="rounded-3xl border border-line bg-surface p-2.5">
            {loose.length > 0 && (
              <div className="mb-1.5">
                {loose.map((f) => (
                  <TreeFile key={f.path} node={f} highlight={highlight} />
                ))}
              </div>
            )}
            {roots.map((r) => (
              <TreeNode
                key={r.path}
                node={r}
                depth={0}
                expanded={expanded}
                onToggle={(p) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(p)) next.delete(p);
                    else next.add(p);
                    return next;
                  })
                }
                highlight={highlight}
              />
            ))}
          </div>
        </section>
      )}

      <div className="h-6" />
    </div>
  );
}

function TreeFile({ node, highlight }: { node: WsFile; highlight: string }) {
  return (
    <div
      data-path={node.path}
      className={cn(
        "flex items-center gap-2 rounded-xl px-2 py-1.5",
        highlight === node.path && "bg-accent/20 ring-1 ring-accent/60",
      )}
    >
      <FileCode className="size-3.5 shrink-0 text-subtle" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{node.name}</span>
      <span className="shrink-0 text-[10px] text-subtle">
        {node.lines > 0 ? `${node.lines} 行` : prettyBytes(node.bytes)}
      </span>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  onToggle,
  highlight,
}: {
  node: WsDir;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  highlight: string;
}) {
  const open = expanded.has(node.path);
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left"
      >
        {open ? (
          <FolderOpen className="size-3.5 shrink-0 text-muted" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{node.name}</span>
        <span className="shrink-0 text-[10px] text-subtle">{node.children.length}</span>
      </button>
      {open && (
        <div className="ml-3.5 border-l border-line pl-2">
          {node.children.map((c) =>
            c.type === "dir" ? (
              <TreeNode
                key={c.path}
                node={c}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                highlight={highlight}
              />
            ) : (
              <TreeFile key={c.path} node={c} highlight={highlight} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
