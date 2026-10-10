import { nativeSense } from "@/lib/sense-bridge";
import {
  gapOutcome,
  renderSense,
  senseDevice,
  senseForeground,
  senseNotifications,
  sensePlace,
  senseScreen,
  senseTime,
  SENSE_PLACE_SWITCH_FIX,
  SENSE_SETTINGS_FIX,
  type DeviceFacts,
  type ForegroundFacts,
  type NotificationFacts,
  type PlaceFacts,
  type Reading,
  type SenseKind,
  type SenseOutcome,
} from "@/lib/sense-core";
import { useApp } from "@/lib/store";
import { refreshPlaceAndWeather } from "@/lib/where-am-i";

/**
 * **主动感知的接线层** —— 去把事实读出来，然后交给 `sense-core` 写成人话。
 *
 * 用户在说什么（原话）：
 *   "他现在只能感知，没有办法接到回执……所有的都是被动接收的，而不是主动去用这些权限。"
 *   "主动的感知就是知道目前的一个状态。"
 *
 * 所以这些函数**只在 AI 真的调用那个动作时**才跑（不是每轮都跑）：
 *   AI 调 `sense.device` → 这里问一次电量 → 结果当回合作为工具回执回去。
 *
 * ── 分工（别混）──────────────────────────────────────────────
 *   · `sense-core.ts`：**纯判定与措辞**（零 import，纯 node 能跑，验收脚本直接测它）
 *   · 本文件：**只有"去哪儿读"** —— 原生插件 / navigator / store / 定位那套
 *
 * ── 网页版怎么办（用户给了两条路，这里选"如实返回"）──────────────
 * 网页版没有原生插件，所以我们**照旧注册这些动作**，调用时返回
 * "网页版没有这个能力（要装成 App）" —— 而不是不注册。
 * 为什么选这条：不注册的话他只会说"我做不到"，用户永远不知道
 * "装成 App 就有了"；如实返回能把这件事说清楚（也符合"绝不静默"）。
 * 唯一例外是"网络在不在线"这类**网页真的知道**的事实，那就照实报（电量绝不许编）。
 */

/** 把异常变成一句人话（原生报错里常常只有英文类名） */
function errText(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e ?? "")).trim();
  /**
   * ⚠️ "这台手机装的是老包、里面没有 SenseBridge" 会以
   * `"SenseBridge.device()" is not implemented on android` 的形式抛出来。
   * 照原样贴给模型等于贴一句英文天书 —— 换成一句他能转告给用户的话。
   */
  if (/not implemented/i.test(raw)) return "这个版本的 App 里还没带上这个能力（装最新版再试）";
  return raw || "原生那边没给原因";
}

/** 用户上一次/他自己上一次说话的时间（拿不到就不给，别编一个） */
function lastSpokeAt(): { lastUserAt?: number; lastAssistantAt?: number } {
  const st = useApp.getState();
  let lastUserAt: number | undefined;
  let lastAssistantAt: number | undefined;
  for (const conv of st.conversations) {
    for (const m of conv.messages) {
      if (m.role === "user" && (lastUserAt === undefined || m.createdAt > lastUserAt)) {
        lastUserAt = m.createdAt;
      }
      if (m.role === "assistant" && (lastAssistantAt === undefined || m.createdAt > lastAssistantAt)) {
        lastAssistantAt = m.createdAt;
      }
    }
  }
  return { lastUserAt, lastAssistantAt };
}

function localZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------- A 组：零权限（先做扎实） ------------------------- */

/** 电量 / 充电 / 网络类型 */
async function readDevice(): Promise<Reading<DeviceFacts>> {
  const n = await nativeSense();
  if (n) {
    try {
      const r = await n.api.device();
      const battery = typeof r.battery === "number" ? r.battery : null;
      return {
        ok: true,
        value: {
          battery,
          charging: typeof r.charging === "boolean" ? r.charging : null,
          network: typeof r.network === "string" && r.network ? r.network : "unknown",
          online: typeof r.online === "boolean" ? r.online : null,
          missing: battery === null ? "这台机器没给电量" : undefined,
        },
      };
    } catch (e) {
      return { ok: false, gap: "error", detail: errText(e) };
    }
  }

  /**
   * 网页版：只报**网页真的知道**的那点东西。
   *
   * ⚠️ 故意**不**用 `navigator.getBattery()`：Chromium 桌面版会返回一个
   * `level:1 / charging:true` 的假电池 —— 把它当"电量 100%，正在充电"报出去
   * 就是编数据（用户要的是"主动看一眼状态"，不是看一句漂亮假话）。
   */
  if (typeof navigator === "undefined") {
    return { ok: false, gap: "web", detail: "这个环境读不到设备状态" };
  }
  const conn = (navigator as { connection?: { type?: string } }).connection;
  const type = conn?.type && conn.type !== "unknown" ? conn.type : undefined;
  return {
    ok: true,
    value: {
      battery: null,
      charging: null,
      network: type ?? "unknown",
      online: typeof navigator.onLine === "boolean" ? navigator.onLine : null,
      missing: "网页版读不到电量和充电，装成 App 才能看",
    },
  };
}

/** 我在哪 / 外面天气（复用现成的定位 + 和风那一套，不重写） */
async function readPlace(): Promise<Reading<PlaceFacts>> {
  const st = useApp.getState();
  if (!st.settings.geoEnabled) {
    return {
      ok: false,
      gap: "off",
      detail: "定位和天气的开关是关着的，我看不到你在哪",
      fix: SENSE_PLACE_SWITCH_FIX,
    };
  }
  try {
    // 不强制刷新：15 分钟内的天气、30 分钟内的地点直接用缓存（护住和风的免费额度）
    const r = await refreshPlaceAndWeather(false);
    if (!r.ok) return { ok: false, gap: "error", detail: r.reason };
    const live = useApp.getState().settings;
    return {
      ok: true,
      value: {
        label: r.label,
        weather: r.weather ?? live.weatherText ?? null,
        source: r.source ?? "unknown",
        at: live.geoAt ?? Date.now(),
      },
    };
  } catch (e) {
    return { ok: false, gap: "error", detail: errText(e) };
  }
}

/* ------------------ B 组：要系统权限（优雅失败 + 指路） ------------------ */

async function readNotifications(): Promise<Reading<NotificationFacts>> {
  const n = await nativeSense();
  if (!n) {
    return { ok: false, gap: "web", detail: "读最近的通知要装成 App（网页版拿不到系统通知）" };
  }
  try {
    const r = await n.api.notifications();
    if (r.granted === false) {
      return {
        ok: false,
        gap: "permission",
        detail: (r.reason ?? "").trim() || "还没打开「通知使用权」",
        fix: SENSE_SETTINGS_FIX.notifications,
      };
    }
    const items = (r.items ?? [])
      .map((i) => ({
        app: String(i.app ?? "某个应用"),
        title: String(i.title ?? ""),
        text: String(i.text ?? ""),
        minutesAgo: Number.isFinite(i.minutesAgo) ? Number(i.minutesAgo) : 0,
      }))
      .filter((i) => i.title || i.text);
    return { ok: true, value: { items } };
  } catch (e) {
    return { ok: false, gap: "error", detail: errText(e) };
  }
}

async function readForeground(): Promise<Reading<ForegroundFacts>> {
  const n = await nativeSense();
  if (!n) {
    return { ok: false, gap: "web", detail: "看当前前台是哪个 App 要装成 App（网页版看不到）" };
  }
  try {
    const r = await n.api.foreground();
    if (r.granted === false || !r.app) {
      return {
        ok: false,
        gap: "permission",
        detail: (r.reason ?? "").trim() || "还没打开「使用情况访问」",
        fix: SENSE_SETTINGS_FIX.foreground,
      };
    }
    return { ok: true, value: { app: String(r.app), package: String(r.package ?? "") } };
  } catch (e) {
    return { ok: false, gap: "error", detail: errText(e) };
  }
}

async function readScreen(): Promise<Reading<{ interactive: boolean; locked: boolean }>> {
  const n = await nativeSense();
  if (!n) {
    return { ok: false, gap: "web", detail: "屏幕亮没亮只有装了 App 才读得到" };
  }
  try {
    const r = await n.api.screen();
    return {
      ok: true,
      value: { interactive: r.interactive !== false, locked: Boolean(r.locked) },
    };
  } catch (e) {
    return { ok: false, gap: "error", detail: errText(e) };
  }
}

/* --------------------------------- 出口 --------------------------------- */

/**
 * 跑一个感知动作，回**一行 JSON**（结构化字段 + `summary`）。
 *
 * ⚠️ 这里**绝不许抛**：动作执行器（`runAction`）是一条链，
 * 感知读不到（比如没插插件）不能把整条链弄崩 —— 那里崩了的表现是
 * "他调了工具，但什么都没有回执"，正是用户最烦的那种沉默。
 */
export async function runSenseAction(kind: SenseKind): Promise<string> {
  try {
    switch (kind) {
      case "sense.time":
        return renderSense(senseTime({ now: Date.now(), tz: localZone(), ...lastSpokeAt() }));
      case "sense.device":
        return renderSense(senseDevice(await readDevice()));
      case "sense.place":
        return renderSense(sensePlace(await readPlace()));
      case "sense.notifications":
        return renderSense(senseNotifications(await readNotifications()));
      case "sense.foreground":
        return renderSense(senseForeground(await readForeground()));
      case "sense.screen":
        return renderSense(senseScreen(await readScreen()));
      default: {
        const never: never = kind;
        return renderSense(gapOutcome("error", `不认识的感知动作 ${String(never)}`));
      }
    }
  } catch (e) {
    return renderSense(gapOutcome("error", errText(e)) as SenseOutcome);
  }
}
