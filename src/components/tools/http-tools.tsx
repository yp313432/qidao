import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Pencil, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { ToolCard } from "@/components/tools/tool-card";
import { KButton, KChip, KEmpty, KSwitch } from "@/components/ui-kit";
import { buildHttpRequest, executeHttpRequest, paramsOfTool } from "@/lib/http-tools";
import { EXAMPLE_HTTP_TOOLS, useApp } from "@/lib/store";
import type { HttpTool } from "@/lib/types";

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
 *
 * 2026-11-07 阶段3 迁移：外框从手写的 `.tool-card` 换成 kit 的
 * `ToolCard`（`.k-card`）—— 三套材质各自靠变量变样子，这里一个颜色都不写。
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
      const res = await executeHttpRequest(built);
      const text = res.text.slice(0, 4000);
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
          error: `${(err as Error).message || "请求失败"}\n\n浏览器中请检查对方是否开放跨域（CORS）；App 中请检查地址、鉴权或网络。`,
        },
      }));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="k-list">
      <div className="k-sect">
        <p className="k-sect__title">HTTP · {tools.length} 个</p>
        <Link to="/tools/http" search={{}} className="k-sect__act">
          ＋ 新建
        </Link>
      </div>

      {tools.length === 0 && (
        <KEmpty title="还没有工具" hint="点右上角「新建」加一个，或者先加几个示例试试。" />
      )}

      <div className="k-list">
        {tools.map((t, i) => {
          const r = results[t.id];
          const ok = r && !r.error && r.status >= 200 && r.status < 300;
          const open = openId === t.id;
          const params = paramsOfTool(t);
          return (
            <ToolCard
              key={t.id}
              title={t.name}
              off={!t.enabled}
              open={open}
              onToggle={() => setOpenId(open ? null : t.id)}
              trailing={
                <KSwitch
                  checked={t.enabled}
                  label={t.name}
                  onChange={(v) => useApp.getState().patchHttpTool(t.id, { enabled: v })}
                />
              }
              meta={
                <>
                  <KChip>{t.method}</KChip>
                  <span className="k-clip">{hostOf(t.url)}</span>
                  <span className="k-stat" data-tone={t.enabled ? "ok" : undefined}>
                    {t.enabled ? "已启用" : "已停用"}
                  </span>
                  <span className="k-stat">No.{String(i + 1).padStart(2, "0")}</span>
                </>
              }
            >
              <div className="k-kv">
                <span className="k-kv__k">地址</span>
                <span className="k-kv__v">{t.url || "(未填地址)"}</span>
              </div>
              {t.description && (
                <div className="k-kv">
                  <span className="k-kv__k">说明</span>
                  <span className="k-kv__v">{t.description}</span>
                </div>
              )}
              {/* 「星芒能改哪几个值」直接摆出来（推导规则见 lib/http-tools.ts） */}
              {params.length > 0 && (
                <div className="k-kv">
                  <span className="k-kv__k">参数</span>
                  <span className="k-kv__v">{params.join("、")}</span>
                </div>
              )}

              <div className="k-acts">
                <KButton variant="primary" onClick={() => void run(t)} disabled={running === t.id}>
                  {running === t.id ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                  调用
                </KButton>
                {/* 用 Link（真链接）而不是 button + navigate：能长按、能新开、无障碍也对 */}
                <Link
                  to="/tools/http"
                  search={{ id: t.id }}
                  aria-label="编辑"
                  className="k-btn k-btn--icon"
                >
                  <Pencil aria-hidden="true" />
                </Link>
                <KButton
                  variant="icon"
                  aria-label="删除"
                  onClick={() => useApp.getState().removeHttpTool(t.id)}
                >
                  <Trash2 aria-hidden="true" />
                </KButton>
                {!t.enabled && (
                  <span className="k-stat" data-tone="warn">
                    停用
                  </span>
                )}
              </div>

              {r && (
                <>
                  <p className="k-stat" data-tone={ok ? "ok" : "warn"}>
                    {r.error ? "请求失败" : `HTTP ${r.status}`} · {r.ms}ms
                  </p>
                  <pre className="k-code">{r.error ?? (r.text || "(空响应)")}</pre>
                </>
              )}
            </ToolCard>
          );
        })}
      </div>

      <div className="k-acts">
        <Link to="/tools/http" search={{}} className="k-btn k-btn--dashed k-btn--block k-grow">
          <Plus aria-hidden="true" />
          新建
        </Link>
        {/* 一键加示例：给"不知道该填什么"的人一个起点，按名字去重 */}
        <KButton variant="dashed" onClick={addExamples}>
          <Sparkles aria-hidden="true" />
          示例
        </KButton>
      </div>
      {added && (
        <p className="k-stat" data-tone="ok">
          {added}
        </p>
      )}

      <details className="k-note">
        <summary>说明 · 这个标签怎么用</summary>
        <div className="k-note__body">
          <p>
            点「新建」，填写名称、地址和请求方法；需要密钥时按接口文档填写请求头，POST 的内容填在请求体里。
            保存后点「调用」测试，启用后 AI 也能使用。
          </p>
          <p>
            App 使用系统网络发送 HTTP 请求，不受浏览器跨域（CORS）限制。网页版需要接口开放跨域，
            或填写你自己的服务端中转地址；在请求头里添加 CORS 字段不能解除限制。
          </p>
          <p>
            HTTP 工具调用你配置的接口，通常返回 JSON 或文本；网页抓取读取一个网页并提取正文，
            不用逐个添加 HTTP 工具。需要登录、验证码或依赖网页脚本生成的正文仍可能读不到。
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

