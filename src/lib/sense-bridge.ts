import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "@/lib/platform";

/**
 * **「看一眼系统状态」的 JS 侧** —— 跟
 * `android/app/src/main/java/com/yanping/qidao/SenseBridgePlugin.java` 配对。
 *
 * 用户的原话："我给开他那么多权限，其实是希望他**主动的去用**。"
 * 这里的四个方法就是那几项权限的**入口**（谁来调：`lib/sense.ts`，由 AI 的动作触发）：
 *   · `device()`        电量 / 充电 / 网络类型（不需要权限）
 *   · `screen()`        屏幕亮没亮、锁没锁（不需要权限）
 *   · `notifications()` 最近几条通知（要系统「通知使用权」）
 *   · `foreground()`    当前前台 App（要系统「使用情况访问」）
 *
 * ⚠️ 三条纪律（都是这一层最容易犯的错）：
 *
 * 1. **网页版必须优雅失败**：`registerPlugin` 在网页里返回的是一个"调用就抛
 *    not implemented on web"的代理 —— 所以每个调用方都要先过 `nativeSense()`，
 *    拿不到就**如实说"网页版没有这个能力"**，不许假装读过、也不许崩。
 *
 * 2. ⚠️ **不要直接 return 插件对象**：Capacitor 的插件对象是 thenable（带 `then`），
 *    从 async 函数里直接 return，JS 会把它当成 Promise 去调 `.then()` ——
 *    当场抛 `"SenseBridge.then()" is not implemented on web`。
 *    所以这里包一层 `{ api }` 返回（`lib/notify.ts` 踩过同一个坑）。
 *
 * 3. **原生报错不许吞**：插件那边已经把"没权限"和"读失败"分开了
 *    （`granted:false` + `settingsPath`），这里原样往上送，别自己编一句
 *    "失败了" —— 用户要知道去开哪个开关。
 */

/** 原生插件返回的形状（跟 Java 那边一字不差）。 */
export type SenseBridgeApi = {
  device: () => Promise<{
    battery?: number | null;
    charging?: boolean | null;
    network?: string;
    online?: boolean | null;
  }>;
  screen: () => Promise<{ interactive?: boolean; locked?: boolean }>;
  notifications: () => Promise<{
    granted?: boolean;
    items?: { app?: string; title?: string; text?: string; minutesAgo?: number }[];
    reason?: string;
  }>;
  foreground: () => Promise<{
    granted?: boolean;
    app?: string;
    package?: string;
    /** 前台就是栖岛自己（正在跟用户说话） */
    self?: boolean;
    reason?: string;
  }>;
  /**
   * 自检：那两项**特殊权限**的原始事实（老包没这个方法 → 调用会 reject，被下面兜住）。
   * 加它的原因：用户 2026-11 真机实测"权限都打开了还是不行" —— 靠猜没用，要原始数据。
   */
  diag: () => Promise<SenseDiag>;
  /** 一键跳到那个特殊权限的设置页（各家 ROM 的菜单层级不一样，给按钮最省事） */
  openSettings: (o: { which: "notifications" | "foreground" }) => Promise<{
    ok?: boolean;
    fallback?: boolean;
    reason?: string;
  }>;
};

/** `diag()` 回来的原始事实（字段都是"不翻译"的原值，翻译交给界面） */
export type SenseDiag = {
  package?: string;
  uid?: number;
  sdk?: number;
  device?: string;
  /** 系统那份名单的原文（`enabled_notification_listeners`） */
  listenersRaw?: string;
  /** 名单里属于我们的那一项（原样）；"（名单里没有我们）" 表示真的没开 */
  listenerItem?: string;
  notifGranted?: boolean;
  /** 系统一共回调过我们几次（0 = 服务没被绑定，跟"这阵子没通知"是两件事） */
  notifCallbacks?: number;
  notifLastCallbackAt?: number;
  /** 组件启用状态（-1 问不到，0 默认，1 启用，2 禁用） */
  listenerEnabled?: number;
  /** AppOps 原始模式：0=ALLOWED、3=DEFAULT、-1=问不到 */
  usageOpMode?: number;
  usageReadable?: boolean;
  usageGranted?: boolean;
  foregroundPkg?: string;
};

const SenseBridge = registerPlugin<SenseBridgeApi>("SenseBridge");

/** 拿到原生插件；网页版/老包（没有这个插件）一律返回 null。 */
export async function nativeSense(): Promise<{ api: SenseBridgeApi } | null> {
  if (!isNativeApp()) return null;
  try {
    // ⚠️ 包一层（见文件头纪律 2）
    return { api: SenseBridge };
  } catch {
    return null;
  }
}

/**
 * 自检：拿那两项特殊权限的**原始事实**。
 *
 * 网页版没有原生插件、老包没有 `diag()` → 一律返回 `null`（**绝不抛**：
 * 环境自检页是给用户看的，它自己崩了就什么也查不了）。
 */
export async function senseDiag(): Promise<SenseDiag | null> {
  const n = await nativeSense();
  if (!n) return null;
  try {
    return await n.api.diag();
  } catch {
    return null;
  }
}

/** 一键跳到那个特殊权限的设置页；网页版/老包返回 false（界面据此不显示按钮） */
export async function openSenseSettings(
  which: "notifications" | "foreground",
): Promise<boolean> {
  const n = await nativeSense();
  if (!n) return false;
  try {
    const r = await n.api.openSettings({ which });
    return r?.ok === true;
  } catch {
    return false;
  }
}
