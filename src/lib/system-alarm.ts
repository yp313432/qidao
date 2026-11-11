import { registerPlugin } from "@capacitor/core";
import { IS_APP } from "@/lib/platform";

/** 通过 Android 的时钟接口请求设置响铃闹钟。 */
type SystemAlarmApi = {
  setAlarm: (o: { hour: number; minute: number; message?: string; daily: boolean }) => Promise<{ ok: boolean }>;
};

let cached: SystemAlarmApi | null = null;

function api(): SystemAlarmApi | null {
  if (!IS_APP) return null;
  try {
    // ⚠️ 不缓存插件对象本身之外的东西；registerPlugin 返回的是代理，可以直接留着
    if (!cached) cached = registerPlugin<SystemAlarmApi>("SystemAlarm");
    return cached;
  } catch {
    return null;
  }
}

export async function saveToSystemAlarm(
  time: string,
  message: string,
  date?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const a = api();
  if (!a) return { ok: false, reason: "网页版没这个能力，装成 App 才有" };
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(time);
  if (!match || Number(match[1]) > 23) return { ok: false, reason: "时间格式不对" };
  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (date) {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
      next.setHours(hour, minute, 0, 0);
    }
    const localDate = [
      next.getFullYear(),
      String(next.getMonth() + 1).padStart(2, "0"),
      String(next.getDate()).padStart(2, "0"),
    ].join("-");
    if (date !== localDate) {
      return { ok: false, reason: "手机时钟接口的一次性闹钟只支持下一次这个时间" };
    }
  }

  try {
    await a.setAlarm({ hour, minute, message, daily: !date });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "没能交给手机时钟" };
  }
}
