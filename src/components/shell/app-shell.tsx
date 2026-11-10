import { useEffect, useRef, useSyncExternalStore } from "react";
import { WORLD_TICK_MS, tickWorld } from "@/lib/world-clock";
import { startAwakeLoop } from "@/lib/awake";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { hasPageHeader, subscribePageHeader } from "@/lib/header-registry";
import { ActionGate } from "@/components/shared/action-gate";
import { AppBack } from "@/components/shell/app-back";
import { AudioWidget } from "@/components/daemons/audio-widget";
import { ComposerTint } from "@/components/shared/composer-tint";
import { McpOAuthListener } from "@/components/daemons/mcp-oauth-listener";
import { LetterAlert } from "@/components/overlays/letter-alert";
import { GiftAlert } from "@/components/overlays/gift-alert";
import { GlobalToast } from "@/components/shared/global-toast";
import { ChatNoticeBanner } from "@/components/overlays/chat-notice-banner";
import { GlassHighlight } from "@/components/shared/glass-highlight";
import { mountGlassLight } from "@/liquid/lib/glass-light";
import { LiquidBack } from "@/liquid/components/liquid-back";
import { PlayerHost } from "@/components/daemons/player-host";
import { EmbedHost } from "@/components/play/embed-host";
import { ReminderDaemon } from "@/components/daemons/reminder-daemon";
import { AlarmOverlay } from "@/components/overlays/alarm-overlay";
import { TaskDaemon } from "@/components/daemons/task-daemon";
import { WakePlan } from "@/components/daemons/wake-plan";
import { WakeDaemon } from "@/components/daemons/wake-daemon";
import { UiEffects } from "@/components/shared/ui-effects";
import { hidesNav, parentOf } from "@/lib/nav-tree";
import { installKeyboardInset } from "@/lib/keyboard";
import { installBreadcrumbs } from "@/lib/breadcrumbs";
import { MAIN_TABS, tabOwning } from "@/lib/tabs";
import { NavEtch } from "@/components/shell/nav-icons";
import { PerfProbe } from "@/components/shell/perf-probe";
import { Splash } from "@/components/shell/splash";
import { cn } from "@/lib/utils";
import { initShell } from "@/lib/shell";
import { useApp } from "@/lib/store";
import { isSolid, materialOf } from "@/lib/material";

const TABS = MAIN_TABS;

/** 纸世界 Step5：四枚票图的拉丁小注（概念稿 TABS 第二列，塞 label 行）。 */
const NAV_LATIN: Record<string, string> = {
  "/": "PARLA",
  "/tools": "STRUMENTI",
  "/play": "SVAGO",
  "/me": "IO",
};

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
  const hydrated = useApp((s) => s.hydrated);
  /** 纸世界（qidao-docs/纸世界-落地清单.md）：纯色材质下底部导航换 F 邮票版。 */
  const solidPaper = useApp((s) => isSolid(s.settings));
  /**
   * 液态世界**没有底部导航**（用户 m07494："不要纯色那版底部导航栏，只剩下一个对话框"）。
   * 导航全在抽屉里，所以这一层整块不渲染 —— 不是藏起来，是不挂，
   * 免得占位把 `main.lq-page` 挤上去。
   */
  const liquidWorld = useApp((s) => materialOf(s.settings) === "liquid");

  /**
   * 哪些页能穿液态这层皮（用户 m08509："能做液态玻璃的做液态…像原来的花园，
   * 你做不了液态吧，你就不做"）。
   *
   * 花园 / 游戏 / 插件 / 音乐播放器是**自己带场景**的页（canvas、第三方界面、
   * 全屏播放），再套一层玻璃只会互相打架，所以它们保持原样；
   * 剩下的纯列表页（设置各组、工具、记忆、听书列表…）都是 kit 组件搭的，
   * 换了变量就自动玻璃化。
   */
  const liquidSkin =
    liquidWorld &&
    !/^\/(play\/(garden|games|player|add|plugins\/.+)|play\/space\/(moments|diary|letters)|tools\/(mcp|http|docs)|profile|space|chat-settings|notify|voice-settings|privacy|about)(\/|$)/.test(
      pathname,
    );

  /**
   * 「回上一级」钮：**液态下全 App 只有这一颗**。
   *
   * 用户 m01915/m01967：
   *   "你给我细细对比一遍……然后你把那个我的前面那个返回键跟其他二级界面返回键统一一下。
   *    这俩都是一样的东西，不要出现两种情况。"
   *   "返回键做统一，一般不是只有一种返回吗？你为啥要做两种不一样的呀。
   *    除了那个特殊插件里那个返回键可能不一样。"
   *
   * 之前是**两套**：这一颗圆钮只挂在工具/玩乐/我的三张落地页上，
   * 而二级页自己用 `PageHeader` / `PlayHeader` 画一个裸箭头 —— 于是同一个 App 里
   * 一颗是圆形玻璃底、一颗是光秃秃一个 ‹，标题旁边还各是两种排法。
   *
   * 现在：**液态下只要是"有上一级"的页面，就只由这里渲染这一颗**；
   * `PageHeader` / `PlayHeader` 在液态下把自带的箭头收起来（见那两个文件）。
   * 例外只有具体某个插件（`/play/plugins/xxx`）—— 那是插件自己的整屏 UI，
   * 返回键由插件画，用户也说了"特殊插件里那个返回键可能不一样"。
   */
  const lqBackPage =
    liquidSkin &&
    pathname !== "/" &&
    !pathname.startsWith("/play/plugins/") &&
    // 花园是整屏场景页（浅粉背景 + 自己那颗深色箭头），不归页头体系管：
    // 这里若再补一颗白箭头，在浅粉底上看不见（用户 m03393"花园返回键没了"的真因）。
    !pathname.startsWith("/play/garden") &&
    parentOf(pathname, true) !== null;

  /**
   * **这一页自己画了页头吗**（用户 m03470 要的"全站返回键统一"）。
   *
   * 画了 → 那颗箭头就在 `<header>` 里，跟标题同一行、一起滚，这一层不再补。
   * 没画 → 兜底补一颗，免得页面进去没路回去。
   * 见 `lib/header-registry.ts`：PageHeader / PlayHeader 挂载时 +1、卸载 −1。
   */
  const headerPresent = useSyncExternalStore(subscribePageHeader, hasPageHeader, () => false);

  /** 页面内容那一层（`key={pathname}` 那个 div），用来在切页时清掉旧的合成层。 */
  const routeLayerRef = useRef<HTMLDivElement>(null);

  /**
   * **路由切换时把上一页的合成层丢掉**（用户 m02009 的 bug）：
   *   "点侧边栏花园。之后，然后又退出又卡了一个之前的这个玩乐区的页面。
   *    中间卡了一个，你给我删掉。"
   *
   * 代码里没有残留节点：`outlet` 每次靠 `key={pathname}` 重建，`view-enter`
   * 只动 opacity。留下的是**安卓 WebView 自己的合成层**——它卸载一张带
   * backdrop-filter 的大玻璃卡之后，偶尔不回收那层位图，于是上一页那张
   * 虚化的卡就飘在屏幕中间（跟"碎片 / 一闪一闪"是同一个根子）。
   *
   * 对策：在 pathname 变化后让内容层 `display:none` 一次、立刻恢复。
   * 同步读写布局，中间不会真的画帧（不会闪），但会逼合成器把旧层丢掉。
   */
  useEffect(() => {
    const el = routeLayerRef.current;
    if (!el) return;
    el.style.display = "none";
    void el.offsetHeight; // 强制同步布局：让合成器真的"忘掉"上一页那层
    el.style.display = "";
  }, [pathname]);

  /**
   * 液态下**能液态化的二级页**也要有"光跟手指走"。首页那层由 `LiquidShell` 自己挂，
   * 这里只补其它页，避免同一个监听器挂两遍。
   */
  useEffect(() => {
    if (!liquidSkin || pathname === "/") return;
    return mountGlassLight();
  }, [liquidSkin, pathname]);

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
   * **世界的心跳**（2026-10-21 批4，见 `lib/world-clock`）。
   *
   * 钓鱼这种"有时间参数"的状态，原来只有钓鱼页开着才推进 —— 他一走开，
   * 竿就永远支在池塘上。这里让 App 在的时候每 20 秒看一眼时间：
   * 该咬钩就咬钩、放过太久就当鱼跑了。**不替用户做决定，只推进客观时间**。
   */
  useEffect(() => {
    const beat = () => {
      try {
        tickWorld();
      } catch {
        /* 世界心跳失败不影响界面 */
      }
    };
    beat();
    const id = window.setInterval(beat, WORLD_TICK_MS);
    /**
     * **前台醒着**（用户 m10218）：你人在 App 里的时候，他不必等系统闹钟 ——
     * 每 4 分钟自己看一眼"有没有想做的事"，有料才发请求，一天最多主动说 8 条。
     * 详见 `lib/awake.ts` 开头那段。
     */
    const stopAwake = startAwakeLoop();
    /**
     * **切到小窗 / 别的应用时停掉重绘**（用户 m10324："其他应用挂小窗的时候，
     * 栖岛会一直闪屏，有白光和色块"）。
     *
     * 安卓 WebView 在小窗里仍然合成：背景那层大面积的 `backdrop-filter` +
     * 常驻动画会反复触发重绘，表现出来就是闪白/色块。失焦时把它们整体按暂停，
     * 回来再恢复 —— 视觉上没有任何损失（反正看不见）。
     */
    const syncQuiet = () => {
      const quiet = document.visibilityState === "hidden" || !document.hasFocus();
      document.documentElement.classList.toggle("q-paused", quiet);
    };
    window.addEventListener("focus", syncQuiet);
    window.addEventListener("blur", syncQuiet);
    document.addEventListener("visibilitychange", syncQuiet);
    syncQuiet();
    return () => {
      window.clearInterval(id);
      stopAwake();
      window.removeEventListener("focus", syncQuiet);
      window.removeEventListener("blur", syncQuiet);
      document.removeEventListener("visibilitychange", syncQuiet);
      document.documentElement.classList.remove("q-paused");
    };
  }, []);

  /**
   * **启动自检恢复**（2026-10，起因见 `lib/data/safety.ts` 的事故复盘）。
   *
   * 如果这次读出来的设置"像被重置了"（没密钥、没地址、没模型、没背景、没自定义名字），
   * 而安全带的镜子里有一份**有料**的 → 就用镜子那份把它补回来。
   *
   * ⚠️ 本来还该"如实告诉用户一句"（静默恢复会让人以为自己没丢过，反而更糟），
   * 但那行提示一直没做：原来挂在这里的 `restoredFromMirror` 状态没有任何界面在读，
   * 已于 2026-11-07 删掉。要做的话加在 `shared/global-toast` 上。
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
        }
        /** 每次启动压一份滚动快照（最近 3 份）——真出事了能往回翻 */
        void pushSnapshot(JSON.stringify({ state: st.useApp.getState(), at: Date.now() }));
      } catch {
        /* 安全带失败不该影响启动 */
      }
    })();
  }, [hydrated]);

  /**
   * **首帧遮挡**（2026-11 用户："每次进去都先闪一下那个空对话界面，然后再进对话框"）。
   *
   * 根因：状态存在 IndexedDB 里（见 lib/store.ts 的 createQidaoPersistStorage），
   * 读库是**异步**的。第一帧 `settings` 还是默认值（纯色 + 空对话 + 未选模型），
   * 于是先把"讯 / 未选模型"那个壳画出来；几十~几百毫秒后库读完，
   * 才换成真的液态对话页 —— 中间那一下就是他看到的"闪"。
   *
   * 所以：**没读完就不画界面**。只铺一层纸色（和冷启动原生那层同色），
   * 读完立刻进真正的页面。代价是开头几十毫秒是纯色，换来"不闪"。
   */
  if (!hydrated) return <div className="boot-veil" aria-hidden />;

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
      className={cn(
        "relative z-10 mx-auto flex h-dvh w-full max-w-lg flex-col overflow-hidden text-fg",
        /* 键盘让位（见下面注释）。**2026-11 实机修复**：原来这里是内联 style，
           内联样式压过一切 CSS —— 只要 `--q-ime-bottom-native` 残留一次（安卓 insets
           回调丢失时就会），外壳就永久缩着一条键盘高，输入框悬在屏幕 5/6 处、
           下面一大片空白。改成类名承载后，CSS 能在 `data-keyboard != up` 时把它按回 0
           （见 kit.css 的 `.shell-ime-pad`），变量残留也顶不住。 */
        "shell-ime-pad",
        liquidSkin && "lq-skin",
      )}
      /* 只在"这一页真的有回对话钮"时置位 —— 标题让位的 padding 挂在它上面 */
      data-lq-back={lqBackPage ? "true" : undefined}
      /**
       * 键盘让位：`max(原生推的, 网页兜底算的)`。
       * 外壳整体缩一条键盘高的下内边距 → 页面里的输入框被顶到键盘上面；
       * 底部导航是 fixed，所以它自己那一处也要跟着抬（见下面 nav 的 bottom）。
       * 没有键盘时两个变量都是 0px，等于什么都没变。
       */
    >
      {/* 液态：二级页也要有那层会漂的底光。首页由 `LiquidShell` 自己铺，别铺两遍 */}
      {liquidSkin && pathname !== "/" ? <div className="lq-canvas" aria-hidden /> : null}
      <GlassHighlight />
      {/* 开屏：一条线画出人形与玫瑰 → 墨迹散开 → 手写 waiting for you。
          冷启动且距上次超过 4 小时才播，判断在组件内部（见 lib/splash-policy）。 */}
      <Splash />
      {/* 切页流畅度浮层：默认完全不出现，只在 ?perf=1 / 改 PERF_FORCE 时亮 */}
      <PerfProbe />
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
      {/* 全局轻提示：替代 window.alert（安卓原生的白卡片跟这个 App 不搭） */}
      <GlobalToast />
      {/* 他主动发消息、而你不在聊天页时，从顶部滑下一条横幅（点了直接进聊天） */}
      <ChatNoticeBanner />
      {/* 液态没有底部导航：三张落地页（工具/玩乐/我的）自己不带返回钮，
          这里给一个"回对话"的浮动钮，跟系统返回键同一条层级表（用户 m08548） */}
      {lqBackPage && !headerPresent ? <LiquidBack to={parentOf(pathname, true) ?? "/"} /> : null}
      <div
        key={pathname}
        ref={routeLayerRef}
        className="view-enter flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <Outlet />
      </div>
      {!hideNav && !liquidWorld && (
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
                      solidPaper && "paper-tab",
                    )}
                  >
                    {solidPaper ? (
                      /* 纸世界 Step5：F 邮票版 —— 素态是铜版画票图，贴上虚线票框＝选中。
                       * 高亮仍走 aria-current（tabOwning 一行没动）。 */
                      <>
                        <span className="nav-stamp">
                          <NavEtch name={tab.to} />
                        </span>
                        <span className="nav-label">
                          {tab.label}
                          <span className="nav-la" aria-hidden="true">
                            {NAV_LATIN[tab.to]}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
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
