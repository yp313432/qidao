import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Puzzle, Sparkles, UserRound } from "lucide-react";
import { ActionGate } from "@/components/action-gate";
import { LetterAlert } from "@/components/letter-alert";
import { GlassHighlight } from "@/components/glass-highlight";
import { PlayerHost } from "@/components/player-host";
import { EmbedHost } from "@/components/play/embed-host";
import { ReminderDaemon } from "@/components/reminder-daemon";
import { UiEffects } from "@/components/ui-effects";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "对话", icon: MessageCircle, hint: "chat" },
  { to: "/tools", label: "工具", icon: Puzzle, hint: "tools" },
  { to: "/play", label: "玩乐", icon: Sparkles, hint: "play" },
  { to: "/me", label: "我的", icon: UserRound, hint: "me" },
] as const;

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hideNav = pathname.startsWith("/play/") && pathname !== "/play";

  return (
    // h-dvh + overflow-hidden 是关键：以前写的是 min-h-dvh，容器会随内容长高，
    // 于是整个「窗口」在滚 —— 页面里那些 overflow-y-auto 全是摆设，
    // 长对话打开时停在最旧的一条，输入框在几千像素以外。
    <div className="relative z-10 mx-auto flex h-dvh w-full max-w-lg flex-col overflow-hidden text-fg">
      <GlassHighlight />
      {/* 「高亮某处 / 滚动到某处」这类界面动作由它执行 */}
      <UiEffects />
      {/* 全局音乐播放器：整个 App 只此一个 <audio>，切页不会停 */}
      <PlayerHost />
      {/* 外链播放器的宿主：iframe 卸载就断声，所以它一直挂着，切页时挪到屏幕外 */}
      <EmbedHost />
      {/* 本地提醒 + Service Worker 注册 */}
      <ReminderDaemon />
      {/* AI 请求的任何操作都要从这里过一道（询问 / 允许 / 拒绝） */}
      <ActionGate />
      {/* 他写了新信：一进前端就跳出拆信动画 */}
      <LetterAlert />
      <div key={pathname} className="view-enter flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
      {!hideNav && (
        // 浮层而非占位：导航飘在背景之上，内容可以一直铺到屏幕底部。
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[max(0.9rem,env(safe-area-inset-bottom))]">
          <nav
            className="glass-nav pointer-events-auto flex items-center gap-0.5 rounded-full border border-line p-1.5"
            aria-label="主导航"
          >
            {TABS.map((tab) => {
              const active =
                tab.to === "/"
                  ? pathname === "/"
                  : pathname === tab.to || pathname.startsWith(`${tab.to}/`);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-w-[58px] flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-[10px] font-medium tracking-wide transition-colors",
                    active ? "glass-active text-fg" : "text-muted",
                  )}
                >
                  <Icon
                    className="size-5"
                    strokeWidth={active ? 2.2 : 1.7}
                    aria-hidden="true"
                  />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}