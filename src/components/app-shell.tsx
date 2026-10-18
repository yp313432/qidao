import { useEffect, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ActionGate } from "@/components/action-gate";
import { AppBack } from "@/components/app-back";
import { AudioWidget } from "@/components/audio-widget";
import { ComposerTint } from "@/components/composer-tint";
import { McpOAuthListener } from "@/components/mcp-oauth-listener";
import { LetterAlert } from "@/components/letter-alert";
import { GiftAlert } from "@/components/gift-alert";
import { GlassHighlight } from "@/components/glass-highlight";
import { PlayerHost } from "@/components/player-host";
import { EmbedHost } from "@/components/play/embed-host";
import { ReminderDaemon } from "@/components/reminder-daemon";
import { AlarmOverlay } from "@/components/alarm-overlay";
import { TaskDaemon } from "@/components/task-daemon";
import { WakePlan } from "@/components/wake-plan";
import { WakeDaemon } from "@/components/wake-daemon";
import { UiEffects } from "@/components/ui-effects";
import { hidesNav } from "@/lib/nav-tree";
import { installKeyboardInset } from "@/lib/keyboard";
import { installBreadcrumbs } from "@/lib/breadcrumbs";
import { MAIN_TABS, tabOwning } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { initShell } from "@/lib/shell";
import { useApp } from "@/lib/store";

const TABS = MAIN_TABS;

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  /**
   * 什么时候不显示底部导航 —— 规则**只定义在 nav-tree.ts 一处**
   * （`hidesNav` / `FULL_BLEED_PREFIXES`），这里不自己写路径判断：
   *
   *   · 玩乐的子页（自己带返回，本来就没有）
   *   · 工具区的编辑器页（/tools/http 这些）
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
  const hideNav = hidesNav(pathname);
  /** 这次启动是不是靠"安全带镜子"把设置救回来的（是的话界面要如实说一句） */
  const [restoredFromMirror, setRestoredFromMirror] = useState(false);
  const hydrated = useApp((s) => s.hydrated);

  /**
   * 系统栏那一层：问一次安全区高度 + 同步状态栏图标颜色（见 `lib/shell.ts`）。
   * ⚠️ 这一步**不能省** —— 系统栏透明之后，网页得知道"上面被占了多少"，
   * 否则顶栏会被状态栏压住（第一次就是这个坑）。
   */
  useEffect(() => {
    void initShell();
    /**
     * **键盘**：网页这一份兜底（`--q-ime-bottom-web`）。
     *
     * 主路径其实是**原生**推的 `--q-ime-bottom-native`（安卓 edge-to-edge 之后
     * `adjustResize` 失效、可视视口也不变小，网页自己算不出来 —— 真机验证过）。
     * 这里这份是给浏览器 / iOS 用的，两边取 `max`，互不覆盖。
     */
    const stopKeyboard = installKeyboardInset();
    /**
     * **崩溃面包屑**（2026-10，见 `lib/breadcrumbs.ts`）。
     *
     * 用户报"卡住然后闪退"，而手机侧的崩在浏览器里复现不出来 ——
     * 所以让它自己把"崩之前的最后一段时间"记在本地（心跳 / 长阻塞 / 报错 / 聊天节点），
     * 重启后在「我的 → 环境自检」里能看到现场。写操作全包 try/catch，绝不影响主流程。
     */
    const stopCrumbs = installBreadcrumbs();
    return () => {
      stopKeyboard();
      stopCrumbs();
    };
  }, []);

  /**
   * **启动自检恢复**（2026-10，起因见 `lib/data/safety.ts` 的事故复盘）。
   *
   * 如果这次读出来的设置"像被重置了"（没密钥、没地址、没模型、没背景、没自定义名字），
   * 而安全带的镜子里有一份**有料**的 → 就用镜子那份把它补回来，并**如实告诉用户**
   * （不静默：静默恢复会让人以为自己没丢过，反而更糟）。
   */
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        const [{ readSettingsMirror, mirrorIsBetter, pushSnapshot }, st] = await Promise.all([
          import("@/lib/data/safety"),
          import("@/lib/store"),
        ]);
        const cur = st.useApp.getState().settings as unknown as Record<string, unknown>;
        const mirror = await readSettingsMirror();
        if (mirrorIsBetter(mirror, cur)) {
          st.useApp.setState({ settings: { ...(cur ?? {}), ...(mirror ?? {}) } } as never);
          setRestoredFromMirror(true);
        }
        /** 每次启动压一份滚动快照（最近 3 份）——真出事了能往回翻 */
        void pushSnapshot(JSON.stringify({ state: st.useApp.getState(), at: Date.now() }));
      } catch {
        /* 安全带失败不该影响启动 */
      }
    })();
  }, [hydrated]);

  return (
    // h-dvh + overflow-hidden 是关键：以前写的是 min-h-dvh，容器会随内容长高，
    // 于是整个「窗口」在滚 —— 页面里那些 overflow-y-auto 全是摆设，
    // 长对话打开时停在最旧的一条，输入框在几千像素以外。
    //
    // ⚠️ **外壳这里不再加安全区内边距**（2026-11 用户："只有聊天界面有延伸，别的页
    // 还是能看到电量 —— 逻辑要统一"）：
    // 外壳一让位，页面**自己的背景**就被挤到那条下面去了，所以插件页/五子棋会露出
    // 一条"底"。现在口径统一成：
    //   · 页面背景**铺满**（外壳不给内边距，谁的背景都能铺到最上面）
    //   · **每一页自己的顶栏**吃 `--q-inset-top`（见各 header 的 `pt-[max(...)]`）
    <div
      className="relative z-10 mx-auto flex h-dvh w-full max-w-lg flex-col overflow-hidden text-fg"
      /**
       * 键盘让位：`max(原生推的, 网页兜底算的)`。
       * 外壳整体缩一条键盘高的下内边距 → 页面里的输入框被顶到键盘上面；
       * 底部导航是 fixed，所以它自己那一处也要跟着抬（见下面 nav 的 bottom）。
       * 没有键盘时两个变量都是 0px，等于什么都没变。
       */
      style={{ paddingBottom: "max(var(--q-ime-bottom-native, 0px), var(--q-ime-bottom-web, 0px))" }}
    >
      <GlassHighlight />
      {/* 「高亮某处 / 滚动到某处」这类界面动作由它执行 */}
      <UiEffects />
      {/* 全局音乐播放器：整个 App 只此一个 <audio>，切页不会停 */}
      <PlayerHost />
      {/* 外链播放器的宿主：iframe 卸载就断声，所以它一直挂着，切页时挪到屏幕外 */}
      <EmbedHost />
      {/*
        ⭐ 全局音频悬浮窗（用户 m03024 第 5 条）：本地音乐和外链共用**一个**悬浮窗 ——
        离开音乐页就是右下角那颗旋转小球，点开是横向胶囊播放条，✕ 真的把音频停掉。
        原来两条各自为政的迷你条已经从这里的两处宿主里删掉了（它们位置重叠）。
      */}
      <AudioWidget />
      {/* 用户自选的对话框渐变色 → 写成 --q-tint-1/2/3（`.glass-float` 读这几个变量） */}
      <ComposerTint />
      {/* 本地提醒 + Service Worker 注册 */}
      <ReminderDaemon />
      {/* 定时任务：到点让他自己开口（App 活着时；关掉时靠原生通知兜底） */}
      <TaskDaemon />
      <WakePlan />
      {/* 「主动找你」：把人设/最近对话/规矩同步给 Worker，供后台唤醒时用（见 lib/wake-sync） */}
      <WakeDaemon />
      {/* 闹钟到点：全屏响铃（只发通知的话人会睡过去） */}
      <AlarmOverlay />
      {/* AI 请求的任何操作都要从这里过一道（询问 / 允许 / 拒绝） */}
      <ActionGate />
      {/* App 里 OAuth 授权完的深链回跳（qidao://oauth/callback）由它接收 */}
      <McpOAuthListener />
      {/*
        **系统返回**（安卓返回键 / 侧边滑动手势）由它接管：
        App 的返回是"回上一级"，不是浏览器的"回上一个点过的页面"。
        去哪儿由 `nav-tree.ts` 一份层级表决定（跟页内返回钮同源）。
      */}
      <AppBack />
      {/* 他写了新信：一进前端就跳出拆信动画 */}
      <LetterAlert />
      {/* 他送了花：一样是一进 app 就弹（见 components/gift-alert.tsx） */}
      <GiftAlert />
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
         *
         * ⚠️ **打字时它不抬**（2026-10 用户第二次纠正）：
         *   "导航栏不弹起，对话框弹起来就行了……他和导航栏做切割，不放在一起。"
         *   键盘一弹，只有**对话框**落到键盘上面；导航留在屏幕底下（在键盘后面）。
         *   上一版我让它跟着抬，用户装上去说"填 API 的时候导航也跟着起来，很怪"。
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
                    /*
                      切标签用 replace：**标签之间没有层级关系**，
                      不该往历史里压一层（不然"返回"会回到上一个标签 ——
                      那是网页的行为，App 里返回应该回上一级）。
                    */
                    replace
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