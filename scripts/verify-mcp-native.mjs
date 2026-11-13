import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mcpFetch, streamedNativeFetch } from "../src/lib/mcp-fetch.ts";
import { routedToolArgs } from "../src/lib/tool-wire.ts";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@/lib/utils") return { shortCircuit: true, url: "data:text/javascript,export const uid = () => 'fixture';" };
  if (specifier.startsWith("@/")) return { shortCircuit: true, url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href };
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const originalCap = globalThis.Capacitor;
afterEach(() => { globalThis.Capacitor = originalCap; });
const bounded = (promise) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("operation hung")), 150); })]).finally(() => clearTimeout(timer));
};
function complete(listener, id, status = 200) {
  listener({ id, type: "headers", status, headers: { "mcp-session-id": "native-session" } });
  listener({ id, type: "chunk", data: btoa('{"native":true}') });
  listener({ id, type: "end" });
}

test("injected native callback bridge sends requests without importing/resolving a plugin proxy", async () => {
  let listener, removed = 0; const methods = [];
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    addListener(plugin, event, callback) { assert.equal(plugin, "QidaoMcpNetwork"); assert.equal(event, "response"); listener = callback; return { remove: async () => { removed++; } }; },
    nativePromise: async (plugin, method, options) => { methods.push(method); assert.equal(plugin, "QidaoMcpNetwork"); if (method === "start") { assert.equal(options.headers.authorization, "Bearer fixture"); complete(listener, options.id); } },
  };
  const response = await bounded(mcpFetch("http://127.0.0.1:8767/mcp/test", { method: "POST", headers: { Authorization: "Bearer fixture" }, body: "{}" }));
  assert.deepEqual(await response.json(), { native: true }); assert.equal(response.headers.get("mcp-session-id"), "native-session");
  assert.deepEqual(methods, ["start"]); assert.equal(removed, 1);
});

test("an injected Capacitor Proxy is never awaited as a thenable", async () => {
  let listener, thenAccesses = 0;
  const plugin = new Proxy({
    addListener: async (_event, callback) => { listener = callback; return { remove: async () => {} }; },
    start: async (options) => complete(listener, options.id), cancel: async () => {},
  }, { get(target, key) { if (key === "then") { thenAccesses++; return () => {}; } return target[key]; } });
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { QidaoMcpNetwork: plugin } };
  assert.deepEqual(await (await bounded(mcpFetch("http://127.0.0.1/mcp"))).json(), { native: true });
  assert.equal(thenAccesses, 0, "Promise assimilation of the Capacitor Proxy would hang before start");
});

test("cancellation works during listener registration and removes a late listener", async () => {
  let resolveListener, starts = 0, cancels = 0, removed = 0;
  const native = { addListener: () => new Promise((resolve) => { resolveListener = resolve; }), start: async () => { starts++; }, cancel: async () => { cancels++; } };
  const ac = new AbortController(); const response = streamedNativeFetch(native, "http://127.0.0.1/mcp", { signal: ac.signal });
  ac.abort(); await assert.rejects(bounded(response), { name: "AbortError" });
  resolveListener({ remove: async () => { removed++; } }); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(starts, 0); assert.equal(removed, 1); assert.equal(cancels, 1);
});

test("invalid or absent status events reject instead of leaving the response pending", async () => {
  for (const event of [{ type: "headers", status: 0 }, { type: "end" }]) {
    let listener;
    const native = { addListener: async (_name, callback) => { listener = callback; return { remove: async () => {} }; }, start: async ({ id }) => listener({ id, ...event }), cancel: async () => {} };
    await assert.rejects(bounded(streamedNativeFetch(native, "http://127.0.0.1/mcp")), /status|MCP_NATIVE_INVALID_RESPONSE/);
  }
});

test("unknown native channels fail promptly with an actionable error", async () => {
  globalThis.Capacitor = { isNativePlatform: () => true };
  await assert.rejects(bounded(mcpFetch("http://127.0.0.1/mcp")), /MCP_NATIVE_UNAVAILABLE/);
});

test("tool.call preserves valid top-level fields and unwraps only unambiguous envelopes", async () => {
  const payload = { server: "Termux 终端", tool: "execute", args: { command: "echo hi", arguments: { keep: true } } };
  const { runOneAction } = await import("../src/lib/tool-loop.ts");
  const { actionTitle } = await import("../src/lib/action-meta.ts");
  for (const input of [payload, { arguments: payload }, { parameters: payload }, { args: payload }]) {
    assert.deepEqual(routedToolArgs("tool.call", input), payload);
    const logs = [], seen = [];
    const queue = { getState: () => ({ actionLog: logs, requestAction(action) { seen.push(action); logs.push({ title: actionTitle(action), result: "allowed", message: "真实执行结果", at: Date.now() }); } }) };
    const result = await runOneAction({ index: 0, id: "call", name: "tool_call", args: JSON.stringify(input) }, undefined, queue);
    assert.equal(result.ok, true); assert.deepEqual(seen[0], { ...payload, kind: "tool.call" });
  }
  assert.deepEqual(routedToolArgs("memory.add", { args: payload }), { args: payload });
  assert.deepEqual(routedToolArgs("tool.call", { tool: "keep", arguments: payload }), { tool: "keep", arguments: payload });
  const queue = { getState: () => ({ actionLog: [], requestAction() { throw new Error("invalid arguments must not reach execution"); } }) };
  const missing = await runOneAction({ index: 0, name: "tool_call", args: JSON.stringify({ unrelated: "value" }) }, undefined, queue);
  assert.equal(missing.category, "badargs"); assert.match(missing.result, /unrelated/); assert.match(missing.result, /server、tool 应直接/);
});
