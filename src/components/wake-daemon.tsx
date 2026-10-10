import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import {
  WAKE_NOTIFY_ACTION,
  flushPendingWake,
  syncWakeContext,
  watchWakeNotificationTap,
  type WakeFlushResult,
} from "@/lib/wake-sync";

/**
 * **「主动找你」的同步守护 + 落库守护**（挂一次、不渲染任何东西）。
 *
 * ── 为什么要"同步" ──────────────────────────────────────────
 * 后台那段 JS（`public/runners/wake.js`）只会在系统叫醒它时去问你的 AI，
 * 而它手里必须有**新鲜的上下文**（人设、最近聊了什么、上游配置、两个规矩）——
 * 这些只有 App 知道。这个组件负责把 App 知道的那些交出去：
 *   ① **刚打开 App** ② **聊完一轮之后**（有节流）③ **App 切到后台的那一刻**（最要紧，
 *   安卓正是在这个时刻把后台任务排上队）
 *
 * ── 为什么要"落库"（`flushPendingWake`）────────────────────────
 * 用户真机原话："我能收到弹窗通知，但是那个通知不在上下文里……这样如果我想回他那句
 * 消息的话，进对话里的 AI 是不知道这回事的。"
 * 后台现在在"他说了"那一刻把**完整那句话**写进抽屉（`wake_pending_*`），
 * 前台负责把它**当成他发的消息**落进当前会话。三个时机：
 *   ① **刚打开 App**（`beginScheduledReply` 之前会 `waitHydrated`，见 wake-sync）
 *   ② **从后台回到前台**（`visibilitychange` → visible）
 *   ③ **点通知进来**（原生事件 `backgroundRunnerNotificationReceived`）
 *      —— 这一条**还要跳到那条消息**（点通知直达那条）
 *
 * ── 三条纪律 ─────────────────────────────────────────────────
 *   · **失败静默**：同步/落库失败不弹任何东西、不阻塞聊天（这是后台能力，坏了不该影响聊天）。
 *     真要排查，去「我的 → 系统 → 后台唤醒」点**通道自检**。
 *   · **有节流**：聊天每来一条消息都同步一次会把 Worker 打爆，所以默认 2 分钟一次；
 *     但"切后台"那次**强制同步**（它最要紧，不能被节流挡掉）。
 *   · **不碰原生**：这里只用 `fetch` + 抽屉。插件那个 `dispatchEvent` 会让 App 卡死，永远不要用。
 */

/** 聊天过程中的同步节流（毫秒）—— 2 分钟 */
const THROTTLE_MS = 120_000;

export function WakeDaemon() {
  /** 靠它感知"对话又长了"（消息数变化就重跑一次 effect） */
  const messagesKey = useApp((s) => {
    const conv = s.conversations.find((c) => c.id === s.activeId);
    return conv ? `${conv.id}:${conv.messages.length}` : "";
  });
  /** 「他主动找你」的开关 + 夜间时段：改了要立刻同步过去（不然后台还用旧规矩） */
  const policy = useApp(
    (s) => `${s.settings.wakeEnabled ?? true}:${s.settings.wakeQuietStart}:${s.settings.wakeQuietEnd}`,
  );
  const upstream = useApp((s) => `${s.settings.customBaseUrl}|${s.settings.upstreamModel}`);

  /**
   * 跳页用的 `navigate` 放进 ref：`focusLanded` 于是可以**永远是同一个函数**，
   * 下面几个 effect 就能安全地只在挂载时跑一次（不然 navigate 一换身份，
   * 那几个 effect 会重复跑、重复同步）。
   */
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  /**
   * 刚落进来的那条 → 切到它所在的那个会话；**点通知进来的那一次**再滚到那一条。
   *
   * 为什么滚得动：聊天气泡的 DOM id 是 `msg-<消息 id>`（见 `chat-view.tsx`），
   * 拿到 `messageId` 就能直接定位。刚 `navigate` 过去时它可能还没渲染出来，
   * 所以重试几次；都不行就算了（至少人已经落在那个会话里了）。
   */
  const focusLanded = useCallback((r: WakeFlushResult, jump: boolean) => {
    if (!r.landed || !r.conversationId || !r.messageId) return;
    useApp.getState().setActive(r.conversationId);
    if (!jump) return;
    void navigateRef.current({ to: "/" });
    const id = r.messageId;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(`msg-${id}`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        window.clearInterval(timer);
        return;
      }
      tries += 1;
      if (tries > 20) window.clearInterval(timer);
    }, 100);
  }, []);

  /** ①-a 打开 App：同步一次 + 把后台说过的话落进会话（不跳页） */
  useEffect(() => {
    void syncWakeContext();
    void flushPendingWake().then((r) => focusLanded(r, false));
    // 只在挂载时跑一次；后面的变化由下面几个 effect 负责
  }, [focusLanded]);

  /** ①-b 点通知进来：先落库，再**跳到那条**（③ 点通知直达） */
  useEffect(
    () =>
      watchWakeNotificationTap((tap) => {
        void flushPendingWake().then((r) => {
          /**
           * 只有**后台那条**通知（`source === "wake"`）才跳页；
           * `actionTypeId` 是"他说了一句"的标记（老包可能没有 → 那就按"是他说的一句"处理）。
           * App 自己弹的那些（闹钟 / 定时任务）被点时就**只落库、不跳页** ——
           * 用户点的是"该吃药了"，不该被甩到对话里。
           */
          const wakeSaid =
            tap.source === "wake" && (!tap.actionTypeId || tap.actionTypeId === WAKE_NOTIFY_ACTION);
          focusLanded(r, wakeSaid && r.landed);
        });
      }),
    [focusLanded],
  );

  /** ①-c 从后台回到前台：落库（App 被冻住那段时间里，后台说过的话都在抽屉里等着） */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void flushPendingWake().then((r) => focusLanded(r, false));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [focusLanded]);

  /** ② 聊天多了 / 规矩改了 → 节流同步 */
  useEffect(() => {
    const last = Number(sessionStorage.getItem("qidao-wake-sync-at") ?? "0");
    if (Date.now() - last < THROTTLE_MS) return;
    sessionStorage.setItem("qidao-wake-sync-at", String(Date.now()));
    void syncWakeContext();
  }, [messagesKey, policy, upstream]);

  /** ③ 切到后台的那一刻：**强制**同步（安卓就是在这一刻排上后台任务的） */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      sessionStorage.setItem("qidao-wake-sync-at", String(Date.now()));
      void syncWakeContext();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);

  return null;
}
