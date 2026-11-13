export function pluginWebUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("请填写 HTTP 或 HTTPS 网页地址");
  return url.href;
}

/** Top-level Custom Tab / browser tab, independent of iframe permissions. */
export async function openPluginWeb(raw: string): Promise<void> {
  const url = pluginWebUrl(raw);
  const native = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  if (native) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } else {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    // With noopener, browsers may return null even when the tab opened.
    if (opened) opened.opener = null;
  }
}
