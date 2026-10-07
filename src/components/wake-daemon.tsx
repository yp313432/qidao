import { useEffect } from "react";
import { useApp } from "@/lib/store";
import { syncWakeContext } from "@/lib/wake-sync";

/**
 * **「主动找你」的同步守护**（挂一次、不渲染任何东西）。
 *
 * 为什么要它：后台那段 JS（`public/runners/wake.js`）只会在系统叫醒它时去问 Worker，
 * 而 Worker 手里必须有**新鲜的上下文**（人设、最近聊了什么、上游配置、两个规矩）——
 * 这些只有 App 知道。这个组件就负责把 App 知道的那些交出去。
 *
 * ── 什么时候同步（三个时机，缺一不可）────────────────────────────
 *   ① **刚打开 App** —— 换设备/清了缓存之后，Worker 那边是空的
 *   ② **聊完一轮之后**（有节流）—— 他"接着聊"才不会接错话题
 *   ③ **App 切到后台的那一刻** —— 这是**最要紧**的一次：
 *      安卓正是在这个时刻把后台任务排上队，之后 15 分钟就要用它了
 *
 * ── 三条纪律 ─────────────────────────────────────────────────
 *   · **失败静默**：同步失败不弹任何东西、不阻塞聊天（这是后台能力，坏了不该影响聊天）。
 *     真要排查，去「我的 → 系统 → 后台唤醒」点**通道自检**。
 *   · **有节流**：聊天每来一条消息都同步一次会把 Worker 打爆，所以默认 2 分钟一次；
 *     但"切后台"那次**强制同步**（它最要紧，不能被节流挡掉）。
 *   · **不碰原生**：这里只用 `fetch`。插件那个 `dispatchEvent` 会让 App 卡死，永远不要用。
 */

/** 聊天过程中的同步节流（毫秒）—— 2 分钟 */
const THROTTLE_MS = 120_000;

export function WakeDaemon() {
  /** 靠它感知"对话又长了"（消息数变化就重跑一次 effect） */
  const messagesKey = useApp((s) => {
    const conv = s.conversations.find((c) => c.id === s.activeId);
    return conv ? `${conv.id}:${conv.messages.length}` : "";
  });
  const policy = useApp((s) => `${s.settings.wakeMinGapMinutes}:${s.settings.wakeQuietStart}:${s.settings.wakeQuietEnd}`);
  const upstream = useApp((s) => `${s.settings.customBaseUrl}|${s.settings.upstreamModel}`);

  /** ① 打开 App：同步一次 */
  useEffect(() => {
    void syncWakeContext();
    // 只在挂载时跑一次；后面的变化由下面两个 effect 负责
  }, []);

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
