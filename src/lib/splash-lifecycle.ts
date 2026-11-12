import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
/** Both sources must allow presentation; duplicate native/DOM events are harmless. */
export function watchSplashActivity(onActive: (active: boolean) => void): () => void {
  let disposed = false, native = !Capacitor.isNativePlatform(), revision = 0;
  let handle: { remove: () => Promise<void> } | undefined;
  const sync = () => { if (!disposed) onActive(native && !document.hidden); };
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pageshow', sync);
  const hide = () => { if (!disposed) onActive(false); };
  window.addEventListener('pagehide', hide);
  if (!native) {
    void (async () => {
      try {
        const listener = await App.addListener('appStateChange', state => { revision++; native = state.isActive; sync(); });
        if (disposed) { await listener.remove(); return; }
        handle = listener;
        const before = revision;
        const state = await App.getState();
        if (revision === before) { native = state.isActive; sync(); }
      } catch { native = true; sync(); } // old bridge: retain the DOM fallback
    })();
  }
  sync();
  return () => { disposed = true; document.removeEventListener('visibilitychange', sync); window.removeEventListener('pageshow', sync); window.removeEventListener('pagehide', hide); void handle?.remove(); };
}
