import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { BackgroundLayer } from "@/components/background-layer";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { ThemeRoot } from "@/components/theme-root";
import appCss from "../styles.css?url";

const APP_NAME = "栖岛";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      /*
        锁掉双指缩放（用户："有时候双指一托放，界面放大了。咱们这个不是已经
        成了 APP 吗？为什么页面还会像网页一样放大？"）。

        原因：原来只有 `width=device-width, initial-scale=1` —— **没锁缩放**，
        WebView 就按网页那套允许捏合放大。
        而"有时候能放、有时候不能"是因为捏合缩放的归属权在**加载过程中会摇摆**：
        页面还没加载完时缩放归 App/WebView 管，加载完就交给网页管。

        maximum-scale=1 + user-scalable=no 是标准做法。
        注意：安卓「无障碍 → 强制启用缩放」会覆盖这一条 —— 那是系统设置，
        抓不住（也不该抓，那是给人用的）。
      */
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      { title: APP_NAME },
      { name: "theme-color", content: "#f6f3ee" },
      { name: "description", content: "栖岛 — 安静的对话、思考链与小游戏。" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "apple-touch-icon", sizes: "192x192", href: "/icon-192.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        /*
         * Cormorant Garamond（斜体）是**玩乐区首页那几句英文装饰**专用的。
         *
         * 用户要的是"飘逸那种的，这个和系统字体不一样，只作为装饰"。
         * 它跟正文完全分开：只在 `--font-script` 里用，正文一个字都不碰。
         *
         * ⚠️ 它从 Google Fonts 拉。断网时浏览器会回退到下一个候选（衬线），
         *    那几行还是能看，只是没有飘逸感 —— 不会白屏或报错。
         */
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&family=Cormorant+Garamond:ital,wght@1,300;1,400;0,300&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('aster-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <PreviewHostBridge />
        <BackgroundLayer />
        <AuthProvider>
          <ThemeRoot>
            <Outlet />
          </ThemeRoot>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
