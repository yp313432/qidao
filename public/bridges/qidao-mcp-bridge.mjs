#!/usr/bin/env node
/** User-started loopback MCP bridge; terminal commands require explicit local opt-in and a bearer token. */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, statSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";

export const TERMINAL_NAME = "__qidao_terminal";
export const terminalTools = [
  { name: "environment", description: "检查 Termux 的系统、工作目录和 Node/Python/uv 等依赖版本。先检查环境再执行安装；不读取密钥环境变量。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "execute", description: "在用户授权的 Termux 中执行 shell 命令。返回 jobId 不代表成功，必须用 status 读取输出和退出码。安装或修改前说明目的；删除、覆盖及敏感操作须先取得用户明确同意，不绕过 App 权限。", inputSchema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string", description: "可选绝对工作目录，默认 Termux HOME" }, timeoutMs: { type: "number", description: "超时毫秒，默认120000，最多600000" } }, required: ["command"], additionalProperties: false } },
  { name: "status", description: "查询任务 stdout、stderr、exitCode 和状态。running 表示尚未完成；失败后根据真实输出处理，不能声称成功。输出保留末尾64KiB，truncated 表示有截断。", inputSchema: { type: "object", properties: { jobId: { type: "string" }, waitMs: { type: "number", description: "等待进度毫秒，默认1000，最多20000；长任务建议20000以减少轮询" } }, required: ["jobId"], additionalProperties: false } },
  { name: "cancel", description: "停止指定任务及其子进程，再用 status 确认结果。", inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"], additionalProperties: false } },
];

/** The terminal exists only when explicitly enabled in the exported local config. */
export function createTerminalRuntime({ cwd = homedir(), shell = process.env.SHELL || "sh" } = {}) {
  const jobs = new Map();
  let closed = false;
  const view = (job) => ({ jobId: job.id, state: job.state, exitCode: job.exitCode, signal: job.signal, category: job.category, cwd: job.cwd, truncated: job.truncated, stderr: job.stderr.toString("utf8"), stdout: job.stdout.toString("utf8") });
  const terminate = (job, reason) => {
    if (job.state !== "running") return;
    job.category = reason;
    const kill = (signal) => { try { if (process.platform !== "win32") process.kill(-job.child.pid, signal); else job.child.kill(signal); } catch { /* Already exited. */ } };
    kill("SIGTERM");
    job.killTimer = setTimeout(() => kill("SIGKILL"), 1000); job.killTimer.unref();
  };
  function execute(args) {
    if (closed) throw new Error("terminal_closed: Termux 运行时已关闭");
    if (typeof args.command !== "string" || !args.command.trim() || args.command.length > 16000) throw new Error("invalid_arguments: command 必须是1到16000字的命令");
    if (args.cwd != null && (typeof args.cwd !== "string" || !isAbsolute(args.cwd))) throw new Error("invalid_arguments: cwd 必须是绝对路径");
    if (args.timeoutMs != null && (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1 || args.timeoutMs > 600000)) throw new Error("invalid_arguments: timeoutMs 范围为1到600000");
    if ([...jobs.values()].filter((j) => j.state === "running").length >= 4) throw new Error("busy: 已有4个运行中的任务，请先等待或停止");
    while (jobs.size >= 32) { const done = [...jobs.values()].find((j) => j.state !== "running"); if (!done) break; jobs.delete(done.id); }
    const directory = args.cwd || cwd;
    try { if (!statSync(directory).isDirectory()) throw new Error("not a directory"); }
    catch { throw new Error("cwd_unavailable: 工作目录不存在或不可访问"); }
    const child = spawn(shell, ["-c", args.command], { cwd: directory, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const job = { id: randomUUID(), child, cwd: directory, state: "running", stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), truncated: false, exitCode: null, signal: null, category: undefined };
    jobs.set(job.id, job);
    const append = (key, chunk) => { const bytes = Buffer.concat([job[key], chunk]); job.truncated ||= bytes.length > 65536; job[key] = bytes.subarray(-65536); };
    child.stdout.on("data", (chunk) => append("stdout", chunk)); child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => { job.category = error.code === "ENOENT" ? "shell_missing" : error.code === "EACCES" ? "permission_denied" : "spawn_failed"; append("stderr", Buffer.from(error.message)); });
    child.on("close", (code, signal) => {
      clearTimeout(job.timer); clearTimeout(job.killTimer);
      job.exitCode = code; job.signal = signal;
      job.state = job.category === "cancelled" ? "cancelled" : job.category === "timeout" ? "timeout" : code === 0 && !job.category ? "succeeded" : "failed";
      if (!job.category && code !== 0) job.category = code === 127 ? "command_not_found" : code === 126 ? "permission_denied" : "command_exit";
    });
    job.timer = setTimeout(() => terminate(job, "timeout"), args.timeoutMs ?? 120000); job.timer.unref();
    return view(job);
  }
  return {
    async call(name, args = {}) {
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("invalid_arguments: 参数必须是对象");
      if (name === "environment") return execute({ command: 'printf "System: "; uname -srm; printf "Directory: "; pwd; for tool in node npm npx python python3 uv uvx git pkg; do if command -v "$tool" >/dev/null 2>&1; then printf "\\n%s: " "$tool"; "$tool" --version 2>&1 | head -n 1; else printf "\\n%s: missing\\n" "$tool"; fi; done' });
      if (name === "execute") return execute(args);
      const job = jobs.get(args.jobId);
      if (!job) throw new Error("job_not_found: 找不到该任务，桥接重启后旧任务不会保留");
      if (name === "cancel") terminate(job, "cancelled");
      else if (name !== "status") throw new Error("unknown_tool: 不支持的终端工具");
      if (name === "status") {
        const wait = args.waitMs ?? 1000;
        if (!Number.isFinite(wait) || wait < 0 || wait > 20000) throw new Error("invalid_arguments: waitMs 范围为0到20000");
        if (job.state === "running" && wait) await new Promise((resolve) => {
          const timer = setTimeout(done, wait);
          function done() { clearTimeout(timer); job.child.off("close", done); resolve(); }
          job.child.once("close", done);
        });
      }
      return view(job);
    },
    close() { closed = true; for (const job of jobs.values()) terminate(job, "cancelled"); },
  };
}

export function startMcpBridge(config, { port = 8767, host = "127.0.0.1" } = {}) {
  if (!["127.0.0.1", "::1"].includes(host)) throw new Error("Bridge only binds to loopback");
  const sessions = new Map();
  const terminalEnabled = config.qidaoBridge?.terminalEnabled === true;
  const stop = (id) => {
    const session = sessions.get(id); if (!session) return;
    sessions.delete(id);
    if (!session.process) { session.terminal.close(); return; }
    try { if (process.platform !== "win32" && session.process.pid) process.kill(-session.process.pid, "SIGTERM"); else session.process.kill("SIGTERM"); }
    catch { session.process.kill("SIGTERM"); }
    for (const pending of session.pending.values()) pending.reject(new Error("MCP process closed"));
    session.pending.clear();
  };
  const launch = (name) => {
    if (name === TERMINAL_NAME) {
      if (!terminalEnabled) throw new Error("terminal_disabled: 请在栖岛启用 Termux 控制并重新导出配置");
      const id = randomUUID(), session = { name, at: Date.now(), terminal: createTerminalRuntime() }; sessions.set(id, session); return [id, session];
    }
    const options = config.mcpServers?.[name];
    if (!options || options.disabled || typeof options.command !== "string" || !Array.isArray(options.args ?? [])) throw new Error("Service is disabled or configuration is invalid");
    const id = randomUUID();
    const child = spawn(options.command, options.args ?? [], { shell: false, detached: process.platform !== "win32", cwd: options.cwd || homedir(), env: { ...process.env, ...options.env }, stdio: ["pipe", "pipe", "pipe"] });
    const session = { name, process: child, pending: new Map(), at: Date.now() }; sessions.set(id, session);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (line.length > 2_000_000) { stop(id); return; }
      try {
        const message = JSON.parse(line);
        const pending = session.pending.get(message.id);
        if (pending) { session.pending.delete(message.id); pending.resolve(message); }
        else if (message.method && message.id != null) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client capability not supported" } }) + "\n");
      } catch { /* Non-protocol stdout is ignored, never forwarded as a tool result. */ }
    });
    // Drain stderr so a verbose server cannot block its pipes. It may contain secrets.
    child.stderr.on("data", () => {});
    child.on("error", (error) => { for (const pending of session.pending.values()) pending.reject(new Error(`${error.code || "spawn_failed"}: ${error.message}`)); stop(id); }); child.on("exit", (code) => { for (const pending of session.pending.values()) pending.reject(new Error(`process_exit: MCP 进程退出，exitCode=${code}；检查依赖及启动参数`)); stop(id); });
    child.stdin.on("error", () => stop(id));
    return [id, session];
  };
  const authorized = (name, header) => {
    const token = config.qidaoBridge?.tokens?.[name];
    if (typeof token !== "string" || !token) return false;
    const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(header || "");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  };
  const server = createServer(async (req, res) => {
    let name;
    try { name = decodeURIComponent(new URL(req.url, "http://localhost").pathname.replace(/^\/mcp\//, "")); }
    catch { res.writeHead(400).end(); return; }
    if (!req.url.startsWith("/mcp/") || !authorized(name, req.headers.authorization)) { res.writeHead(401).end("Bridge authentication required"); return; }
    // Native clients don't need browser CORS. Reject browser-origin requests to the local process host.
    if (req.headers.origin) { res.writeHead(403).end("Use the native app transport"); return; }
    if (req.method === "DELETE") {
      const id = req.headers["mcp-session-id"];
      if (sessions.get(id)?.name === name) stop(id);
      res.writeHead(204).end(); return;
    }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let sessionId;
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 1_000_000) throw new Error("Request too large"); chunks.push(chunk); }
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") throw new Error("Invalid JSON-RPC request");
      let session;
      if (message.method === "initialize") {
        if (sessions.size >= 16) throw new Error("Too many MCP sessions");
        [sessionId, session] = launch(name);
      } else {
        sessionId = req.headers["mcp-session-id"]; session = sessions.get(sessionId);
        if (!session || session.name !== name) { res.writeHead(404).end("MCP session expired"); return; }
      }
      session.at = Date.now();
      if (name === TERMINAL_NAME) {
        const headers = { "content-type": "application/json", "Mcp-Session-Id": sessionId };
        if (message.id == null) { res.writeHead(202, headers).end(); return; }
        let result;
        if (message.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "栖岛 Termux", version: "1.0.0" } };
        else if (message.method === "tools/list") result = { tools: terminalTools };
        else if (message.method === "ping") result = {};
        else if (message.method === "tools/call") {
          try {
            const output = await session.terminal.call(message.params?.name, message.params?.arguments);
            result = { content: [{ type: "text", text: JSON.stringify(output) }], isError: ["failed", "timeout", "cancelled"].includes(output.state) };
          } catch (error) { result = { content: [{ type: "text", text: error.message }], isError: true }; }
        } else { res.writeHead(200, headers).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } })); return; }
        res.writeHead(200, headers).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result })); return;
      }
      const result = message.id == null ? undefined : new Promise((resolve, reject) => { session.pending.set(message.id, { resolve, reject }); });
      // Attach handlers before writing to catch a synchronous process exit.
      void result?.catch(() => {});
      session.process.stdin.write(JSON.stringify(message) + "\n");
      if (!result) { res.writeHead(202, { "Mcp-Session-Id": sessionId }).end(); return; }
      let timer;
      try {
        const response = await Promise.race([result, new Promise((_, reject) => { timer = setTimeout(() => { stop(sessionId); reject(new Error("MCP response timeout")); }, 85000); })]);
        res.writeHead(200, { "content-type": "application/json", "Mcp-Session-Id": sessionId }).end(JSON.stringify(response));
      } finally { clearTimeout(timer); session.pending.delete(message.id); }
    } catch (error) {
      if (sessionId) stop(sessionId);
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(String(error.message || "unknown_bridge_error: MCP 桥接发生未知错误").replace(/Bearer\s+[^\s]+/gi, "Bearer [已隐藏]"));
    }
  });
  const timer = setInterval(() => { for (const [id, session] of sessions) if (Date.now() - session.at > 600000) stop(id); }, 60000); timer.unref();
  server.on("close", () => { clearInterval(timer); for (const id of sessions.keys()) stop(id); });
  server.listen(port, host);
  return server;
}

export function isCliEntry(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try { return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry); }
  catch { return false; }
}

if (isCliEntry(import.meta.url)) {
  try {
    const file = process.argv[2]; if (!file) throw new Error("Usage: node qidao-mcp-bridge.mjs qidao-mcp.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    const server = startMcpBridge(config);
    server.on("listening", () => console.log("栖岛 MCP 桥接已启动：http://127.0.0.1:8767；保持 Termux 运行，回栖岛点测试连接。"));
    process.on("SIGINT", () => server.close()); process.on("SIGTERM", () => server.close());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
