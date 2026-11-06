import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    /*
     * 切页提速（APK 的 WebView 上切标签要等 1–2 秒）：
     * 手指按到导航项那一刻就开始预加载那个路由的 chunk，
     * 等真正点下去时 JS 已经就位。
     */
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
  });
}
