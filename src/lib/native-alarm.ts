import { registerPlugin } from "@capacitor/core";
import { IS_APP } from "@/lib/platform";

/**
 * **原生闹钟** —— 真正会响的那一条路（2026-11，用户 m05769）。
 *
 * 之前只有 `notify.ts` 的"定时通知"：App 不在前台，到点只是插一条通知，
 * 不响、不震、不亮屏 —— 睡着的人永远不知道。用户实测："闹钟只能在 App 点开的时候响"。
 *
 * 现在改成 `AlarmManager.setAlarmClock()`：
 *   · 精确定时（Doze 也准时），状态栏会显示"下一个闹钟"（用户看得见，也是责任的明示）
 *   · 到点走 `AlarmReceiver` → `AlarmActivity`：全屏 + 铃声 + 震动 + 亮屏
 *   · **闹钟类应用有后台启动 Activity 的豁免**，所以 App 被杀了也能把响铃页拉起来
 *
 * 与 `system-alarm.ts`（交给手机自带时钟 App）的分工：
 *   · 这个 = 主路径，栖岛自己的响铃页，能带他的原话
 *   · 那个 = 用户可选保底，进了系统时钟就完全归系统管（关机重开都不丢）
 *
 * 安卓侧在 `android/app/src/main/java/com/yanping/qidao/QidaoAlarmPlugin.java`；
 * 网页版没有这个能力，所有函数都如实返回 `supported: false`。
 */

export type NativeAlarm = {
  /** 稳定的数字 id（安卓 PendingIntent 的 requestCode，必须整数且在一份表内唯一） */
  id: number;
  hour: number;
  minute: number;
  text: string;
  /** true = 每天这个点；false = 只响一次 */
  daily: boolean;
};

type QidaoAlarmApi = {
  canExact: () => Promise<{ exact: boolean; sdk: number }>;
  openExactSettings: () => Promise<{ ok: boolean }>;
  sync: (o: {
    alarms: { id: number; hour: number; minute: number; text: string; daily: boolean }[];
    /** 这一次要撤掉的 id（JS 侧算差分 —— 安卓没有"列出我排了哪些"的 API） */
    removed?: number[];
  }) => Promise<{ ok: boolean; exact: boolean; count: number }>;
  cancel: (o: { id: number }) => Promise<{ ok: boolean }>;
  cancelAll: (o: { ids: number[] }) => Promise<{ ok: boolean }>;
  /** 立刻弹一次响铃页（给"听一下铃声"用，不占用真闹钟的 id） */
  ringNow: (o: { text?: string }) => Promise<{ ok: boolean }>;
};

let cached: QidaoAlarmApi | null = null;

function api(): QidaoAlarmApi | null {
  if (!IS_APP) return null;
  try {
    if (!cached) cached = registerPlugin<QidaoAlarmApi>("QidaoAlarm");
    return cached;
  } catch {
    return null;
  }
}

/** 有没有"精确定时"权限（安卓 12+ 要用户单独给；没有也能排，但系统会合并推迟） */
export async function nativeAlarmExact(): Promise<{ supported: boolean; exact: boolean }> {
  const a = api();
  if (!a) return { supported: false, exact: false };
  try {
    const r = await a.canExact();
    return { supported: true, exact: Boolean(r.exact) };
  } catch {
    return { supported: true, exact: false };
  }
}

/** 跳到系统的"闹钟和提醒"权限页（`SCHEDULE_EXACT_ALARM`） */
export async function openNativeAlarmSettings(): Promise<{ ok: boolean; reason?: string }> {
  const a = api();
  if (!a) return { ok: false, reason: "网页版没这个能力，装成 App 才有" };
  try {
    await a.openExactSettings();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "没能打开设置页" };
  }
}

/**
 * 把**当前所有**闹钟同步给系统（全量覆盖）。
 *
 * `removed` 是"上次排了、这次不该有了"的 id —— 由调用方（`reminder-daemon`）拿
 * `qidao:alarms-scheduled` 里的旧表算差分。为什么不让原生自己算：
 * 安卓没有"列出我的所有 PendingIntent"的 API，只能对每个可能的 requestCode 用
 * `FLAG_NO_CREATE` 去问，十万次 binder 调用直接卡死主线程。
 */
export async function syncNativeAlarms(
  alarms: NativeAlarm[],
  removed: number[] = [],
): Promise<{ ok: boolean; exact: boolean; count: number; reason?: string }> {
  const a = api();
  if (!a) return { ok: false, exact: false, count: 0, reason: "网页版没这个能力，装成 App 才有" };
  try {
    const r = await a.sync({
      alarms: alarms.map((v) => ({
        id: v.id,
        hour: v.hour,
        minute: v.minute,
        text: v.text,
        daily: v.daily,
      })),
      removed,
    });
    return { ok: Boolean(r.ok), exact: Boolean(r.exact), count: alarms.length };
  } catch (e) {
    return {
      ok: false,
      exact: false,
      count: 0,
      reason: e instanceof Error ? e.message : "没能排进系统闹钟",
    };
  }
}

export async function cancelNativeAlarm(id: number): Promise<boolean> {
  const a = api();
  if (!a) return false;
  try {
    await a.cancel({ id });
    return true;
  } catch {
    return false;
  }
}

export async function cancelNativeAlarms(ids: number[]): Promise<boolean> {
  const a = api();
  if (!a || ids.length === 0) return false;
  try {
    await a.cancelAll({ ids });
    return true;
  } catch {
    return false;
  }
}

/** 「听一下铃声」：直接弹响铃页（3 秒后自动关，省得用户以为闹钟真响了） */
export async function testNativeAlarm(
  text = "试听一下",
): Promise<{ ok: boolean; reason?: string }> {
  const a = api();
  if (!a) return { ok: false, reason: "网页版没这个能力，装成 App 才有" };
  try {
    await a.ringNow({ text });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "没能试听" };
  }
}
