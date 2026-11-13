import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { McpConnection, readMcpEvents } from "../src/lib/mcp-connection.ts";
import { streamedNativeFetch } from "../src/lib/mcp-fetch.ts";
import { readSkillZip } from "../src/lib/skill-zip.ts";
import { packagesFromSkillFiles, readSkillResource, skillMetadata } from "../src/lib/skills.ts";
import { importMcpConfig, termuxConfig } from "../src/lib/mcp-config.ts";
import { pluginWebUrl } from "../src/lib/plugin-open.ts";
import { startMcpBridge } from "../public/bridges/qidao-mcp-bridge.mjs";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@capacitor/core") return { shortCircuit: true, url: "data:text/javascript,export const Capacitor = {isNativePlatform:()=>false};" };
  if (specifier.startsWith("@/")) return { shortCircuit: true, url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href };
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const signal = () => AbortSignal.timeout(2000);
const event = (message) => `data: ${JSON.stringify(message)}\n\n`;
async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }

test("Streamable HTTP JSON preserves session, negotiation, paging and structured results", async () => {
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw); seen.push({ message, headers: req.headers });
    if (message.id == null) { res.writeHead(202).end(); return; }
    let result;
    if (message.method === "initialize") result = { protocolVersion: "2025-06-18", serverInfo: { name: "fixture" } };
    else if (message.method === "tools/list") result = { tools: [{ name: message.params.cursor ? "second" : "first" }], ...(!message.params.cursor ? { nextCursor: "page2" } : {}) };
    else result = { structuredContent: { value: "真正执行了" } };
    res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "session-1" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  const url = await listen(server);
  const { probeServer, callTool, closeMcpSession } = await import("../src/lib/mcp.ts");
  const config = { id: "json-test", name: "fixture", url, transport: "http", headersText: "Authorization: Bearer fixture" };
  try {
    const probe = await probeServer(config); assert.equal(probe.ok, true, probe.message);
    assert.deepEqual(probe.tools.map((t) => t.name), ["first", "second"]);
    const call = await callTool(config, "first", { a: 1 }); assert.equal(call.ok, true); assert.match(call.text, /真正执行了/);
    assert.equal(seen[0].headers["mcp-protocol-version"], undefined);
    assert.equal(seen[1].headers["mcp-session-id"], "session-1");
    assert.equal(seen[2].headers["mcp-protocol-version"], "2025-06-18");
    assert.equal(seen.filter((r) => r.message.method === "initialize").length, 1);
  } finally { closeMcpSession(config.id); await close(server); }
});

test("POST SSE returns on the matching event without waiting for stream closure", async () => {
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk; const message = JSON.parse(raw);
    if (message.id == null) { res.writeHead(202).end(); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": heartbeat\n\n");
    res.write(event({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { protocolVersion: "2025-06-18" } : { content: [{ type: "text", text: "中文内容" }] } }));
  });
  const url = await listen(server), connection = new McpConnection(url, "http", new Headers());
  try { await connection.initialize(signal()); const reply = await connection.send("tools/call", {}, signal()); assert.equal(reply.result.content[0].text, "中文内容"); }
  finally { connection.close(); await close(server); }
});

test("legacy SSE gets the endpoint first and routes asynchronous POST responses", async () => {
  let events; const server = createServer(async (req, res) => {
    if (req.method === "GET") { res.writeHead(200, { "content-type": "text/event-stream" }); events = res; res.write("event: endpoint\ndata: /messages\n\n"); return; }
    assert.equal(req.url, "/messages"); let raw = ""; for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw); res.writeHead(202).end();
    if (message.id != null) events.write(event({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { protocolVersion: "2024-11-05" } : { tools: [{ name: "echo" }] } }));
  });
  const url = await listen(server), connection = new McpConnection(url, "sse", new Headers());
  try { await connection.initialize(signal()); const result = await connection.send("tools/list", {}, signal()); assert.equal(result.result.tools[0].name, "echo"); }
  finally { connection.close(); events?.end(); await close(server); }
});

test("Streamable HTTP 202 retrieves asynchronous results from its GET stream", async () => {
  let queued;
  const server = createServer(async (req, res) => {
    if (req.method === "GET") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(event(queued)); return; }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    if (message.id == null) { res.writeHead(202).end(); return; }
    if (message.method === "initialize") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: message.id, result: { protocolVersion: "2025-06-18" } })); return; }
    queued = { id: message.id, result: { tools: [{ name: "async" }] } }; res.writeHead(202).end();
  });
  const url = await listen(server), connection = new McpConnection(url, "http", new Headers());
  try { await connection.initialize(signal()); assert.equal((await connection.send("tools/list", {}, signal())).result.tools[0].name, "async"); }
  finally { connection.close(); await close(server); }
});

test("SSE parser handles split UTF-8, CRLF and multiple data lines", async () => {
  const bytes = new TextEncoder().encode(': comment\r\nevent: message\r\ndata: {"中文":\r\ndata: "好"}\r\n\r\n');
  const received = [];
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  await readMcpEvents(new Response(stream), (type, data) => { received.push([type, JSON.parse(data)]); });
  assert.deepEqual(received, [["message", { 中文: "好" }]]);
});

test("native streamed fetch exposes headers immediately and aborts the native request", async () => {
  let listener, started, cancelled = false, removed = false;
  const native = { addListener: async (_name, callback) => { listener = callback; return { remove: async () => { removed = true; } }; },
    start: async (options) => { started = options; listener({ id: options.id, type: "headers", status: 200, headers: { "Mcp-Session-Id": "native" } }); },
    cancel: async () => { cancelled = true; } };
  const ac = new AbortController(); const response = await streamedNativeFetch(native, "https://example.com/mcp", { signal: ac.signal });
  assert.equal(response.headers.get("mcp-session-id"), "native");
  const reader = response.body.getReader();
  listener({ id: started.id, type: "chunk", data: Buffer.from("中文").toString("base64") });
  assert.equal(new TextDecoder().decode((await reader.read()).value), "中文");
  ac.abort(); await assert.rejects(reader.read(), { name: "AbortError" });
  assert.ok(cancelled && removed);
});

const zip = "UEsDBBQAAAAIAJcbbV3YJAcqQgAAAD8AAAANAAAAZGVtby9TS0lMTC5tZNPV1eXKS8xNtVJISc3N50pJLU4uyiwoyczPs1J4trX7xfqpL9ZveTajj0sXqPBpa8eL9buf9k97sbXl2bSZjxuaAFBLAwQUAAAACACXG21dVZQkQBAAAAAOAAAAEwAAAGRlbW8vc2NyaXB0cy9ydW4ucHkrKMrMK9FQykjNyclX0gQAUEsDBBQAAAAIAJcbbV32FGIbBQAAAAMAAAAVAAAAZGVtby9hc3NldHMvcGl4ZWwuYmluY/jPCABQSwECFAMUAAAACACXG21d2CQHKkIAAAA/AAAADQAAAAAAAAAAAAAAgAEAAAAAZGVtby9TS0lMTC5tZFBLAQIUAxQAAAAIAJcbbV1VlCRAEAAAAA4AAAATAAAAAAAAAAAAAACAAW0AAABkZW1vL3NjcmlwdHMvcnVuLnB5UEsBAhQDFAAAAAgAlxttXfYUYhsFAAAAAwAAABUAAAAAAAAAAAAAAIABrgAAAGRlbW8vYXNzZXRzL3BpeGVsLmJpblBLBQYAAAAAAwADAL8AAADmAAAAAAA=";
test("Skill ZIP preserves scripts/binary assets; reads only enabled package-relative files", async () => {
  const bytes = Buffer.from(zip, "base64"); const files = await readSkillZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  const [skill] = packagesFromSkillFiles(files, "fixture.zip");
  assert.equal(skill.name, "demo"); assert.equal(skill.files.length, 3);
  assert.equal(skill.files.find((f) => f.path.endsWith(".bin")).encoding, "base64");
  assert.equal(readSkillResource([skill], { name: "demo" }).ok, true);
  assert.equal(readSkillResource([skill], { name: "demo", path: "../other" }).ok, false);
  assert.equal(readSkillResource([{ ...skill, enabled: false }], { name: "demo" }).ok, false);
  assert.equal(skillMetadata("---\nname: test\ndescription: >-\n  第一行\n  第二行\n---", "").description, "第一行 第二行");
});
test("Skill import rejects traversal, corrupt archives and duplicate paths", async () => {
  const data = Buffer.from("UEsDBBQAAAAIAJcbbV1uA8/yCAAAAAYAAAALAAAALi4vU0tJTEwubWQrzStOTEsFAFBLAQIUAxQAAAAIAJcbbV1uA8/yCAAAAAYAAAALAAAAAAAAAAAAAACAAQAAAAAuLi9TS0lMTC5tZFBLBQYAAAAAAQABADkAAAAxAAAAAAA=", "base64");
  await assert.rejects(readSkillZip(data.buffer.slice(data.byteOffset, data.byteOffset + data.length)), /路径/);
  await assert.rejects(readSkillZip(new ArrayBuffer(10)), /ZIP/);
  assert.throws(() => packagesFromSkillFiles([{ path: "SKILL.md", encoding: "utf8", data: "a" }, { path: "SKILL.md", encoding: "utf8", data: "b" }], "test"), /重复/);
});

test("community configs preserve remote SSE and local commands/env/cwd without executing", () => {
  const config = importMcpConfig(JSON.stringify({ mcpServers: { remote: { type: "sse", url: "https://example.com/sse", headers: { Authorization: "Bearer key" } }, local: { command: "npx", args: ["-y", "example"], env: { API_KEY: "secret" }, cwd: "/data/data/com.termux/files/home" } } }), undefined, "bridge-token");
  assert.equal(config[0].transport, "sse"); assert.equal(config[1].transport, "stdio");
  assert.equal(config[1].env.API_KEY, "secret"); assert.match(config[1].url, /^http:\/\/127.0.0.1:8767\/mcp\/local$/);
  const exported = termuxConfig(config); assert.equal(exported.mcpServers.local.command, "npx"); assert.equal(exported.qidaoBridge.tokens.local, "bridge-token");
  assert.throws(() => importMcpConfig('{"mcpServers":{"bad":{"url":"file:///tmp/a"}}}'), /地址/);
  assert.throws(() => pluginWebUrl("javascript:alert(1)"));
});

test("Termux bridge starts a real stdio process, authenticates and returns actual tool output", async () => {
  const program = `let b='';process.stdin.on('data',c=>{b+=c;let p;while((p=b.indexOf('\\n'))>=0){const m=JSON.parse(b.slice(0,p));b=b.slice(p+1);if(m.id!=null)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocolVersion:'2025-06-18'}:{content:[{type:'text',text:'stdio:'+m.params.name+':'+process.env.FIXTURE_VALUE}]}}));}});`;
  const server = startMcpBridge({ mcpServers: { fixture: { command: process.execPath, args: ["-e", program], env: { FIXTURE_VALUE: "actual-env" } } }, qidaoBridge: { tokens: { fixture: "secret" } } }, { port: 0 });
  await once(server, "listening"); const url = `http://127.0.0.1:${server.address().port}/mcp/fixture`;
  const connection = new McpConnection(url, "http", new Headers({ authorization: "Bearer secret" }));
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    await connection.initialize(signal());
    const result = await connection.send("tools/call", { name: "echo", arguments: {} }, signal());
    assert.equal(result.result.content[0].text, "stdio:echo:actual-env");
  } finally {
    await fetch(url, { method: "DELETE", headers: { authorization: "Bearer secret", "mcp-session-id": connection.sessionId } });
    connection.close(); await close(server);
  }
});
