/**
 * 开屏动画什么时候该播。
 *
 * 规矩是用户定的（m06858 / m06940 那一轮讨论）：
 *   · **冷启动**才播 —— 不是切页、不是回前台；
 *   · 距上次播过要超过 **1 小时**（2026-11 用户改的：原来 4 小时，改成 1 小时启动一次，
 *     隔一会儿再开不会重播，免得每次进 App 都要等五秒）；
 *   · 系统开了「减少动态效果」就直接跳过去（前庭失调的人会被这种动画晃到）。
 *
 * 纯函数 `splashDue()` 单独拆出来是为了能在 node 里测（沙盒里没有 localStorage）。
 */

const STORE_KEY = "qidao.splash.at";

/** 两次开屏之间的最小间隔：1 小时。 */
export const SPLASH_GAP_MS = 1 * 60 * 60 * 1000;

/**
 * 该不该播。
 *
 * @param lastAt 上次播的时刻（毫秒时间戳）；`null` = 从没播过
 * @param now 现在
 * @param reducedMotion 用户是否要求减少动态效果
 */
export function splashDue(lastAt: number | null, now: number, reducedMotion: boolean): boolean {
  if (reducedMotion) return false;
  if (lastAt === null || !Number.isFinite(lastAt)) return true;
  /* 时钟往回拨过（lastAt 在未来）也照播一次，否则会永远不播 */
  if (lastAt > now) return true;
  return now - lastAt >= SPLASH_GAP_MS;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    /* 隐私模式 / 被禁用时读不到，那就老实不播 */
    return null;
  }
}

/** 读上次播放的时刻；没有或坏了都返回 null。 */
export function lastSplashAt(): number | null {
  const raw = storage()?.getItem(STORE_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 现在这一刻该不该播（浏览器环境版）。 */
export function shouldPlaySplash(now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* 调试口子：地址栏加 ?splash=1 就强制播一次（真机上想反复看只能靠它，
     否则要等 4 小时）。减少动态效果仍然优先。 */
  if (!reduced && window.location?.search.includes("splash=1")) return true;
  return splashDue(lastSplashAt(), now, reduced);
}

/**
 * 记一笔"播过了"。
 *
 * 在**开始播**的时候记，不是播完 —— 播到一半被杀掉（切后台、来电）不该下次再来一遍。
 */
export function markSplashPlayed(now = Date.now()): void {
  try {
    storage()?.setItem(STORE_KEY, String(now));
  } catch {
    /* 存不进去就算了，最多下次多播一遍 */
  }
}
