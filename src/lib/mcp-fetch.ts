/** MCP needs streamed responses and readable session headers on Android. */
type NativeEvent = { id: string; type: "headers" | "chunk" | "end" | "error"; status?: number; headers?: Record<string, string>; data?: string; message?: string };
type NativeNetwork = {
  addListener: (event: "response", listener: (event: NativeEvent) => void) => Promise<{ remove: () => Promise<void> }>;
  start: (options: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }) => Promise<void>;
  cancel: (options: { id: string }) => Promise<void>;
};

export function isNativeMcp(): boolean {
  return Boolean((globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

type ListenerHandle = { remove: () => Promise<void> };
type InjectedMcpBridge = {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, options: unknown) => Promise<void>;
  addListener?: (plugin: string, event: string, listener: (event: NativeEvent) => void) => ListenerHandle | Promise<ListenerHandle>;
  Plugins?: { QidaoMcpNetwork?: NativeNetwork };
};

/** Never resolve a Capacitor plugin Proxy from a Promise: its synthetic `then` traps assimilation. */
export function nativeNetwork(): NativeNetwork {
  const cap = (globalThis as unknown as { Capacitor?: InjectedMcpBridge }).Capacitor;
  if (cap?.nativePromise && cap.addListener) {
    return {
      addListener: (event, listener) => Promise.resolve(cap.addListener!("QidaoMcpNetwork", event, listener)),
      start: (options) => cap.nativePromise!("QidaoMcpNetwork", "start", options),
      cancel: (options) => cap.nativePromise!("QidaoMcpNetwork", "cancel", options),
    };
  }
  const plugin = cap?.Plugins?.QidaoMcpNetwork;
  if (plugin) return {
    addListener: (event, listener) => Promise.resolve(plugin.addListener(event, listener)),
    start: (options) => plugin.start(options), cancel: (options) => plugin.cancel(options),
  };
  throw new Error("MCP_NATIVE_UNAVAILABLE：原生 MCP 通道未就绪，请更新 App 后重试");
}

export async function mcpFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  if (!isNativeMcp()) return fetch(input, init);
  return streamedNativeFetch(nativeNetwork(), String(input), init);
}

/** Exported boundary allows the real stream lifecycle to be tested without Android. */
export async function streamedNativeFetch(native: NativeNetwork, url: string, init: RequestInit = {}): Promise<Response> {
  if (!/^https?:$/.test(new URL(url).protocol)) throw new Error("MCP 地址必须是 http 或 https");
  if (init.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
  if (init.body != null && typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) throw new Error("MCP 原生请求体必须是文本");
  const id = crypto.randomUUID();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let settled = false;
  let ended = false;
  let listener: { remove: () => Promise<void> } | undefined;
  let registrationTimer: ReturnType<typeof setTimeout> | undefined;
  let headersTimer: ReturnType<typeof setTimeout> | undefined;
  let finishResponse: (response: Response) => void;
  let failResponse: (error: Error) => void;
  const response = new Promise<Response>((resolve, reject) => { finishResponse = resolve; failResponse = reject; });
  const cleanup = () => {
    clearTimeout(registrationTimer); clearTimeout(headersTimer);
    init.signal?.removeEventListener("abort", abort);
    try { void listener?.remove().catch(() => {}); } catch { /* Best effort native cleanup. */ }
  };
  const fail = (error: Error) => {
    if (ended) return;
    ended = true;
    controller.error(error);
    if (!settled) failResponse(error);
    cleanup();
  };
  const abort = () => {
    fail(new DOMException("请求已取消", "AbortError"));
    void Promise.resolve().then(() => native.cancel({ id })).catch(() => {});
  };
  const body = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    cancel() { ended = true; cleanup(); void native.cancel({ id }).catch(() => {}); },
  });
  const receive = (event: NativeEvent) => {
    if (event.id !== id || ended) return;
    try {
      if (event.type === "headers") {
        if (settled) return;
        const status = event.status ?? 0;
        clearTimeout(headersTimer);
        const result = new Response([204, 205, 304].includes(status) ? null : body, { status, headers: event.headers });
        settled = true; finishResponse(result);
      } else if (event.type === "chunk") {
        controller.enqueue(Uint8Array.from(atob(event.data ?? ""), (c) => c.charCodeAt(0)));
      } else if (event.type === "end") {
        if (!settled) { fail(new Error("MCP_NATIVE_INVALID_RESPONSE：原生请求结束但没有返回 HTTP 状态")); return; }
        ended = true;
        controller.close();
        cleanup();
      } else if (event.type === "error") fail(new Error(event.message || "原生 MCP 请求失败"));
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  };
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) abort();
  else {
    registrationTimer = setTimeout(() => {
      fail(new Error("MCP_NATIVE_LISTENER_TIMEOUT：原生事件监听初始化超时，请更新 App 并重新打开"));
      void Promise.resolve().then(() => native.cancel({ id })).catch(() => {});
    }, 5000);
    // Return the response promise now, so cancellation also works during listener registration.
    void (async () => {
      const handle = await native.addListener("response", receive);
      clearTimeout(registrationTimer);
      if (ended) { await handle.remove(); return; }
      listener = handle;
      if (init.signal?.aborted) { abort(); return; }
      headersTimer = setTimeout(() => {
        fail(new Error("MCP_NATIVE_HEADERS_TIMEOUT：20秒内未收到 HTTP 响应头，请检查服务是否可访问"));
        void Promise.resolve().then(() => native.cancel({ id })).catch(() => {});
      }, 20000);
      await native.start({ id, url, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers)),
        ...(init.body != null ? { body: String(init.body) } : {}),
      });
    })().catch((error: unknown) => fail(error instanceof Error ? error : new Error("MCP_NATIVE_START_FAILED：原生 MCP 请求未能启动")));
  }
  return response;
}
