import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { completeAuthorize } from "@/lib/mcp-oauth";
import { probeServer } from "@/lib/mcp";
import { useApp } from "@/lib/store";
import type { McpTool } from "@/lib/types";

/**
 * 等 store 从 IndexedDB 恢复完再写。
 *
 * ⚠️ 这一步**不能省**，是实测踩出来的真 bug：
 * 回调页是**整页新加载**的（浏览器从授权服务器跳回来），页面一加载
 * `persist` 就开始异步读 IndexedDB。如果这时候马上 `patchMcp` 写令牌，
 * 会先写进内存、随后被**恢复出来的旧快照整个覆盖** —— 表现就是
 * "授权页明明说成功了，回列表却不显示已授权"（令牌悄悄没了）。
 * 实测就是这么报的错。所以写之前先等 `hydrated`（`theme-root.tsx` 置的位）。
 */
async function waitHydrated(): Promise<void> {
  if (useApp.getState().hydrated) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsub();
      resolve();
    };
    const unsub = useApp.subscribe((s) => {
      if (s.hydrated) finish();
    });
    // 兜底：万一位已经置过、事件错过了，或者 IndexedDB 卡住
    if (useApp.getState().hydrated) finish();
    window.setTimeout(finish, 4000);
  });
}

/**
 * OAuth 回调页 —— 用户在授权服务器那边点了"同意"，浏览器跳回来的地方。
 *
 * 这一页**故意不放在 `_app` 布局下面**：它是从外部跳回来的落地页，
 * 带着 `?code=...`，不该套上 AppShell 的导航和返回钮。所以放在
 * `src/routes/oauth/callback.tsx`，只用 `__root` 的背景和主题。
 *
 * ── 两个必须做对的细节 ─────────────────────────────────────────
 *
 * ① **防重**：授权码**只能用一次**。React 严格模式下 effect 会故意跑两遍，
 *    第二遍拿同一个 code 去换令牌就会失败（`invalid_grant`），
 *    用户看到的是"明明授权成功了却说失败"。所以这里用一个 ref 卡住。
 *
 * ② **换完令牌立刻验一次**：`completeAuthorize` 只证明"拿到了令牌"，
 *    不证明"令牌能用"。所以紧接着跑一次真握手，把工具清单显示出来 ——
 *    这才是"真的连上了"。
 */
export function OAuthCallback({
  search,
}: {
  search: { code?: string; state?: string; error?: string; error_description?: string };
}) {
  const [view, setView] = useState<
    | { kind: "working" }
    | { kind: "ok"; name: string; tools: McpTool[]; note?: string }
    | { kind: "fail"; message: string }
  >({ kind: "working" });

  /** 见上面 ① —— 这个 ref 就是防重的 */
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      const result = await completeAuthorize({
        code: search.code,
        state: search.state,
        error: search.error,
        errorDescription: search.error_description,
      });
      if (!result.ok) {
        setView({ kind: "fail", message: result.message });
        return;
      }

      // 先等恢复完，否则这次写入会被 IndexedDB 的旧快照覆盖（见 waitHydrated 的说明）
      await waitHydrated();
      const name = useApp.getState().mcp.find((m) => m.id === result.serverId)?.name ?? "MCP 服务器";
      // 令牌落库，顺手把上一次的"要认证"状态清掉
      useApp.getState().patchMcp(result.serverId, { oauth: result.oauth, status: undefined });

      // 见上面 ② —— 立刻用这个令牌握手，证明它真的能用
      const fresh = useApp.getState().mcp.find((m) => m.id === result.serverId);
      if (!fresh) {
        setView({ kind: "ok", name, tools: [], note: "令牌已保存，但找不到这条服务器记录。" });
        return;
      }
      const probe = await probeServer(fresh);
      useApp.getState().patchMcp(result.serverId, {
        status: { ok: probe.ok, at: Date.now(), message: probe.message, needsAuth: probe.needsAuth },
        tools: probe.tools,
      });
      setView({ kind: "ok", name, tools: probe.tools, note: probe.ok ? undefined : probe.message });
    })();
  }, [search.code, search.state, search.error, search.error_description]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-5 py-10">
      <div className="rounded-3xl border border-line bg-surface p-5">
        {view.kind === "working" && (
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 shrink-0 animate-spin text-muted" />
            <div>
              <p className="font-serif text-lg font-medium">正在完成授权…</p>
              <p className="mt-1 text-[12px] leading-5 text-muted">正在用授权码换令牌，马上就好。</p>
            </div>
          </div>
        )}

        {view.kind === "ok" && (
          <div>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-5 shrink-0 text-ok" />
              <p className="font-serif text-lg font-medium">「{view.name}」授权成功</p>
            </div>
            {view.tools.length > 0 ? (
              <>
                <p className="mt-2 text-[13px] leading-6 text-muted">
                  已经用这个令牌真的连上了，拿到 {view.tools.length} 个工具：
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {view.tools.map((t) => (
                    <span
                      key={t.name}
                      className="rounded-full bg-chip px-2.5 py-1 font-mono text-[11px] text-muted"
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-2 text-[13px] leading-6 text-muted">
                令牌已保存。{view.note ?? "但这个服务器没暴露任何工具。"}
              </p>
            )}
          </div>
        )}

        {view.kind === "fail" && (
          <div>
            <div className="flex items-center gap-3">
              <XCircle className="size-5 shrink-0 text-warn" />
              <p className="font-serif text-lg font-medium">授权没完成</p>
            </div>
            <pre className="mt-3 max-h-64 overflow-auto rounded-2xl bg-chip px-3 py-2.5 font-mono text-[11px] leading-5 break-all whitespace-pre-wrap text-muted">
              {view.message}
            </pre>
          </div>
        )}

        <Link
          to="/tools"
          className="mt-5 flex w-full items-center justify-center rounded-2xl border border-line py-3 text-sm text-muted"
        >
          回「工具 → MCP」
        </Link>
      </div>
    </div>
  );
}
