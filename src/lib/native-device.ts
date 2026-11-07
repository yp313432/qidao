import { registerPlugin } from "@capacitor/core";
import { IS_APP } from "@/lib/platform";

/**
 * **零权限的"动手"层**（2026-11，用户 m05769：先做零权限那半套）。
 *
 * 这一层能做的事，全都不需要特殊权限 —— 因为它们都是**把请求交给系统**：
 *   开 App（等于点了下桌面图标）/ 系统分享 / 剪贴板 / 地图导航 / 写日历（系统编辑页）
 *
 * 三条边界必须记住，别越界：
 *   · 点不了别人 App 里的按钮、读不到别人 App 的字 —— 那要无障碍（P2b）或 Shizuku（P2c）
 *   · 剪贴板读在 Android 10+ **只允许前台**（系统的规矩）
 *   · 写日历是"打开新建日程页填好"，用户按保存才真的写进去（`ACTION_INSERT` 的语义）
 *
 * 网页版有降级：分享走 `navigator.share` 再退到剪贴板，地图走高德网页，
 * 日历退成下载一个 `.ics`（双击就能进系统日历）。App 里这些全走原生。
 */

type DeviceApi = {
  listApps: () => Promise<{ ok: boolean; apps?: { pkg: string; label: string }[]; total?: number }>;
  openApp: (o: { query: string }) => Promise<{
    ok: boolean;
    pkg?: string;
    label?: string;
    reason?: string;
    candidates?: string[];
  }>;
  share: (o: { text: string; title?: string }) => Promise<{ ok: boolean }>;
  openUrl: (o: { url: string }) => Promise<{ ok: boolean }>;
  openMap: (o: {
    query?: string;
    lat?: number;
    lng?: number;
  }) => Promise<{ ok: boolean; uri?: string }>;
  addCalendar: (o: {
    title: string;
    begin?: string;
    end?: string;
    allDay?: boolean;
    location?: string;
    notes?: string;
  }) => Promise<{ ok: boolean; begin?: number }>;
  clipboardRead: () => Promise<{ ok: boolean; text?: string }>;
  clipboardWrite: (o: { text: string }) => Promise<{ ok: boolean }>;
};

let cached: DeviceApi | null = null;

function api(): DeviceApi | null {
  if (!IS_APP) return null;
  try {
    if (!cached) cached = registerPlugin<DeviceApi>("QidaoDevice");
    return cached;
  } catch {
    return null;
  }
}

/** 能打开的 App 列表（网页版返回空 —— 浏览器看不见你手机上装了什么，这是对的） */
export async function listLaunchableApps(): Promise<{ pkg: string; label: string }[]> {
  const a = api();
  if (!a) return [];
  try {
    const r = await a.listApps();
    return r.apps ?? [];
  } catch {
    return [];
  }
}

export type OpenAppResult = {
  ok: boolean;
  label?: string;
  pkg?: string;
  /** 没找到时给几个相近的名字，让模型能自己纠正，而不是干瞪眼 */
  candidates?: string[];
  reason?: string;
};

export async function openApp(query: string): Promise<OpenAppResult> {
  const q = query.trim();
  if (!q) return { ok: false, reason: "没说打开哪个" };
  const a = api();
  if (!a) return { ok: false, reason: "网页版打不开手机上的 App，装成 App 才有" };
  try {
    const r = await a.openApp({ query: q });
    return {
      ok: Boolean(r.ok),
      label: r.label,
      pkg: r.pkg,
      candidates: r.candidates ?? [],
      reason: r.reason,
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "没能打开" };
  }
}

/** 分享文本/链接：App 里是系统分享面板；网页版退到 Web Share API，再退到复制 */
export async function shareText(
  text: string,
  title?: string,
): Promise<{ ok: boolean; via: "system" | "web-share" | "clipboard" | "none"; reason?: string }> {
  const a = api();
  if (a) {
    try {
      await a.share({ text, title });
      return { ok: true, via: "system" };
    } catch (e) {
      return { ok: false, via: "none", reason: e instanceof Error ? e.message : "没能分享" };
    }
  }
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share(title ? { text, title } : { text });
      return { ok: true, via: "web-share" };
    }
  } catch {
    /* 用户取消了分享面板 —— 不算成功，下面走剪贴板 */
  }
  const copied = await clipboardWrite(text);
  return copied
    ? { ok: true, via: "clipboard" }
    : { ok: false, via: "none", reason: "复制也没成功" };
}

export async function openUrl(url: string): Promise<{ ok: boolean; reason?: string }> {
  const a = api();
  if (a) {
    try {
      await a.openUrl({ url });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "打不开" };
    }
  }
  try {
    window.open(url, "_blank", "noopener");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "打不开" };
  }
}

/** 打开地图：有坐标给坐标，只有地名就给地名（两种写法各家地图都认） */
export async function openMap(input: {
  query?: string;
  lat?: number;
  lng?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const a = api();
  if (a) {
    try {
      await a.openMap(input);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "没能打开地图" };
    }
  }
  /* 网页版：高德的网页版搜索页（手机上会引导打开 App） */
  const q = input.query?.trim();
  const url =
    input.lat !== undefined && input.lng !== undefined
      ? `https://uri.amap.com/marker?position=${input.lng},${input.lat}${q ? `&name=${encodeURIComponent(q)}` : ""}`
      : q
        ? `https://uri.amap.com/search?keyword=${encodeURIComponent(q)}`
        : "";
  if (!url) return { ok: false, reason: "没说要导航去哪" };
  return openUrl(url);
}

export type CalendarInput = {
  title: string;
  /** ISO 8601，例如 2026-11-08T07:30:00；不传就是现在 */
  begin?: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
};

/** 写日历：App 里打开系统新建日程页（用户按保存才真写入）；网页版下载一个 .ics */
export async function addCalendarEvent(
  input: CalendarInput,
): Promise<{ ok: boolean; reason?: string }> {
  const a = api();
  if (a) {
    try {
      await a.addCalendar({
        title: input.title,
        begin: input.begin,
        end: input.end,
        allDay: input.allDay ?? false,
        location: input.location,
        notes: input.notes,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "没能打开日历" };
    }
  }

  /* 网页版：拼一份最小可用的 .ics，双击就能进系统日历 */
  try {
    const begin = icsTime(input.begin);
    const end = icsTime(input.end ?? input.begin);
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//qidao//calendar//CN",
      "BEGIN:VEVENT",
      `UID:${Date.now()}@qidao`,
      `DTSTAMP:${icsTime(new Date().toISOString())}`,
      `DTSTART:${begin}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeIcs(input.title)}`,
      input.location ? `LOCATION:${escapeIcs(input.location)}` : "",
      input.notes ? `DESCRIPTION:${escapeIcs(input.notes)}` : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean);
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "qidao-event.ics";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "没能生成日历文件" };
  }
}

function icsTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function clipboardRead(): Promise<string> {
  const a = api();
  if (a) {
    try {
      const r = await a.clipboardRead();
      return r.text ?? "";
    } catch {
      return "";
    }
  }
  try {
    return (await navigator.clipboard.readText()) ?? "";
  } catch {
    return "";
  }
}

export async function clipboardWrite(text: string): Promise<boolean> {
  const a = api();
  if (a) {
    try {
      await a.clipboardWrite({ text });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
