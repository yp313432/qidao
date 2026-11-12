import { kvGetRaw, kvSetRaw } from './data/local-kv.ts';
import { splashDue, splashMotionEnabled } from './splash-gate.ts';
export { splashDue, splashMotionEnabled, SPLASH_GAP_MS } from './splash-gate.ts';
const STORE_KEY = 'qidao.splash.at'; // keep the old key: upgrades preserve the cooldown
export const SPLASH_PREVIEW_EVENT = 'qidao:splash-preview';
export function lastSplashAt(): number | null {
  const raw = kvGetRaw(STORE_KEY);
  if (!raw) return null;
  const n = Number(raw); return Number.isFinite(n) ? n : null;
}
export function splashAllowed(mode?: string): boolean {
  if (typeof window === 'undefined') return false;
  const system = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return splashMotionEnabled(mode ?? document.documentElement.dataset.motion, system);
}
/** Startup compatibility entry; resume decisions use the lifecycle gate. */
export function shouldPlaySplash(now = Date.now()): boolean {
  if (!splashAllowed()) return false;
  if (new URLSearchParams(window.location.search).get('splash') === '1') return true;
  return splashDue(lastSplashAt(), now, false);
}
/** Only automatic playback that actually entered the foreground records a timestamp. */
export function markSplashPlayed(now = Date.now()): void { kvSetRaw(STORE_KEY, String(now)); }
export function requestSplashPreview(mode?: string): boolean {
  if (!splashAllowed(mode)) return false;
  window.dispatchEvent(new Event(SPLASH_PREVIEW_EVENT)); return true;
}
