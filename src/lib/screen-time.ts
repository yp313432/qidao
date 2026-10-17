import { nativeSense } from "@/lib/sense-bridge";

/**
 * **屏幕使用时长** —— 原生 `SenseBridge.usage()` 的归一化层。
 *
 * 用户原话（2026-11）："我还加个功能，就是能看到屏幕使用时长，
 * 就是知道我一天每个app用了多久那个。"
 *
 * 数据来自系统「使用情况访问」（UsageStats），**只在本地读、不上传**；
 * 它跟 `foreground()` 是同一项权限，所以已经在用「看你在用哪个 App」的人
 * 会直接看到这一页有数据，不用再开一次。
 *
 * ⚠️ 三种结果必须分开（跟 `lib/sense-bridge.ts` 的纪律一致）：
 *   · `unsupported` —— 网页版**没有**这个能力（不是"没授权"，别让它看起来像出错）；
 *   · `not-granted` —— App 里、但系统没给「使用情况访问」→ 界面给按钮跳设置页；
 *   · `ok`          —— 读到了，归一化后给界面。
 * 三种混成一句"读取失败"，用户就不知道到底该去点哪里。
 */

/** 一个 App 在统计窗口里待了多久 */
export type AppUsage = {
  /** 包名（读不到名字时的兜底显示，也是 React key） */
  pkg: string;
  /** 应用名（原生那边拿不到就退回包名，这里不再造） */
  app: string;
  /** 前台毫秒数 */
  ms: number;
};

export type ScreenTime =
  | {
      ok: true;
      /** 统计窗口（毫秒时间戳） */
      from: number;
      to: number;
      /** 所有 App 合计的前台毫秒（≈ 屏幕亮着的时间） */
      totalMs: number;
      /** 按毫秒降序 */
      apps: AppUsage[];
    }
  | {
      ok: false;
      reason: "unsupported" | "not-granted";
      /** 原生给的人话原因（"还没打开「使用情况访问」"这类），别自己编 */
      detail?: string;
    };

/**
 * 读屏幕使用时长。
 *
 * `days = 1`（默认）是**今天**（从本地 0 点起算，不是"往前推 24 小时"——
 * 那是另一个口径，会把昨天算进来）；`days = 7` 是最近 7 天。
 */
export async function readScreenTime(days = 1): Promise<ScreenTime> {
  const native = await nativeSense();
  if (!native) return { ok: false, reason: "unsupported" };

  try {
    const r = await native.api.usage({ days });
    if (!r?.granted) {
      return { ok: false, reason: "not-granted", detail: r?.reason };
    }
    const apps: AppUsage[] = (r.apps ?? [])
      .map((a) => ({
        pkg: a.package ?? "",
        app: a.app || a.package || "",
        ms: Math.max(0, Math.round(a.ms ?? 0)),
      }))
      .filter((a) => a.pkg && a.ms > 0)
      .sort((a, b) => b.ms - a.ms);

    return {
      ok: true,
      from: r.from ?? 0,
      to: r.to ?? Date.now(),
      // 原生给了 totalMs 就用它的（含被 40 条上限截掉的），没给就把列表加起来
      totalMs: Math.max(0, Math.round(r.totalMs ?? apps.reduce((s, a) => s + a.ms, 0))),
      apps,
    };
  } catch (e) {
    // 老包没有这个方法 / 原生抛了 —— 对用户来说都是"这次没读到"，但不是没授权
    return { ok: false, reason: "not-granted", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** 去开「使用情况访问」（各家 ROM 的菜单层级不一样，给按钮最省事） */
export async function openUsageSettings(): Promise<boolean> {
  const native = await nativeSense();
  if (!native) return false;
  try {
    const r = await native.api.openSettings({ which: "foreground" });
    return r?.ok === true;
  } catch {
    return false;
  }
}

/** 毫秒 → "3 小时 12 分钟" / "42 分钟" / "不到 1 分钟" */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 分钟";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "不到 1 分钟";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
}
