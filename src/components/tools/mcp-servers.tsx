import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { KeyRound, Loader2, Pencil, Plus, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { probeServer } from "@/lib/mcp";
import { isAuthorized, planAuthorize } from "@/lib/mcp-oauth";
import { useApp } from "@/lib/store";
import type { McpOAuth, McpServer } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * MCP 服务器**列表**。
 *
 * 新建 / 编辑跳到独立页面 `/tools/mcp`（编辑某一条带 `?id=`）——
 * 原来的底部弹层是 `z-40`，被 `z-60` 的底部导航压住，最后那栏「请求头」
 * 用户根本看不见（实测截图）。
 *
 * 「测试连接」走的是**真握手**（`lib/mcp.ts`）：initialize →
 * notifications/initialized → tools/list，所以结论是"拿到 N 个工具"，
 * 不是含糊的"握手成功"。
 *
 * 对方要认证时分两种：
 *   · 标准 OAuth 服务（有受保护资源元数据）→ 给「去授权」，走
 *     `lib/mcp-oauth.ts` 那整套（发现 → 动态注册 → PKCE → 浏览器 → 换令牌）
 *   · 不是 → 老实说"只能在请求头里手填令牌"
 */
export function McpServers() {
  const servers = useApp((s) => s.mcp);
  const [testing, setTesting] = useState<string | null>(null);
  const [authing, setAuthing] = useState<string | null>(null);
  const [authError, setAuthError] = useState<{ id: string; message: string } | null>(null);

  async function test(server: McpServer) {
    setTesting(server.id);
    const result = await probeServer(server);
    const patch: Partial<McpServer> = {
      status: { ok: result.ok, at: Date.now(), message: result.message, needsAuth: result.needsAuth },
      // 工具清单落库 —— 这个字段一直有，但以前从来没被填过
      tools: result.tools,
    };
    // 探测过程中续期出来的新令牌，写回去
    if (result.oauthPatch) {
      patch.oauth = { ...(server.oauth ?? { clientId: "" }), ...result.oauthPatch } as McpOAuth;
    }
    useApp.getState().patchMcp(server.id, patch);
    setTesting(null);
  }

  /**
   * 「去授权」：发现 → 动态注册（第一次才做）→ PKCE → 跳到授权页。
   * 授权完成后浏览器会跳回 `/oauth/callback`，那边负责换令牌。
   */
  async function authorize(server: McpServer) {
    setAuthing(server.id);
    setAuthError(null);
    try {
      const plan = await planAuthorize(server);
      // client_id 存下来，下次不用重复注册
      useApp.getState().patchMcp(server.id, {
        oauth: { ...(server.oauth ?? { clientId: plan.persist.clientId }), ...plan.persist },
      });
      window.location.assign(plan.url);
    } catch (err) {
      setAuthError({ id: server.id, message: (err as Error).message });
      setAuthing(null);
    }
  }

  function disconnect(server: McpServer) {
    useApp.getState().patchMcp(server.id, { oauth: undefined, tools: [], status: undefined });
    setAuthError(null);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-dashed border-line px-4 py-3">
        <p className="text-[13px] font-medium">填你自己的 MCP 服务器地址</p>
        <p className="mt-1 text-[12px] leading-5 text-muted">
          「测试连接」会真的走一遍 MCP 握手，并把它到底有哪些工具列出来 ——
          看到<span className="font-medium text-fg">「拿到 N 个工具」</span>才算连上。
          对方要认证时：如果是标准 OAuth 服务，会给一个
          <span className="font-medium text-fg">「去授权」</span>
          按钮，跳浏览器授权完就能用；不是的话只能在「请求头」里手填令牌。
          目前只支持 HTTP（Streamable HTTP）地址。
        </p>
      </div>

      {servers.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">还没有 MCP 服务器，点下面添加</p>
      )}

      {servers.map((s) => {
        const authorized = isAuthorized(s);
        const needsAuth = Boolean(s.status?.needsAuth) && !authorized;
        return (
          <article key={s.id} className="rounded-3xl border border-line bg-surface px-4 py-3">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-full px-2.5 py-1 font-mono text-[11px] uppercase",
                  s.transport === "http" ? "bg-chip" : "bg-chip text-warn",
                )}
              >
                {s.transport}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.name}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                  {s.url || "(未填地址)"}
                </p>
                {s.description && (
                  <p className="mt-1 text-[12px] leading-5 text-muted">{s.description}</p>
                )}
              </div>
              <Switch
                checked={s.enabled}
                label={s.name}
                onCheckedChange={() => useApp.getState().toggleMcp(s.id)}
              />
            </div>

            {/* 授权状态：一句话说清"现在能不能用" */}
            {authorized && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ok">
                <ShieldCheck className="size-3.5 shrink-0" />
                已授权（令牌存在本机）
                {s.oauth?.expiresAt
                  ? `，${new Date(s.oauth.expiresAt).toLocaleString("zh-CN", { hour12: false })} 过期，会自动续`
                  : ""}
              </p>
            )}

            {/* 握手真的问到了工具，就摆出来 —— 这才是"能用"的样子 */}
            {s.tools.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {s.tools.map((t) => (
                  <span
                    key={t.name}
                    className="rounded-full bg-chip px-2.5 py-1 font-mono text-[11px] text-muted"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void test(s)}
                disabled={testing === s.id}
                className="flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[13px] font-medium text-ink-fg disabled:opacity-60"
              >
                {testing === s.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Wifi className="size-3.5" />
                )}
                {testing === s.id ? "正在握手…" : "测试连接"}
              </button>

              {/* 对方要认证、而且它是标准 OAuth 服务 → 给主要入口 */}
              {needsAuth && (
                <button
                  type="button"
                  onClick={() => void authorize(s)}
                  disabled={authing === s.id}
                  className="flex items-center gap-1.5 rounded-full border border-fg px-3.5 py-2 text-[13px] font-medium disabled:opacity-60"
                >
                  {authing === s.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="size-3.5" />
                  )}
                  {authing === s.id ? "准备授权…" : "去授权"}
                </button>
              )}

              {authorized && (
                <button
                  type="button"
                  onClick={() => disconnect(s)}
                  className="rounded-full bg-chip px-3.5 py-2 text-[13px] text-muted"
                >
                  断开授权
                </button>
              )}

              <Link
                to="/tools/mcp"
                search={{ id: s.id }}
                aria-label="编辑"
                className="rounded-full bg-chip p-2 text-muted"
              >
                <Pencil className="size-3.5" />
              </Link>
              <button
                type="button"
                aria-label="删除"
                onClick={() => useApp.getState().removeMcp(s.id)}
                className="rounded-full bg-chip p-2 text-muted"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {authError?.id === s.id && (
              <pre className="mt-2.5 max-h-52 overflow-auto rounded-2xl bg-chip px-3 py-2.5 font-mono text-[11px] leading-5 break-all whitespace-pre-wrap text-warn">
                {authError.message}
              </pre>
            )}

            {s.status && (
              <div className="mt-2.5 rounded-2xl bg-chip px-3 py-2.5">
                <p className={cn("text-[12px] font-medium", s.status.ok ? "text-ok" : "text-warn")}>
                  {s.status.ok ? "连通" : "未连通"}
                </p>
                <pre className="mt-1.5 max-h-40 overflow-auto font-mono text-[11px] leading-5 break-all whitespace-pre-wrap text-muted">
                  {s.status.message}
                </pre>
              </div>
            )}
          </article>
        );
      })}

      <Link
        to="/tools/mcp"
        search={{}}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm text-muted"
      >
        <Plus className="size-4" />
        添加 MCP 服务器
      </Link>
    </div>
  );
}
