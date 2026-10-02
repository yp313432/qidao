import { registerPlugin } from "@capacitor/core";
import { IS_APP } from "@/lib/platform";

/**
 * 把闹钟交给**手机自带的时钟 App**。
 *
 * 两条路（都能用，不冲突）：
 *   · 栖岛自己的全屏响铃 —— 有自己的界面、他的原话，但依赖 App 活着
 *   · 这个 —— 塞进系统时钟，响铃/贪睡/关机重开全由系统管，最可靠
 *
 * 插件是本地写的（android/app/src/main/java/com/yanping/qidao/SystemAlarmPlugin.java），
 * 所以网页版没有这个能力，会如实返回失败。
 */

type SystemAlarmApi = {
  setAlarm: (o: { hour: number; minute: number; message?: string }) => Promise<{ ok: boolean }>;
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
): Promise<{ ok: boolean; reason?: string }> {
  const a = api();
  if (!a) return { ok: false, reason: "网页版没这个能力，装成 App 才有" };
  const [h, m] = time.split(":").map((v) => Number(v));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return { ok: false, reason: "时间格式不对" };
  try {
    await a.setAlarm({ hour: h as number, minute: m as number, message });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "没能打开系统时钟" };
  }
}
