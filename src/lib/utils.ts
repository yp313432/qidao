import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * ⚠️ **时间格式化：格式化器只造一次 + 结果按分钟/天缓存**（2026-10，一次真机"卡死闪退"的元凶）。
 *
 * ── 原来为什么能把 App 卡死（真机实测 + CPU Profile 抓到的）──────────
 * 原来这里写的是 `new Date(ts).toLocaleTimeString("zh-CN", {...})` ——
 * **每调一次都会现场造一个 `Intl.DateTimeFormat`**（引擎里那一步很贵，
 * 安卓 WebView 上尤其明显，一次 0.3~1ms 起）。
 * 而聊天页是**每条消息、每次重渲染**都要调它（时间戳 + 日期各一次），
 * 流式回复时每秒十几次渲染 × 几十条消息 = **一秒上千次** →
 * 主线程被占满 → 界面卡死 → 系统判"无响应"直接杀进程。
 * 用户原话："全都卡住，有思考内容，然后闪退，不回复正文。"
 * （CPU Profile 里 `formatClock` 自己就占了 101ms，比 React 建元素还高。）
 *
 * ── 修法两层 ──────────────────────────────────────────────────────
 *   ① 格式化器**模块级只造一次**（主要那一刀）；
 *   ② 结果再按"分钟 / 天"缓存 —— 同一分钟里的消息共用一个字符串。
 *
 * 输出跟原来**逐字一致**（`Intl.DateTimeFormat#format` 就是
 * `toLocaleTimeString` 底下那套），`probe-cpu-profile.local.mjs` 里有一条对账。
 */
const clockFmt = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayFmt = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  weekday: "short",
});

/** 缓存上限：超过了就整体清掉（时间戳是递增的，老条目本来也用不上） */
const CACHE_MAX = 4000;
const clockCache = new Map<number, string>();
const dayCache = new Map<number, string>();

export function formatClock(ts: number): string {
  const key = Math.floor(ts / 60_000); // 同一分钟共用
  const hit = clockCache.get(key);
  if (hit !== undefined) return hit;
  const out = clockFmt.format(new Date(ts));
  if (clockCache.size >= CACHE_MAX) clockCache.clear();
  clockCache.set(key, out);
  return out;
}

export function formatDay(ts: number): string {
  const key = Math.floor(ts / 86_400_000); // 同一天共用
  const hit = dayCache.get(key);
  if (hit !== undefined) return hit;
  const out = dayFmt.format(new Date(ts));
  if (dayCache.size >= CACHE_MAX) dayCache.clear();
  dayCache.set(key, out);
  return out;
}
