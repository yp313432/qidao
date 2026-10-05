import { createFileRoute } from "@tanstack/react-router";
import { OAuthCallback } from "@/components/tools/oauth-callback";

/**
 * OAuth 回调落地页（`/oauth/callback?code=...`）。
 *
 * 刻意**不放在 `_app` 布局里**：它是从授权服务器跳回来的落地页，
 * 不该套上 AppShell 的导航和返回钮。`redirectUri()` 里拼的就是这个地址。
 */

function OAuthCallbackRoute() {
  const search = Route.useSearch();
  return <OAuthCallback search={search} />;
}

export const Route = createFileRoute("/oauth/callback")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { code?: string; state?: string; error?: string; error_description?: string } => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    error_description:
      typeof search.error_description === "string" ? search.error_description : undefined,
  }),
  component: OAuthCallbackRoute,
});
