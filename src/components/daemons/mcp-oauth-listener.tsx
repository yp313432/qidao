import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { completeAuthorize, parseCallbackUrl } from "@/lib/mcp-oauth";
import { closeAuthBrowser, listenAuthCallback } from "@/lib/mcp-oauth-browser";
import { probeServer } from "@/lib/mcp";
import { waitHydrated } from "@/lib/store-ready";
import { useApp } from "@/lib/store";

/**
 * **App（安卓）里的 OAuth 回跳接收器。**
 *
 * 前半截（跳去系统浏览器）在 `lib/mcp-oauth-browser.ts` 里；
 * 这里管后半截：用户在浏览器里点完"同意"，Android 用自定义 scheme
 * （`qidao://oauth/callback`）把 App 唤起来 —— 这时要把授权码换成令牌、
 * 存进记录、再**立刻用这个令牌验一次**。
 *
 * 跟网页版（`/oauth/callback` 那条路由）**共用同一套**：
 *   `parseCallbackUrl` → `completeAuthorize` → `waitHydrated` → `patchMcp` → `probeServer`
 * 所以协议逻辑只有一份，两边不会走偏。
 *
 * 挂在 AppShell 里（全 App 只此一个），因为用户点完授权回来可能停在任何页面。
 * 网页版下 `listenAuthCallback` 直接返回空函数，这个组件等于不存在。
 */
export function McpOAuthListener() {
  const navigate = useNavigate();

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    /** 收到深链之后要做的全部事情 */
    const finish = async (url: string) => {
      const params = parseCallbackUrl(url);
      // 只认我们自己的回调（别的深链别误触发）
      if (!params.code && !params.error) return;

      const result = await completeAuthorize(params);
      await closeAuthBrowser();

      if (!result.ok) {
        /*
          失败要**看得见**：真机上失败如果只是"回到 App 什么也没发生"，
          用户完全不知道发生了什么。所以把原因写在那条服务器卡片的
          状态框里（这样他回工具页就看到了）。
        */
        if (result.serverId) {
          useApp.getState().patchMcp(result.serverId, {
            status: { ok: false, at: Date.now(), message: result.message },
          });
        }
        void navigate({ to: "/tools" });
        return;
      }

      // 先等 store 恢复完再写，否则会被 IndexedDB 的旧快照覆盖（见 store-ready.ts）
      await waitHydrated();
      useApp.getState().patchMcp(result.serverId, { oauth: result.oauth, status: undefined });

      // 拿到令牌 ≠ 连上了：立刻真握一次手，把工具清单拿出来
      const fresh = useApp.getState().mcp.find((m) => m.id === result.serverId);
      if (fresh) {
        const probe = await probeServer(fresh);
        useApp.getState().patchMcp(result.serverId, {
          status: { ok: probe.ok, at: Date.now(), message: probe.message, needsAuth: probe.needsAuth },
          tools: probe.tools,
        });
      }

      // 回工具页 —— 用户刚才就是在那儿点的「去授权」，让他看到结果
      void navigate({ to: "/tools" });
    };

    void (async () => {
      stop = await listenAuthCallback((url) => {
        if (!cancelled) void finish(url);
      });
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [navigate]);

  return null;
}
