/**
 * 通知能力层。
 *
 * 分四件事，按「能不能用」的层次：
 *  1. 系统通知权限（Notification.requestPermission）
 *  2. Service Worker 注册（只有 HTTPS / localhost 才允许）
 *  3. 本地通知：App 开着的时候立刻弹一条（不需要服务端）
 *  4. 后台推送订阅（Web Push）：需要 HTTPS + 服务端 VAPID 密钥
 *
 * 第 4 条是「App 关掉也能收到」的唯一正路；缺任何一环都会在界面上
 * 明确告诉你缺什么，而不是假装成功。
 */

export function notificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function secureContextOk(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

export function permissionState(): NotificationPermission | "unsupported" {
  if (!notificationSupported()) return "unsupported";
  return Notification.permission;
}

export const PERMISSION_LABEL: Record<string, string> = {
  granted: "已允许",
  denied: "已被拒绝（要去浏览器设置里改）",
  default: "还没决定",
  unsupported: "这个浏览器不支持",
};

/** 申请通知权限 —— 由用户点击开关时调用，所以是合法的用户手势。 */
export async function requestPermission(): Promise<NotificationPermission | "unsupported"> {
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

export type SwStatus = { ok: boolean; message: string };

let swReg: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<SwStatus> {
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
  if (swReg) return swReg;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    swReg = (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    swReg = null;
  }
  return swReg;
}

/** 立刻弹一条本地通知（App 开着的时候用）。 */
export async function localNotify(title: string, body: string): Promise<boolean> {
  if (!notificationSupported() || Notification.permission !== "granted") return false;

  // 优先走 Service Worker：这样通知可点、能被 getNotifications() 统计。
  // 刚启动时 SW 可能还没 active，所以等一下它，别急着退到兜底方案。
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

/** 查询服务端有没有配 VAPID 公钥（没配就没法订阅）。 */
export async function pushKeyConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/push/key");
    const json = (await res.json()) as { configured?: boolean };
    return Boolean(json.configured);
  } catch {
    return false;
  }
}

export async function subscribePush(): Promise<PushStatus> {
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
