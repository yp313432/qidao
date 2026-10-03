import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ActionGate } from "@/components/action-gate";
import { LetterAlert } from "@/components/letter-alert";
import { GlassHighlight } from "@/components/glass-highlight";
import { PlayerHost } from "@/components/player-host";
import { EmbedHost } from "@/components/play/embed-host";
import { ReminderDaemon } from "@/components/reminder-daemon";
import { AlarmOverlay } from "@/components/alarm-overlay";
import { TaskDaemon } from "@/components/task-daemon";
import { UiEffects } from "@/components/ui-effects";
import { useApp } from "@/lib/store";
import { MAIN_TABS, tabOwning } from "@/lib/tabs";
import { cn } from "@/lib/utils";

const TABS = MAIN_TABS;

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  /**
   * 什么时候不显示底部导航：
   *   · 玩乐的子页（自己带返回，本来就没有）
   *
   * 对话页**要显示**。以前这里把对话页也排除掉，是因为抽屉底部自带了一套
   * 四项导航；于是全 App 出现两份导航实现，样子还不一样（抽屉那套是横向
   * 铺满 + 分隔线，别的页面是漂浮胶囊），高亮规则也不一致。
   *
   * 用户的原话："底部导航栏改一下，不要放在侧边栏，就放下面，但是还要省空间"。
   * 文档第十节：主导航保持底部四项，移动端不要移到侧边栏；二级页用左上角
   * 返回，不再额外放一套永久导航。
   *
   * 所以现在**只留这一个底部胶囊**，抽屉那套撤掉了。
   * 打字时仍然收下去给消息让地方（见下面 keyboardUp）。
   */
  const hideNav = pathname.startsWith("/play/") && pathname !== "/play";
  /** 打字中：把导航收下去，给消息让地方 */
  const keyboardUp = useApp((s) => s.keyboardUp);

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
      {/* 定时任务：到点让他自己开口（App 活着时；关掉时靠原生通知兜底） */}
      <TaskDaemon />
      {/* 闹钟到点：全屏响铃（只发通知的话人会睡过去） */}
      <AlarmOverlay />
      {/* AI 请求的任何操作都要从这里过一道（询问 / 允许 / 拒绝） */}
      <ActionGate />
      {/* 他写了新信：一进前端就跳出拆信动画 */}
      <LetterAlert />
      <div key={pathname} className="view-enter flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
      {!hideNav && (
        /**
         * 浮层而非占位：导航飘在背景之上，内容可以一直铺到屏幕底部。
         *
         * 打字时**滑下去收起** —— 用户的反馈：导航 + 输入框加起来占了快半个屏幕，
         * 键盘一弹起来就看不到几条消息了。收下去而不是拆掉，失焦就回来。
         */
        <div
          className={cn(
            // z-[60]：必须高于对话抽屉（z-50）。抽屉自带的那套四项导航撤掉之后，
            // 底部这个胶囊就是**唯一**的导航入口 —— 抽屉只占左边 84% 宽，
            // 胶囊在右边还露得出来，用户才能一边看列表一边切页。
            "pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-all duration-200",
            keyboardUp && "pointer-events-none translate-y-[135%] opacity-0",
          )}
        >
          <nav
            className="glass-nav pointer-events-auto flex items-center gap-0.5 rounded-full border border-line p-1"
            aria-label="主导航"
          >
            {TABS.map((tab) => {
              const active = tabOwning(pathname) === tab.to;
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // 尺寸照示例图收过：胶囊高 63 → 48px，底部留白 77 → 62px。
                    // 用户的要求是"放下面，但是还要省空间"。
                    "flex min-w-[56px] flex-col items-center gap-px rounded-full px-3 py-1 text-[10px] font-medium tracking-wide transition-colors",
                    active ? "glass-active text-fg" : "text-muted",
                  )}
                >
                  <Icon
                    className="size-[1.15rem]"
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