import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Wifi,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { probeServer } from "@/lib/mcp";
import { isAuthorized, planAuthorize } from "@/lib/mcp-oauth";
import { openAuthorizeUrl } from "@/lib/mcp-oauth-browser";
import { useApp } from "@/lib/store";
import type { McpOAuth, McpServer } from "@/lib/types";
import { cn } from "@/lib/utils";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url || "(未填地址)";
  }
}

/**
 * MCP 服务器**列表**。
 *
 * 2026-11 用户嫌"每个都好大一块、全是解释性话语"——改成一行一个服务器，
 * 点行展开：授权状态、拿到的工具、测试/授权/断开/编辑/删除都收进展开区。
 * 原来压在最前面的说明收进底部「说明」折叠。
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
  const [openId, setOpenId] = useState<string | null>(null);

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
      /*
        跳出去授权。
        ⚠️ App（真机）里这是**系统浏览器**，App 会退到后台 ——
        所以先写一条状态留在卡片上：回来后一眼能看出"刚才那一步做了"，
        而失败时也有个东西可看（真机上"回到 App 什么都没发生"最让人懵）。
      */
      useApp.getState().patchMcp(server.id, {
        status: {
          ok: false,
          at: Date.now(),
          // 保留 needsAuth：万一人从浏览器空手回来，还能再点一次「去授权」
          needsAuth: true,
          message:
            "已经跳到浏览器等你授权了。\n授权完回到栖岛，这里会自动变成「拿到 N 个工具」。",
        },
      });
      await openAuthorizeUrl(plan.url);
      /*
        ⚠️ 这里必须把 loading 复位。
        网页版跳走之后这一行没意义（页面已经卸载），但 **App 里不会跳走** ——
        它是"开系统浏览器 + App 退到后台"，函数照常往下走。
        少了这一行，用户从浏览器回来会看到一个**永久卡在"准备授权…"**的按钮，
        既点不动、也看不出该干嘛（实测抓到的）。
      */
      setAuthing(null);
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
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 pb-0.5">
        <p className="font-mono text-[9px] tracking-[0.14em] text-subtle">
          MCP · {servers.length} 个
        </p>
        <Link to="/tools/mcp" search={{}} className="text-[11px] text-muted">
          ＋ 添加
        </Link>
      </div>

      {servers.length === 0 && (
        <p className="py-8 text-center text-[12px] text-muted">还没有 MCP 服务器，点右上角添加</p>
      )}

      <div className="tool-stack space-y-2">
        {servers.map((s, i) => {
        const authorized = isAuthorized(s);
        const needsAuth = Boolean(s.status?.needsAuth) && !authorized;
        const open = openId === s.id;
        return (
          <article
            key={s.id}
            data-method="MCP"
            className={cn("overflow-hidden rounded-xl border border-line bg-surface p-3", "tool-card", open && "open", !s.enabled && "off")}
          >
            <span className="tool-tab" aria-hidden />
            <span className="tool-fold" aria-hidden />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : s.id)}
                aria-expanded={open}
                className="tool-hit min-w-0 flex-1"
              >
                <span className="tool-r1">
                  <span className="tool-name">{s.name}</span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 shrink-0 text-subtle transition-transform duration-200",
                      open && "rotate-180",
                    )}
                  />
                  <span className="tool-host">{hostOf(s.url)}</span>
                </span>
                <span className="tool-r2">
                  <span className="tool-mk uppercase">{s.transport}</span>
                  <span className={cn("tool-st", s.enabled && "on")}>
                    {s.enabled ? "已启用" : "已停用"}
                  </span>
                  <span className="tool-no">No.{String(i + 1).padStart(2, "0")}</span>
                </span>
              </button>
              <Switch
                checked={s.enabled}
                label={s.name}
                onCheckedChange={() => useApp.getState().toggleMcp(s.id)}
              />
            </div>

            {open && (
              <div className="tool-zone">
                <div className="tool-row">
                  <i>地址</i>
                  <span>{s.url || "(未填地址)"}</span>
                </div>
                {s.description && (
                  <div className="tool-row">
                    <i>说明</i>
                    <span>{s.description}</span>
                  </div>
                )}

                {/* 授权状态：一句话说清"现在能不能用" */}
                {authorized && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ok">
                    <ShieldCheck className="size-3 shrink-0" />
                    已授权（令牌存在本机）
                    {s.oauth?.expiresAt
                      ? `，${new Date(s.oauth.expiresAt).toLocaleString("zh-CN", { hour12: false })} 过期`
                      : ""}
                  </p>
                )}

                {/* 握手真的问到了工具，就摆出来 —— 这才是"能用"的样子 */}
                {s.tools.length > 0 && (
                  <div className="mt-1.5 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                    {s.tools.map((t) => (
                      <span
                        key={t.name}
                        className="tool-chip rounded border border-line px-1.5 py-0.5 font-mono text-[9px] text-muted"
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void test(s)}
                    disabled={testing === s.id}
                    className="flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-ink-fg disabled:opacity-60"
                  >
                    {testing === s.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Wifi className="size-3" />
                    )}
                    {testing === s.id ? "握手中…" : "测试连接"}
                  </button>

                  {/* 对方要认证、而且它是标准 OAuth 服务 → 给主要入口 */}
                  {needsAuth && (
                    <button
                      type="button"
                      onClick={() => void authorize(s)}
                      disabled={authing === s.id}
                      className="flex items-center gap-1 rounded-full border border-fg px-3 py-1.5 text-[12px] font-medium disabled:opacity-60"
                    >
                      {authing === s.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <KeyRound className="size-3" />
                      )}
                      {authing === s.id ? "准备授权…" : "去授权"}
                    </button>
                  )}

                  {authorized && (
                    <button
                      type="button"
                      onClick={() => disconnect(s)}
                      className="rounded-full bg-chip px-3 py-1.5 text-[12px] text-muted"
                    >
                      断开授权
                    </button>
                  )}

                  <Link
                    to="/tools/mcp"
                    search={{ id: s.id }}
                    aria-label="编辑"
                    className="flex size-8 items-center justify-center rounded-full bg-chip text-muted"
                  >
                    <Pencil className="size-3.5" />
                  </Link>
                  <button
                    type="button"
                    aria-label="删除"
                    onClick={() => useApp.getState().removeMcp(s.id)}
                    className="flex size-8 items-center justify-center rounded-full bg-chip text-muted"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  {!s.enabled && (
                    <span className="tool-off-stamp" aria-hidden>
                      停用
                    </span>
                  )}
                </div>

                {authError?.id === s.id && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-chip px-2.5 py-2 font-mono text-[10px] leading-[1.6] break-all whitespace-pre-wrap text-warn">
                    {authError.message}
                  </pre>
                )}

                {s.status && (
                  <div className="mt-2 rounded-lg bg-chip px-2.5 py-2">
                    <p
                      className={cn(
                        "text-[11px] font-medium",
                        s.status.ok ? "text-ok" : "text-warn",
                      )}
                    >
                      {s.status.ok ? "连通" : "未连通"}
                    </p>
                    <pre className="mt-1 max-h-32 overflow-auto font-mono text-[10px] leading-[1.6] break-all whitespace-pre-wrap text-muted">
                      {s.status.message}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </article>
        );
        })}
      </div>

      <Link
        to="/tools/mcp"
        search={{}}
        className="tool-add flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-[12px] text-muted"
      >
        <Plus className="size-3.5" />
        添加 MCP 服务器
      </Link>

      <details className="px-1 pt-1">
        <summary className="cursor-pointer text-[11px] text-subtle">说明 · 怎么填、怎么连</summary>
        <div className="space-y-1.5 pt-1.5 text-[11px] leading-[1.6] text-subtle">
          <p>
            「测试连接」会真的走一遍 MCP 握手，并把它到底有哪些工具列出来 —— 看到「拿到 N
            个工具」才算连上。
          </p>
          <p>
            对方要认证时：如果是标准 OAuth 服务，会给一个「去授权」按钮，跳浏览器授权完就能用；不是的话只能在「请求头」里手填令牌。目前只支持
            HTTP（Streamable HTTP）地址。
          </p>
        </div>
      </details>
    </div>
  );
}
