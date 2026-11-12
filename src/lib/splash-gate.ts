/** Lifecycle policy, independent of React and the Android bridge. */
export const SPLASH_GAP_MS = 60 * 60 * 1000;
export type SplashReason = 'cold' | 'resume' | 'preview';
export function splashDue(lastAt: number | null, now: number, reducedMotion: boolean): boolean {
  if (reducedMotion) return false;
  return lastAt === null || !Number.isFinite(lastAt) || lastAt > now || now - lastAt >= SPLASH_GAP_MS;
}
export function splashMotionEnabled(mode: string | undefined, systemReduced: boolean): boolean {
  return mode === 'on' || (mode !== 'off' && !systemReduced);
}
export function createSplashGate(options: {
  initialPreview?: boolean; now: () => number; lastAt: () => number | null; enabled: () => boolean;
  play: (reason: SplashReason) => void; stop: () => void; mark: (at: number) => void;
}) {
  let active = false, initialized = false, running = false, shown = false;
  let awayAt: number | null = null, recordedAt: number | null = null;
  let reason: SplashReason = 'cold';
  const due = () => splashDue(recordedAt ?? options.lastAt(), options.now(), !options.enabled());
  const start = (why: SplashReason) => {
    if (!active || running || !options.enabled() || (why !== 'preview' && !due())) return false;
    running = true; shown = false; reason = why; options.play(why); return true;
  };
  const cancel = () => { if (running) { running = false; options.stop(); } };
  return {
    setActive(next: boolean) {
      if (next === active) return;
      active = next;
      if (!next) { awayAt = options.now(); cancel(); return; }
      const away = awayAt; awayAt = null;
      if (!initialized) { initialized = true; start(options.initialPreview ? 'preview' : 'cold'); return; }
      if (away !== null && options.now() - away >= SPLASH_GAP_MS) start('resume');
    },
    preview: () => start('preview'),
    /** Called only after the overlay is attached, visible and in the foreground. */
    presented() {
      if (!running || !active || !options.enabled()) return false;
      if (!shown && reason !== 'preview') { recordedAt = options.now(); options.mark(recordedAt); }
      shown = true; return true;
    },
    finish() { running = false; },
    cancel,
    isActive: () => active,
  };
}
