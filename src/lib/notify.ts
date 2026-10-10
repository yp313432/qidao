/**
 * 通知能力层。
 *
 * **两种形态，两套路**：
 *   · 网页版：Notification 权限 + Service Worker + （可选）Web Push 订阅
 *   · App（安卓）：走 **Capacitor 原生通知** —— 真实出现在系统通知栏、
 *     出现在系统设置的权限列表里，不需要 Service Worker，也不需要服务端 VAPID。
 *
 * 早先这里只有网页那一套，于是 App 里显示"这个浏览器不支持"、
 * 系统设置里也搜不到这个 App —— 那不是 bug，是没做原生适配。
 */

import { IS_APP } from "@/lib/platform";

/**
 * ⚠️ **通知里不自定义图标** —— 这是用户 2026-11 定的口径（原话：
 * "小图标那个你就复原形了，就跟其他通知一样，右边不单独画就行了"）。
 *
 * 为什么这么定：荣耀/华为把**自定义的小图标**单独画在通知右边，而别的 App
 * （不自定义、用系统默认那套）右边什么都没有 —— 用户要的是"跟其他通知一样"。
 *
 * ── 这一块踩过的坑（别再犯，也别再照着旧代码改回去）────────────
 *   1. **名字写错不报错**：插件解析不到就退回 `android.R.drawable.ic_dialog_info`
 *      （系统那个 ⓘ）。原来这里写的 `ic_stat_icon_config_sample` 是插件 README 的
 *      示例名，仓库里**根本没有这个资源** —— 所以一直显示的是系统图标。
 *   2. ⚠️ **现在完全不传时，插件照样会兜底成那个 ⓘ**（它内部一定调 setSmallIcon）。
 *      也就是说"不自定义"未必等于"右边什么都没有" —— 装上后要看一眼：
 *      如果右边冒出灰圈 ⓘ，那就得换个办法（自建通知口子才行）。
 *   3. `largeIcon` **只认资源名、不认文件路径**（插件里是
 *      `AssetUtil.getResourceID(名字, "drawable")` → `decodeResource`）——
 *      所以"大图标跟着头像换"那条路在插件层走不通，别试。
 *   4. 别指望在 `capacitor.config.ts` 的 `plugins.LocalNotifications` 里配默认值：
 *      这一版插件读的是**根级**配置（`plugins.` 那层不读），配了纯静默无效。
 *
 * 那张单色剪影（`ic_stat_qidao`）和彩图（`ic_notif_large`）**还在 res 里留着备用**，
 * 由 `scripts/make-notification-icon.py` 生成（改图标 = 改脚本再跑，别手改 PNG）。
 * 要重新启用，就在下面的 `schedule()` 里把 `smallIcon` / `largeIcon` 加回去。
 */

/** App 里临时拿到的原生通知模块（只在需要时动态加载，网页版不受影响）。 */
type NativeNotify = {
  checkPermissions: () => Promise<{ display: string }>;
  requestPermissions: () => Promise<{ display: string }>;
  schedule: (opts: {
    notifications: {
      id: number;
      title: string;
      body: string;
      schedule?: {
        at?: Date;
        allowWhileIdle?: boolean;
        /** 每天/每小时重复 */
        repeats?: boolean;
        every?: "year" | "month" | "two-weeks" | "week" | "day" | "hour" | "minute";
        /** 重复时的具体时刻（配合 repeats） */
        on?: { hour?: number; minute?: number };
      };
      smallIcon?: string;
      /** ⚠️ 资源名（`res/drawable` 里的文件名），**不是文件路径** —— 见文件头第 2 条 */
      largeIcon?: string;
      sound?: string;
    }[];
  }) => Promise<unknown>;
  cancel: (opts: { notifications: { id: number }[] }) => Promise<void>;
  getPending?: () => Promise<{ notifications: { id: number }[] }>;
  /** 安卓 12+ 的"精确定时"授权（有些版本没有这个方法） */
  checkExactNotificationSetting?: () => Promise<{ exact_alarm?: string }>;
  changeExactNotificationSetting?: () => Promise<{ exact_alarm?: string }>;
};

/**
 * 拿到原生通知模块。
 *
 * ⚠️ **必须包一层返回**，不能直接 return 插件对象本身 ——
 * Capacitor 的插件对象是 thenable（带 then 方法），从一个 async 函数里
 * 直接 return 它，JS 会把它当成 Promise 去调 `.then()`，于是当场抛
 * `"LocalNotifications.then()" is not implemented on web`，
 * 结果就是权限永远读不出来（界面上一直显示"读取中…"）。
 */
async function nativeNotify(): Promise<{ api: NativeNotify } | null> {
  if (!IS_APP) return null;
  try {
    const mod = await import("@capacitor/local-notifications");
    return { api: mod.LocalNotifications as unknown as NativeNotify };
  } catch {
    return null;
  }
}

/* ------------------------------- 权限状态 ------------------------------- */

export function notificationSupported(): boolean {
  if (IS_APP) return true;
  return typeof window !== "undefined" && "Notification" in window;
}

export function secureContextOk(): boolean {
  if (IS_APP) return true; // App 里没有"不安全来源"这回事
  return typeof window !== "undefined" && window.isSecureContext;
}

/** 同步版：网页用它；App 里拿不到真值，请用下面的异步版。 */
export function permissionState(): NotificationPermission | "unsupported" {
  if (IS_APP) return "default";
  if (!notificationSupported()) return "unsupported";
  return Notification.permission;
}

/** 异步版：两种形态都能拿到真值（App 里问安卓系统）。 */
export async function permissionStateAsync(): Promise<NotificationPermission | "unsupported"> {
  if (IS_APP) {
    const n = await nativeNotify();
    if (!n) return "unsupported";
    try {
      const r = await n.api.checkPermissions();
      if (r.display === "granted") return "granted";
      if (r.display === "denied") return "denied";
      return "default";
    } catch {
      return "unsupported";
    }
  }
  return permissionState();
}

export const PERMISSION_LABEL: Record<string, string> = {
  granted: "已允许",
  denied: "已被拒绝（要去系统设置里改）",
  default: "还没决定",
  unsupported: "这个设备不支持通知",
};

/** 申请通知权限 —— 由用户点击开关时调用，所以是合法的用户手势。 */
export async function requestPermission(): Promise<NotificationPermission | "unsupported"> {
  if (IS_APP) {
    const n = await nativeNotify();
    if (!n) return "unsupported";
    try {
      const r = await n.api.requestPermissions();
      if (r.display === "granted") return "granted";
      if (r.display === "denied") return "denied";
      return "default";
    } catch {
      return "unsupported";
    }
  }
  if (!notificationSupported()) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/* ---------------------------- Service Worker ---------------------------- */

export type SwStatus = { ok: boolean; message: string };

let swReg: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<SwStatus> {
  if (IS_APP) {
    // App 里不用 Service Worker —— 通知走安卓系统，别让面板显示得像是缺了什么
    return { ok: true, message: "App 里用安卓系统通知，不需要 Service Worker" };
  }
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, message: "这个浏览器不支持 Service Worker" };
  }
  if (!secureContextOk()) {
    return {
      ok: false,
      message: "当前地址不是 HTTPS（也不是 localhost），浏览器不允许注册 —— 换成 https 地址就好了",
    };
  }
  try {
    swReg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return { ok: true, message: "已注册（不缓存、不拦截请求）" };
  } catch (err) {
    return { ok: false, message: `注册失败：${(err as Error).message}` };
  }
}

export async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (IS_APP) return null;
  if (swReg) return swReg;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    swReg = (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    swReg = null;
  }
  return swReg;
}

/* ------------------------------- 发通知 ------------------------------- */

/** 立刻弹一条本地通知。App 里走安卓系统通知栏，网页里走 Notification / SW。 */
/**
 * 定时通知（闹钟用）。
 *
 * 跟 localNotify 的区别：这个交给**系统**去定时 —— App 关掉、被划掉也照样响 ✅
 *   · daily: {hour, minute} → 每天这个点重复响
 *   · at: Date             → 只响一次（用来做"5 分钟后再响"）
 * 网页版没有这个能力（返回 false），界面会如实说明。
 */
export async function scheduleNative(o: {
  id: number;
  title: string;
  body: string;
  daily?: { hour: number; minute: number };
  at?: Date;
  sound?: boolean;
}): Promise<boolean> {
  const n = await nativeNotify();
  if (!n) return false;
  try {
    const perm = await n.api.checkPermissions();
    if (perm.display !== "granted") {
      const asked = await n.api.requestPermissions();
      if (asked.display !== "granted") return false;
    }
    await n.api.schedule({
      notifications: [
        {
          id: o.id,
          title: o.title,
          body: o.body,
          sound: o.sound === false ? undefined : "default",
          schedule: o.daily
            ? {
                on: { hour: o.daily.hour, minute: o.daily.minute },
                repeats: true,
                every: "day",
                allowWhileIdle: true,
              }
            : o.at
              ? { at: o.at, allowWhileIdle: true }
              : undefined,
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/** 撤掉某个定时通知（改时间/删闹钟时用） */
export async function cancelNative(id: number): Promise<void> {
  const n = await nativeNotify();
  if (!n) return;
  try {
    await n.api.cancel({ notifications: [{ id }] });
  } catch {
    /* ignore */
  }
}

/**
 * 安卓 12+ 的"精确定时"授权状态。
 * 没这个权限时系统可能把闹钟推迟几十秒到几分钟 —— 不是我们偷懒，是安卓的规矩。
 */
export async function exactAlarmState(): Promise<"granted" | "denied" | "unknown"> {
  const n = await nativeNotify();
  if (!n?.api.checkExactNotificationSetting) return "unknown";
  try {
    const r = await n.api.checkExactNotificationSetting();
    const v = (r.exact_alarm ?? "").toLowerCase();
    if (v.includes("grant")) return "granted";
    if (v.includes("denied") || v.includes("not")) return "denied";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** 跳去系统设置里开"闹钟和提醒"（一键申请） */
export async function askExactAlarm(): Promise<boolean> {
  const n = await nativeNotify();
  if (!n?.api.changeExactNotificationSetting) return false;
  try {
    await n.api.changeExactNotificationSetting();
    return true;
  } catch {
    return false;
  }
}

export async function localNotify(title: string, body: string): Promise<boolean> {
  if (IS_APP) {
    const n = await nativeNotify();
    if (!n) return false;
    try {
      // 权限没给过就先要一次（用户点了开关，属于合法手势）
      const perm = await n.api.checkPermissions();
      if (perm.display !== "granted") {
        const asked = await n.api.requestPermissions();
        if (asked.display !== "granted") return false;
      }
      await n.api.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() % 2147483647),
            title,
            body,
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  if (!notificationSupported() || Notification.permission !== "granted") return false;

  // 优先走 Service Worker：这样通知可点、能被 getNotifications() 统计。
  let reg = await swRegistration();
  if (!reg && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3000)),
    ]).catch(() => null);
  }
  if (reg) {
    try {
      await reg.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: "/" },
        tag: "qidao-local",
      });
      return true;
    } catch {
      /* 落到下面的兜底 */
    }
  }
  try {
    new Notification(title, { body, icon: "/icon-192.png" });
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------- Web Push 订阅 ----------------------------- */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushStatus = { ok: boolean; message: string };

/** 查询服务端有没有配 VAPID 公钥（没配就没法订阅）。App 里没有这回事。 */
export async function pushKeyConfigured(): Promise<boolean> {
  if (IS_APP) return false;
  try {
    const res = await fetch("/api/push/key");
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { configured?: boolean };
      return Boolean(json.configured);
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

export async function subscribePush(): Promise<PushStatus> {
  if (IS_APP) {
    return {
      ok: false,
      message: "App 里用安卓系统通知就够了，不需要后台推送订阅。",
    };
  }
  if (!secureContextOk()) {
    return { ok: false, message: "后台推送必须跑在 HTTPS 上（localhost 也行）。" };
  }
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, message: "这个浏览器不支持推送订阅。" };
  }
  try {
    const res = await fetch("/api/push/key");
    const json = (await res.json()) as { key?: string; configured?: boolean };
    if (!json.configured || !json.key) {
      return {
        ok: false,
        message: "服务端还没配 VAPID 公钥（环境变量 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY）。配好之后这里一键订阅。",
      };
    }
    const reg = (await swRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(json.key) as unknown as BufferSource,
    });
    const saved = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    const out = (await saved.json()) as { ok?: boolean; message?: string };
    return { ok: Boolean(out.ok), message: out.message ?? "已提交订阅" };
  } catch (err) {
    return { ok: false, message: `订阅失败：${(err as Error).message}` };
  }
}
