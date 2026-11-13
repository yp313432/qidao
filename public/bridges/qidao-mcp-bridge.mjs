#!/usr/bin/env node
/** Run explicitly in Termux. No network-supplied commands, only this config file. */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function startMcpBridge(config, { port = 8767, host = "127.0.0.1" } = {}) {
  if (!["127.0.0.1", "::1"].includes(host)) throw new Error("Bridge only binds to loopback");
  const sessions = new Map();
  const stop = (id) => {
    const session = sessions.get(id); if (!session) return;
    sessions.delete(id);
    try { if (process.platform !== "win32" && session.process.pid) process.kill(-session.process.pid, "SIGTERM"); else session.process.kill("SIGTERM"); }
    catch { session.process.kill("SIGTERM"); }
    for (const pending of session.pending.values()) pending.reject(new Error("MCP process closed"));
    session.pending.clear();
  };
  const launch = (name) => {
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
    child.on("error", () => stop(id)); child.on("exit", () => stop(id));
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
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 1_000_000) throw new Error("Request too large"); }
      const message = JSON.parse(raw);
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
      res.end("MCP could not start or return a result. Check Node/Python, dependencies, command and cwd in Termux.");
    }
  });
  const timer = setInterval(() => { for (const [id, session] of sessions) if (Date.now() - session.at > 600000) stop(id); }, 60000); timer.unref();
  server.on("close", () => { clearInterval(timer); for (const id of sessions.keys()) stop(id); });
  server.listen(port, host);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const file = process.argv[2]; if (!file) throw new Error("Usage: node qidao-mcp-bridge.mjs qidao-mcp.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    const server = startMcpBridge(config);
    server.on("listening", () => console.log("栖岛 MCP 桥接已启动：http://127.0.0.1:8767；保持 Termux 运行，回栖岛点测试连接。"));
    process.on("SIGINT", () => server.close()); process.on("SIGTERM", () => server.close());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
