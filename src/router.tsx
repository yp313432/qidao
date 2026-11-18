import { createRouter } from "@tanstack/react-router";
import { RoutePending } from "@/components/shell/route-pending";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    /*
     * 加载反馈（2026-11 性能排查，业内通行做法）：
     * 切二级页慢主要慢在「页面的 JS chunk 还没下载完」，以前这段时间界面干等。
     * 等满 200ms 还没好才出现顶部那条 2px 细线；全程只动 transform，不占布局。
     * 快的时候看不到，慢的时候至少知道"在加载"，而不是"点了没反应"。
     */
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 200,
    defaultPendingMinMs: 320,
    /*
     * 切页提速（APK 的 WebView 上切标签要等 1–2 秒）：
     * 预加载只对 <Link> 生效；抽屉里那八条是 <button>，所以在
     * chat-drawer.tsx 里打开抽屉时手动 preloadRoute（见那里的注释）。
     */
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
  });
}
