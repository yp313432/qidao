import type { McpServer } from "./types";

export type ImportedMcp = Omit<McpServer, "id" | "tools" | "status">;
export function importMcpConfig(raw: string, bridgeUrl = "http://127.0.0.1:8767", bridgeToken = crypto.randomUUID()): ImportedMcp[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("MCP 配置不是有效 JSON"); }
  const servers = (value as { mcpServers?: unknown })?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw new Error("配置需要包含 mcpServers 对象");
  const entries = Object.entries(servers);
  if (!entries.length || entries.length > 100) throw new Error("一次请导入 1 到 100 个 MCP 服务");
  const parsed = entries.map(([name, rawServer]): ImportedMcp => {
    if (!name.trim() || ["@skills", "__qidao_terminal"].includes(name)) throw new Error("MCP 名称不能为空，也不能使用保留名称 @skills");
    if (!rawServer || typeof rawServer !== "object" || Array.isArray(rawServer)) throw new Error(`${name} 的配置必须是对象`);
    const server = rawServer as Record<string, unknown>;
    const headers = server.headers ?? {};
    if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.entries(headers).some(([key, v]) => /[\r\n:]/.test(key) || typeof v !== "string" || /[\r\n]/.test(v))) throw new Error(`${name} 的请求头必须是字符串键值对`);
    const base = { name, description: typeof server.description === "string" ? server.description : "社区 MCP", enabled: server.disabled !== true, kind: "mcp" as const };
    if (typeof server.command === "string" && server.command.trim()) {
      if (server.type && server.type !== "stdio") throw new Error(`${name} 的 command 与传输方式冲突`);
      if (server.args != null && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== "string"))) throw new Error(`${name} 的 args 必须是字符串数组`);
      const env = server.env ?? {};
      if (!env || typeof env !== "object" || Array.isArray(env) || Object.values(env).some((v) => typeof v !== "string")) throw new Error(`${name} 的 env 必须是字符串键值对`);
      if (server.cwd != null && typeof server.cwd !== "string") throw new Error(`${name} 的 cwd 必须是字符串`);
      const url = new URL(bridgeUrl);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^https?:$/.test(url.protocol)) throw new Error("Termux 桥接地址必须是手机本机地址");
      if (!bridgeToken.trim() || /[\r\n]/.test(bridgeToken)) throw new Error("请设置有效的 Termux 桥接令牌");
      return { ...base, transport: "stdio", url: `${url.origin}/mcp/${encodeURIComponent(name)}`, command: server.command.trim(), args: JSON.stringify(server.args ?? []),
        env: env as Record<string, string>, cwd: server.cwd as string | undefined, bridgeToken, headersText: `Authorization: Bearer ${bridgeToken}` };
    }
    if (typeof server.url !== "string") throw new Error(`${name} 缺少 url 或 command`);
    const url = new URL(server.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error(`${name} 地址必须使用 http 或 https`);
    const type = server.type ?? server.transport ?? "streamable_http";
    if (!["http", "streamable-http", "streamable_http", "sse"].includes(String(type))) throw new Error(`${name} 的传输方式不受支持`);
    return { ...base, transport: type === "sse" ? "sse" : "http", url: url.href, command: "", args: "",
      headersText: Object.entries(headers).map(([key, val]) => `${key}: ${val}`).join("\n") };
  });
  return parsed;
}

export function termuxTerminal(bridgeUrl = "http://127.0.0.1:8767", bridgeToken = crypto.randomUUID()): ImportedMcp {
  const url = new URL(bridgeUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^https?:$/.test(url.protocol)) throw new Error("Termux 桥接地址必须是手机本机地址");
  return { name: "Termux 终端", description: "Termux 终端：检查环境、执行命令、读取输出及停止任务。首次启动桥接后可由 AI 排查和安装 MCP 依赖；沿用工具操作权限。", transport: "http", url: `${url.origin}/mcp/__qidao_terminal`, bridgeRole: "terminal", bridgeToken,
    command: "", args: "", headersText: `Authorization: Bearer ${bridgeToken}`, enabled: true, kind: "mcp" };
}

/** Export stdio processes and an explicit terminal opt-in to the user-started bridge. */
export function termuxConfig(servers: readonly McpServer[]) {
  const local = servers.filter((s) => s.transport === "stdio");
  const terminal = servers.find((s) => s.bridgeRole === "terminal" && s.enabled);
  return { mcpServers: Object.fromEntries(local.map((server) => [server.name, {
    command: server.command, args: JSON.parse(server.args || "[]"), env: server.env ?? {}, ...(server.cwd ? { cwd: server.cwd } : {}), disabled: !server.enabled,
  }])), qidaoBridge: { ...(terminal ? { terminalEnabled: true } : {}), tokens: Object.fromEntries([...local, ...(terminal ? [terminal] : [])].map((server) => [server.bridgeRole === "terminal" ? "__qidao_terminal" : server.name, server.bridgeToken ?? ""])) } };
}
