import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Pencil, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { buildHttpRequest, paramsOfTool } from "@/lib/http-tools";
import { EXAMPLE_HTTP_TOOLS, useApp } from "@/lib/store";
import type { HttpTool } from "@/lib/types";
import { cn } from "@/lib/utils";

type Result = { status: number; ms: number; text: string; error?: string };

/**
 * HTTP 工具**列表**。
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
      <p className="px-1 pb-1 text-[12px] leading-5 text-muted">
        自己填地址和请求头，点「调用」会<span className="font-medium text-fg">真的</span>
        发一次请求 —— 不依赖 AI。浏览器有跨域（CORS）限制，对方服务器不放开的话会被挡住。
        <br />
        <span className="font-medium text-fg">星芒也能调它</span>
        ：他会按工具名提议、过你的权限闸门之后真的发出去。
        「可改的参数」是从你配好的请求里读出来的（GET 看网址里的查询参数，
        POST 看请求体的字段）—— 想让某个值能被改，就把它先填进网址或请求体。
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
                {/*
                  把"星芒能改哪几个值"直接摆在卡片上 —— 否则用户根本不知道
                  自己配的请求里哪些部分是可被模型改的（推导规则见 lib/http-tools.ts）
                */}
                {paramsOfTool(t).length > 0 && (
                  <p className="mt-1 font-mono text-[11px] leading-4 text-subtle">
                    可改参数：{paramsOfTool(t).join("、")}
                  </p>
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

      {/*
        一键加示例：给"不知道该填什么"的人一个起点（原话："HTTP 工具一般是
        用来干嘛的？我对他不是很了解"）。按名字去重，点几次都安全。
      */}
      <button
        type="button"
        onClick={addExamples}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm text-muted"
      >
        <Sparkles className="size-4" />
        加几个能用的示例（新闻 / 天气 / 热搜 / 搜 GitHub …）
      </button>
      {added && <p className="px-1 pt-1 text-[12px] text-accent">{added}</p>}

      <p className="px-1 pt-2 text-[11px] leading-4 text-subtle">
        示例都是<span className="text-fg">实测能在浏览器里调通</span>的公开接口。
        其中「微博热搜 / 抖音热榜」<span className="text-fg">需要你自己的 key</span>
        （默认关着，去 tianapi.com 免费注册拿到 key 填进网址再打开）。
        像「抓普通网页」那种做不到 —— 浏览器有跨域限制，绝大多数网站不允许别的页面读它的内容
        （百度、example.com 都试过，会被挡住）。
      </p>
    </div>
  );
}
