import { accessTokenFor, discover } from "./mcp-oauth";
import type { McpOAuth, McpServer, McpTool } from "./types";
import { McpConnection, McpHttpError } from "./mcp-connection.ts";
import { isNativeMcp } from "./mcp-fetch.ts";

export const DEFAULT_MCP: McpServer[] = [];
export type McpProbe = { ok: boolean; message: string; tools: McpTool[]; serverName?: string; serverVersion?: string; protocolVersion?: string; needsAuth?: boolean; oauthPatch?: Partial<McpOAuth> };
export type ToolCallResult = { ok: boolean; text: string; oauthPatch?: Partial<McpOAuth> };
const MAX_TOOL_TEXT = 8000;
const sessions = new Map<string, { connection: McpConnection; key: string; at: number }>();
const SESSION_TTL_MS = 5 * 60_000;
export function closeMcpSession(id: string) { sessions.get(id)?.connection.close(); sessions.delete(id); }
function parseHeaders(text: string): Headers {
  const headers = new Headers();
  for (const line of text.split(/\r?\n/)) { const i = line.indexOf(":"); if (i > 0) headers.set(line.slice(0, i).trim(), line.slice(i + 1).trim()); }
  return headers;
}
async function headersFor(
  server: McpServer,
): Promise<{ headers: Headers; oauthPatch?: Partial<McpOAuth> }> {
  const headers = parseHeaders(server.headersText);
  let oauthPatch: Partial<McpOAuth> | undefined;
  if (!headers.has("authorization")) {
    const t = await accessTokenFor(server);
    if (t.token) headers.set("authorization", `Bearer ${t.token}`);
    if (t.patch) oauthPatch = t.patch;
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (!headers.has("accept")) headers.set("accept", "application/json, text/event-stream");
  return { headers, oauthPatch };
}


function failure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if ((error as Error)?.name === "AbortError") return "等太久没回应，先断了。请检查服务是否已启动，或稍后重试。";
  if (error instanceof McpHttpError && [401, 403].includes(error.status)) return message + " —— 对方要求认证，请检查请求头或完成授权。";
  return message + (isNativeMcp() ? "（App 使用原生网络，请检查服务地址、证书或网络）" : "（浏览器还可能受 CORS 限制；本地服务请确认桥接已启动）");
}
async function connectionFor(server: McpServer, headers: Headers, signal: AbortSignal): Promise<McpConnection> {
  const transport = server.transport === "sse" ? "sse" : "http";
  if (server.transport === "stdio" && !server.url) throw new Error("请先在 Termux 运行桥接脚本，并配置桥接地址");
  const key = JSON.stringify([server.url, transport, [...headers]]);
  const cached = sessions.get(server.id);
  if (cached && !cached.connection.closed && cached.key === key && Date.now() - cached.at < SESSION_TTL_MS) return cached.connection;
  closeMcpSession(server.id);
  const connection = new McpConnection(server.url.trim(), transport, headers);
  try { await connection.initialize(signal); } catch (error) { connection.close(); throw error; }
  sessions.set(server.id, { connection, key, at: Date.now() });
  return connection;
}

/** Same initialization, session and transport for testing and real AI calls. */
export async function probeServer(server: McpServer): Promise<McpProbe> {
  if (!server.url.trim()) return { ok: false, tools: [], message: server.transport === "stdio" ? "请先配置 Termux 桥接地址" : "还没填地址。" };
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
  let oauthPatch: Partial<McpOAuth> | undefined;
  try {
    const prepared = await headersFor(server); oauthPatch = prepared.oauthPatch;
    const connection = await connectionFor(server, prepared.headers, controller.signal);
    const tools: McpTool[] = []; let cursor: string | undefined; const seen = new Set<string>();
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error("MCP 工具清单分页过多");
      const message = await connection.send("tools/list", cursor ? { cursor } : {}, controller.signal);
      if (message.error) throw new Error(message.error.message || "拿不到工具清单");
      const result = message.result as { tools?: unknown; nextCursor?: unknown } | undefined;
      tools.push(...normalizeTools(result?.tools));
      if (tools.length > 10000) throw new Error("MCP 工具数量超过上限");
      if (result?.nextCursor == null) break;
      if (typeof result.nextCursor !== "string" || !result.nextCursor || seen.has(result.nextCursor)) throw new Error("MCP 返回了无效或重复的分页游标");
      cursor = result.nextCursor; seen.add(cursor);
    }
    return { ok: true, tools, oauthPatch, serverName: connection.serverInfo?.name, serverVersion: connection.serverInfo?.version,
      protocolVersion: connection.protocolVersion, message: `握手成功 · ${connection.serverInfo?.name || server.name} · 拿到 ${tools.length} 个工具` };
  } catch (error) {
    closeMcpSession(server.id);
    let needsAuth = false;
    if (error instanceof McpHttpError && error.status === 401 && server.transport !== "stdio") {
      try { await discover(server, null); needsAuth = true; } catch { /* Manual header authentication remains available. */ }
    }
    return { ok: false, tools: [], oauthPatch, needsAuth, message: failure(error) + (needsAuth ? "\n可以回列表点「去授权」。" : "") };
  } finally { clearTimeout(timer); }
}

export function normalizeTools(input: unknown): McpTool[] {
  if (!Array.isArray(input)) return [];
  const out: McpTool[] = [];
  for (const raw of input) {
    if (typeof raw === "string") {
      if (raw) out.push({ name: raw });
      continue;
    }
    const o = (raw ?? {}) as { name?: unknown; description?: unknown; inputSchema?: unknown };
    if (typeof o.name !== "string" || !o.name) continue;
    const tool: McpTool = { name: o.name };
    if (typeof o.description === "string") tool.description = o.description;
    if (o.inputSchema !== undefined) tool.inputSchema = o.inputSchema;
    out.push(tool);
  }
  return out;
}


export async function callTool(server: McpServer, tool: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
  if (!server.url.trim()) return { ok: false, text: "还没填地址。" };
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 90000);
  let oauthPatch: Partial<McpOAuth> | undefined;
  try {
    const prepared = await headersFor(server); oauthPatch = prepared.oauthPatch;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const connection = await connectionFor(server, prepared.headers, controller.signal);
        const message = await connection.send("tools/call", { name: tool, arguments: args }, controller.signal);
        if (message.error) return { ok: false, text: message.error.message || "MCP 工具返回错误", oauthPatch };
        return { ...callResultText(message.result), oauthPatch };
      } catch (error) {
        closeMcpSession(server.id);
        // Retry only expired sessions; a business error must never execute twice.
        if (attempt === 0 && error instanceof McpHttpError && [400, 404].includes(error.status)) continue;
        throw error;
      }
    }
    return { ok: false, text: "会话重连后仍未成功", oauthPatch };
  } catch (error) { return { ok: false, text: failure(error), oauthPatch }; }
  finally { clearTimeout(timer); }
}
function callResultText(result: unknown): { ok: boolean; text: string } {
  const r = (result ?? {}) as { content?: unknown; isError?: unknown; structuredContent?: unknown };

  const parts: string[] = [];
  if (Array.isArray(r.content)) {
    for (const block of r.content) {
      const b = block as { type?: string; text?: string };
      if (b?.type === "text" && typeof b.text === "string") parts.push(b.text);
      else if (b?.type) parts.push(`（对方返回了一个 ${b.type} 类型的块，这里显示不了）`);
    }
  }
  // 有些服务端只在 structuredContent 里放结构化结果
  if (!parts.length && r.structuredContent !== undefined) {
    parts.push(JSON.stringify(r.structuredContent, null, 1));
  }
  if (!parts.length) parts.push("（工具跑完了，但没有返回任何内容）");

  let text = parts.join("\n").trim();
  if (text.length > MAX_TOOL_TEXT) text = `${text.slice(0, MAX_TOOL_TEXT)}\n…（结果太长，截断了）`;

  return { ok: r.isError !== true, text };
}
