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
   *
   * ── 「打字时把导航收下去」这个机制**整个删掉了**（2026-10）──────────
   *
   * 用户原话（说了不止一次）：
   *   "我点开键盘之后，底部导航栏是不是没有了，中间是不是空了一块，
   *    然后我退出键盘状态之后，要点一下界面才出现导航栏，
   *    能不能直接就把导航栏不消失了，不用再点了"
   *
   * 真相是：**收下去换来的那块地方本来就是空的**（键盘上方那一段留白），
   * 等于什么也没省，却引入了"要点一下才回来"这个毛病。
   * 我前两次都在修"什么时候让它回来"，**方向就错了** ——
   * 正确做法是根本不让它消失。
   */
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
         * 底部导航：**全宽 + 贴着屏幕下边缘**的一层薄玻璃。
         *
         * 用户的要求（对着抖音那张参考图提的）：
         *   · "导航栏可以压在最底部"
         *   · "那个方形改成圆形，撑满左右边框"
         *   · "质感还是要透玻璃的"
         *
         * 所以从原来的「居中胶囊 + 两侧各留 69px + 浮起 12px」改成
         * 「左边缘贯到右边缘、紧贴屏幕底」。省下来的那 12px 浮起，
         * 让给了输入框和导航之间的**呼吸缝**（见 .pb-composer）——
         * 总占用没变，但两块玻璃不再贴在一起。
         *
         * 背景保持透明（只留一层渐变把文字托住），让用户自己那张背景图
         * 透上来；真正的"玻璃"落在激活项那个圆上。
         *
         * z-[60]：必须高于对话抽屉（z-50）。抽屉只占左边 84% 宽，
         * 导航在右边一直露着，用户才能一边看列表一边切页。
         */
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60]">
          <nav
            aria-label="主导航"
            className="glass-nav-bar pointer-events-auto flex w-full items-stretch"
          >
            {/* 四项平分，但整体限宽居中 —— 否则 390px 上四项会被拉散、飘在两头 */}
            <div className="mx-auto flex w-full max-w-sm items-stretch">
              {TABS.map((tab) => {
                const active = tabOwning(pathname) === tab.to;
                const Icon = tab.icon;
                return (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-w-0 flex-1 flex-col items-center pt-1 pb-1 text-[10px] font-medium tracking-wide transition-colors",
                      active ? "text-fg" : "text-muted",
                    )}
                  >
                    {/* 圆形：激活时这个圆变成一块玻璃高亮，图标变实 */}
                    <span
                      className={cn(
                        "mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
                        active ? "glass-active" : "",
                      )}
                    >
                      <Icon
                        className="size-[1.3rem]"
                        strokeWidth={active ? 2.2 : 1.7}
                        aria-hidden="true"
                      />
                    </span>
                    {tab.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}