/**
 * 原生 HTTP —— 绕开 WebView 的跨域限制。
 *
 * 为什么要它：有些上游（比如 lmuai 这类中转）**没开 CORS**，
 * 浏览器 / WebView 里 fetch 会先被 `OPTIONS` 预检拦掉，报 `Failed to fetch`，
 * 用户只会看到「连不上上游」，完全猜不到是对方没开跨域。
 * 这时改用 Capacitor 的原生 HTTP（走系统网络栈，不受浏览器同源策略管），
 * 请求就能发出去 —— 代价是拿不到流式增量，只能等整段响应。
 *
 * **不要**在 capacitor.config 里开 `plugins.CapacitorHttp.enabled`：
 * 那是全局改 fetch，会把所有流式请求一起改掉（见 dashscope.ts 的注释）。
 * 这里只在「fetch 失败之后」单独调 `CapacitorHttp.request()`。
 */
type NativeRes = { status: number; data: unknown };

export type NativeHttpOptions = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: unknown;
  connectTimeout?: number;
  readTimeout?: number;
  responseType?: "text" | "arraybuffer";
};

type NativeHttpClient = {
  request: (options: NativeHttpOptions) => Promise<NativeRes & {
    url?: string;
    headers?: Record<string, string>;
  }>;
};

type NativeBridge = {
  isNativePlatform?: () => boolean;
  Plugins?: { CapacitorHttp?: NativeHttpClient };
  nativePromise?: (plugin: string, method: string, options: NativeHttpOptions) => ReturnType<NativeHttpClient["request"]>;
};

function bridge(): NativeBridge | undefined {
  return (globalThis as unknown as { Capacitor?: NativeBridge }).Capacitor;
}

export function isNativeHttpPlatform(): boolean {
  return Boolean(bridge()?.isNativePlatform?.());
}

/**
 * 使用 APK 启动时已注入的桥，不再等待动态模块加载。
 * Capacitor 8 的 nativePromise 可直接调用内置 CapacitorHttp 插件；
 * Plugins 上已有代理时优先复用它。两条路都不会修改全局 fetch。
 */
export function getNativeHttp(): NativeHttpClient | null {
  const cap = bridge();
  if (!cap?.isNativePlatform?.()) return null;
  const http = cap.Plugins?.CapacitorHttp;
  if (typeof http?.request === "function") return http;
  if (typeof cap.nativePromise === "function") {
    return { request: (options) => cap.nativePromise!("CapacitorHttp", "request", options) };
  }
  return null;
}

export async function nativeHttp(o: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: unknown;
}): Promise<NativeRes | null> {
  try {
    const http = getNativeHttp();
    if (!http) return null;
    return await http.request({ ...o, connectTimeout: 20_000, readTimeout: 120_000 });
  } catch {
    return null;
  }
}

/**
 * 这次失败值不值得用原生 HTTP 再试一次。
 *
 * 只在「浏览器层被拦/连不上」时才重试 —— 密钥错、模型名错这类**业务错误**
 * 重试也没用，反而把真正的错误信息盖掉。
 */
export function looksLikeNetworkBlock(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err ?? "");
  return /failed to fetch|networkerror|load failed|network request failed|connect|timed out|timeout/i.test(
    msg,
  );
}

