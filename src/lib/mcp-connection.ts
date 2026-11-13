import { mcpFetch } from "./mcp-fetch.ts";

type Rpc = { jsonrpc?: string; id?: number | string | null; result?: unknown; error?: { code?: number; message?: string }; method?: string; params?: unknown };
type Pending = { resolve: (message: Rpc) => void; reject: (error: Error) => void };
export class McpHttpError extends Error {
  status: number;
  constructor(status: number, detail: string) { super(`HTTP ${status}${detail ? `：${detail.slice(0, 400)}` : ""}`); this.status = status; }
}

/** Incremental SSE parser: works with split UTF-8, CRLF, comments and multiline data. */
export async function readMcpEvents(response: Response, onEvent: (event: string, data: string) => boolean | void): Promise<void> {
  if (!response.body) throw new Error("MCP 没有返回事件流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", event = "message", data: string[] = [], size = 0;
  const line = (value: string) => {
    if (!value) {
      const stop = data.length ? onEvent(event, data.join("\n")) === true : false;
      event = "message"; data = []; size = 0;
      return stop;
    }
    if (value.startsWith(":")) return false;
    const colon = value.indexOf(":");
    const key = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? "" : value.slice(colon + 1);
    if (content.startsWith(" ")) content = content.slice(1);
    if (key === "event") event = content;
    if (key === "data") { data.push(content); size += content.length; }
    if (size > 2_000_000) throw new Error("MCP 单个事件过大");
    return false;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2_000_000) throw new Error("MCP 事件过大");
      let pos: number;
      while ((pos = buffer.indexOf("\n")) >= 0) {
        const current = buffer.slice(0, pos).replace(/\r$/, "");
        buffer = buffer.slice(pos + 1);
        if (line(current)) return;
      }
      if (done) { if (buffer) line(buffer.replace(/\r$/, "")); line(""); return; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class McpConnection {
  sessionId = "";
  protocolVersion = "";
  serverInfo?: { name?: string; version?: string };
  closed = false;
  private nextId = 1;
  private pending = new Map<number | string, Pending>();
  private stream?: Promise<void>;
  private streamAbort?: AbortController;
  private endpoint?: string;
  private endpointReady?: { resolve: (value: string) => void; reject: (error: Error) => void };
  readonly url: string;
  readonly transport: "http" | "sse";
  private headers: Headers;
  constructor(url: string, transport: "http" | "sse", headers: Headers) {
    this.url = url; this.transport = transport; this.headers = headers;
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error("MCP 地址必须是无内嵌密码的 http 或 https 地址");
  }
  private requestHeaders() {
    const headers = new Headers(this.headers);
    headers.set("accept", "application/json, text/event-stream");
    if (this.protocolVersion) headers.set("mcp-protocol-version", this.protocolVersion);
    if (this.sessionId) headers.set("mcp-session-id", this.sessionId);
    return headers;
  }
  private deliver(data: string) {
    let message: Rpc;
    try { message = JSON.parse(data) as Rpc; } catch { throw new Error("MCP 返回了无效的 JSON 事件"); }
    const pending = message.id == null ? undefined : this.pending.get(message.id);
    if (pending) { this.pending.delete(message.id!); pending.resolve(message); }
  }
  private async getEvents(signal: AbortSignal): Promise<void> {
    const response = await mcpFetch(this.url, { headers: this.requestHeaders(), signal });
    if (!response.ok) throw new McpHttpError(response.status, await response.text());
    await readMcpEvents(response, (event, data) => {
      if (event === "endpoint" && this.transport === "sse") {
        const endpoint = new URL(data, this.url);
        if (endpoint.origin !== new URL(this.url).origin) throw new Error("MCP 返回了跨站消息地址，未向其发送凭据");
        this.endpoint = endpoint.href; this.endpointReady?.resolve(endpoint.href);
      } else if (event === "message") this.deliver(data);
    });
    throw new Error("MCP 事件连接已关闭，请重试");
  }
  private startEvents() {
    if (this.stream) return;
    this.streamAbort = new AbortController();
    this.stream = this.getEvents(this.streamAbort.signal).catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.endpointReady?.reject(failure);
      this.close(failure);
    });
  }
  private async legacyEndpoint(signal: AbortSignal) {
    if (this.endpoint) return this.endpoint;
    const ready = new Promise<string>((resolve, reject) => { this.endpointReady = { resolve, reject }; });
    const abort = () => this.endpointReady?.reject(new DOMException("请求已取消", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    this.startEvents();
    try { return await ready; } finally { signal.removeEventListener("abort", abort); }
  }
  async send(method: string, params: unknown, signal: AbortSignal, notification = false): Promise<Rpc> {
    if (this.closed) throw new Error("MCP 连接已关闭");
    if (signal.aborted) throw new DOMException("请求已取消", "AbortError");
    const url = this.transport === "sse" ? await this.legacyEndpoint(signal) : this.url;
    const id = this.nextId++;
    let responseMessage: Promise<Rpc> | undefined;
    if (!notification) responseMessage = new Promise<Rpc>((resolve, reject) => { this.pending.set(id, { resolve, reject }); });
    // Observe early aborts/stream failures while the POST is still in flight.
    void responseMessage?.catch(() => {});
    const abort = () => { this.pending.get(id)?.reject(new DOMException("请求已取消", "AbortError")); this.pending.delete(id); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const headers = this.requestHeaders(); headers.set("content-type", "application/json");
      const response = await mcpFetch(url, { method: "POST", headers, signal,
        body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, ...(params === undefined ? {} : { params }) }),
      });
      if (!response.ok) throw new McpHttpError(response.status, await response.text());
      this.sessionId = response.headers.get("mcp-session-id") || this.sessionId;
      if (notification) { await response.body?.cancel(); return {}; }
      if (response.status === 202) {
        if (this.transport === "http") this.startEvents();
      } else if (/text\/event-stream/i.test(response.headers.get("content-type") ?? "")) {
        await readMcpEvents(response, (event, data) => {
          if (event === "message") this.deliver(data);
          return !this.pending.has(id);
        });
        if (this.pending.has(id)) throw new Error("MCP 事件流结束但未返回请求结果");
      } else {
        const message = await response.text();
        if (message.trim()) this.deliver(message);
        if (this.pending.has(id)) throw new Error("MCP 未返回对应请求的结果");
      }
      return await responseMessage!;
    } finally { this.pending.delete(id); signal.removeEventListener("abort", abort); }
  }
  async initialize(signal: AbortSignal) {
    const message = await this.send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "qidao", version: "1.1.0" } }, signal);
    if (message.error) throw new Error(message.error.message || "MCP 握手失败");
    if (!message.result || typeof message.result !== "object") throw new Error("MCP 握手没有返回有效结果");
    const result = message.result as { protocolVersion?: string; serverInfo?: { name?: string; version?: string } };
    this.protocolVersion = result.protocolVersion || "2025-06-18";
    this.serverInfo = result.serverInfo;
    await this.send("notifications/initialized", undefined, signal, true);
  }
  close(error = new Error("MCP 连接已关闭")) {
    this.closed = true; this.streamAbort?.abort();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
