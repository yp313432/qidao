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

let network: Promise<NativeNetwork> | undefined;
async function nativeNetwork(): Promise<NativeNetwork> {
  network ??= import("@capacitor/core").then(({ registerPlugin }) => registerPlugin<NativeNetwork>("QidaoMcpNetwork"));
  return network;
}

export async function mcpFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  if (!isNativeMcp()) return fetch(input, init);
  return streamedNativeFetch(await nativeNetwork(), String(input), init);
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
  let finishResponse: (response: Response) => void;
  let failResponse: (error: Error) => void;
  const response = new Promise<Response>((resolve, reject) => { finishResponse = resolve; failResponse = reject; });
  const cleanup = () => {
    init.signal?.removeEventListener("abort", abort);
    void listener?.remove().catch(() => {});
  };
  const fail = (error: Error) => {
    if (ended) return;
    ended = true;
    if (!settled) failResponse(error);
    else controller.error(error);
    cleanup();
  };
  const abort = () => {
    fail(new DOMException("请求已取消", "AbortError"));
    void native.cancel({ id }).catch(() => {});
  };
  const body = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    cancel() { ended = true; cleanup(); void native.cancel({ id }).catch(() => {}); },
  });
  listener = await native.addListener("response", (event) => {
    if (event.id !== id || ended) return;
    try {
      if (event.type === "headers") {
        settled = true;
        const status = event.status ?? 0;
        finishResponse(new Response([204, 205, 304].includes(status) ? null : body, { status, headers: event.headers }));
      } else if (event.type === "chunk") {
        controller.enqueue(Uint8Array.from(atob(event.data ?? ""), (c) => c.charCodeAt(0)));
      } else if (event.type === "end") {
        ended = true;
        controller.close();
        cleanup();
      } else if (event.type === "error") fail(new Error(event.message || "原生 MCP 请求失败"));
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) abort();
  else void native.start({ id, url, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers)),
    ...(init.body != null ? { body: String(init.body) } : {}),
  }).catch((error: unknown) => fail(error instanceof Error ? error : new Error("原生 MCP 网络插件不可用，请更新 App")));
  return response;
}
