import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Loader2, Pencil, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { buildHttpRequest, paramsOfTool } from "@/lib/http-tools";
import { EXAMPLE_HTTP_TOOLS, useApp } from "@/lib/store";
import type { HttpTool } from "@/lib/types";
import { cn } from "@/lib/utils";

type Result = { status: number; ms: number; text: string; error?: string };

/** 列表里只给主机名，完整地址在展开后看 —— 一行放得下、扫得快。 */
function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url || "(未填地址)";
  }
}

/**
 * HTTP 工具**列表**。
 *
 * 2026-11 用户：「每个都好大一块，还有很多解释性话语……平铺下来占地很大，没有交互逻辑」——
 * 改成：一行一个工具（方法签 + 名字 + 主机 + 开关 + 折角），点行才展开地址/说明/操作/结果。
 * 解释文字收进底部「说明」折叠，不再压在列表前面。
 *
 * 两条路都通，而且是**同一份请求构造**（`lib/http-tools.ts`）：
 *   · 你点「调用」—— 按你配好的原样发一次
 *   · **星芒自己调**（`http.call` 动作，过权限闸门之后）——
 *     「可改的参数」是**从你配好的请求里推出来的**：GET 看网址里的查询参数、
 *     POST/PUT 看请求体的顶层键。所以"你配了什么，他就能改什么"，不用另填说明。
 *
 * 新建 / 编辑跳到独立页面 `/tools/http`（原来那个底部弹层会被导航挡住）。
 */
export function HttpTools() {
  const tools = useApp((s) => s.httpTools);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [added, setAdded] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  /**
   * 一键加示例 —— 按**名字**去重，点几次都不会重复加。
   *
   * 为什么需要它（不只是把示例写进默认值就完事）：
   * 默认值只对**全新安装**生效，老用户（比如手机上已经装好的）永远看不到。
   * 有了这个按钮，装上新版点一下就有了，不用手动抄地址。
   */
  function addExamples() {
    const st = useApp.getState();
    const have = new Set(st.httpTools.map((t) => t.name));
    let n = 0;
    for (const ex of EXAMPLE_HTTP_TOOLS) {
      if (have.has(ex.name)) continue;
      const { id: _drop, ...rest } = ex;
      st.addHttpTool(rest);
      n += 1;
    }
    setAdded(n > 0 ? `加进来了 ${n} 个示例` : "示例都已经有了");
    window.setTimeout(() => setAdded(""), 4000);
  }

  async function run(tool: HttpTool) {
    setRunning(tool.id);
    const started = performance.now();
    try {
      // 跟"星芒自己调"共用同一份请求构造（lib/http-tools.ts）——
      // 以前这套逻辑写在这个组件里，模型那条路再抄一遍就迟早走偏
      const built = buildHttpRequest(tool);
      if (!built.ok) {
        setResults((m) => ({
          ...m,
          [tool.id]: { status: 0, ms: 0, text: "", error: built.error },
        }));
        return;
      }
      const res = await fetch(built.url, built.init);
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
      <div className="flex items-center justify-between px-1 pb-0.5">
        <p className="font-mono text-[9px] tracking-[0.14em] text-subtle">
          HTTP · {tools.length} 个
        </p>
        <Link to="/tools/http" search={{}} className="text-[11px] text-muted">
          ＋ 新建
        </Link>
      </div>

      {tools.length === 0 && (
        <p className="py-8 text-center text-[12px] text-muted">还没有工具，点右上角新建一个</p>
      )}

      <div className="tool-stack space-y-2">
        {tools.map((t, i) => {
        const r = results[t.id];
        const ok = r && !r.error && r.status >= 200 && r.status < 300;
        const open = openId === t.id;
        const params = paramsOfTool(t);
        return (
          <article
            key={t.id}
            data-method={t.method}
            className={cn("overflow-hidden rounded-xl border border-line bg-surface p-3", "tool-card", open && "open", !t.enabled && "off")}
          >
            <span className="tool-tab" aria-hidden />
            <span className="tool-fold" aria-hidden />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : t.id)}
                aria-expanded={open}
                className="tool-hit min-w-0 flex-1"
              >
                <span className="tool-r1">
                  <span className="tool-name">{t.name}</span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 shrink-0 text-subtle transition-transform duration-200",
                      open && "rotate-180",
                    )}
                  />
                  <span className="tool-host">{hostOf(t.url)}</span>
                </span>
                <span className="tool-r2">
                  <span className="tool-mk">{t.method}</span>
                  <span className={cn("tool-st", t.enabled && "on")}>
                    {t.enabled ? "已启用" : "已停用"}
                  </span>
                  <span className="tool-no">No.{String(i + 1).padStart(2, "0")}</span>
                </span>
              </button>
              <Switch
                checked={t.enabled}
                label={t.name}
                onCheckedChange={(v) => useApp.getState().patchHttpTool(t.id, { enabled: v })}
              />
            </div>

            {open && (
              <div className="tool-zone">
                <div className="tool-row">
                  <i>地址</i>
                  <span>{t.url || "(未填地址)"}</span>
                </div>
                {t.description && (
                  <div className="tool-row">
                    <i>说明</i>
                    <span>{t.description}</span>
                  </div>
                )}
                {/* 「星芒能改哪几个值」直接摆出来（推导规则见 lib/http-tools.ts） */}
                {params.length > 0 && (
                  <div className="tool-row">
                    <i>参数</i>
                    <span>{params.join("、")}</span>
                  </div>
                )}

                <div className="tool-acts">
                  <button
                    type="button"
                    onClick={() => void run(t)}
                    disabled={running === t.id}
                    className="flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-ink-fg disabled:opacity-60"
                  >
                    {running === t.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Play className="size-3" />
                    )}
                    调用
                  </button>
                  {/* 用 Link（真链接）而不是 button + navigate：能长按、能新开、无障碍也对 */}
                  <Link
                    to="/tools/http"
                    search={{ id: t.id }}
                    aria-label="编辑"
                    className="flex size-8 items-center justify-center rounded-full bg-chip text-muted"
                  >
                    <Pencil className="size-3.5" />
                  </Link>
                  <button
                    type="button"
                    aria-label="删除"
                    onClick={() => useApp.getState().removeHttpTool(t.id)}
                    className="flex size-8 items-center justify-center rounded-full bg-chip text-muted"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  {!t.enabled && (
                    <span className="tool-off-stamp" aria-hidden>
                      停用
                    </span>
                  )}
                </div>

                {r && (
                  <div className="mt-2 rounded-lg bg-chip px-2.5 py-2">
                    <p className={cn("text-[11px] font-medium", ok ? "text-ok" : "text-warn")}>
                      {r.error ? "请求失败" : `HTTP ${r.status}`} · {r.ms}ms
                    </p>
                    <pre className="mt-1 max-h-40 overflow-auto font-mono text-[10px] leading-[1.6] break-all whitespace-pre-wrap text-muted">
                      {r.error ?? (r.text || "(空响应)")}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </article>
        );
        })}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <Link
          to="/tools/http"
          search={{}}
          className="tool-add flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-[12px] text-muted"
        >
          <Plus className="size-3.5" />
          新建
        </Link>
        {/* 一键加示例：给"不知道该填什么"的人一个起点，按名字去重 */}
        <button
          type="button"
          onClick={addExamples}
          className="tool-add flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted"
        >
          <Sparkles className="size-3.5" />
          示例
        </button>
      </div>
      {added && <p className="px-1 text-[11px] text-accent">{added}</p>}

      <details className="px-1 pt-1">
        <summary className="cursor-pointer text-[11px] text-subtle">说明 · 这个标签怎么用</summary>
        <div className="space-y-1.5 pt-1.5 text-[11px] leading-[1.6] text-subtle">
          <p>
            自己填地址和请求头，点「调用」会真的发一次请求 —— 不依赖 AI。浏览器有跨域（CORS）
            限制，对方服务器不放开的话会被挡住。
          </p>
          <p>
            星芒也能调它：他会按工具名提议、过你的权限闸门之后真的发出去。「可改的参数」是从你配好的请求里读出来的（GET
            看网址里的查询参数，POST 看请求体的字段）—— 想让某个值能被改，就把它先填进网址或请求体。
          </p>
          <p>
            示例都是实测能在浏览器里调通的公开接口；「微博热搜 / 抖音热榜」需要你自己的
            key（默认关着，去 tianapi.com 免费注册拿到 key 填进网址再打开）。
          </p>
        </div>
      </details>
    </div>
  );
}
