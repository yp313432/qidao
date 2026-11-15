// Run the real action switch. Device services and MCP transport are boundaries, not the discovery implementation.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = globalThis.__qidaoDiscoveryActionFixture = { calls: [], state: {} };
const imports = new Map();
const code = readFileSync(resolve(root, "src/lib/actions.ts"), "utf8");
for (const match of code.matchAll(/^import\s+(?!type\s)\{([^}]+)\}\s+from\s+["']([^"']+)["']/gm)) {
  imports.set(match[2], match[1].split(",").map((name) => name.trim()).filter((name) => name && !name.startsWith("type ")).map((name) => name.split(/\s+as\s+/)[0]));
}
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@/lib/store") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent("export const useApp={getState:()=>globalThis.__qidaoDiscoveryActionFixture.state};") };
  if (context.parentURL?.endsWith("/actions.ts") && imports.has(specifier) && !["@/lib/prompt", "@/lib/tool-discovery"].includes(specifier)) {
    const source = specifier === "@/lib/mcp"
      ? "export const callTool=async(server,tool,args)=>{globalThis.__qidaoDiscoveryActionFixture.calls.push({server:server.name,tool,args});return{ok:true,text:'真实传输边界结果'};};"
      : imports.get(specifier).map((name) => `export const ${name}=()=>{};`).join("\n");
    return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(source) };
  }
  if (/native-http(?:\.ts)?$/.test(specifier)) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent("export const isNativeHttpPlatform=()=>false;export const getNativeHttp=async()=>null;") };
  if (specifier.startsWith("@/") || specifier.startsWith(".")) {
    const base = specifier.startsWith("@/") ? resolve(root, "src", specifier.slice(2)) : resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    const path = [base, base + ".ts", base + ".tsx"].find(existsSync);
    if (path) return { shortCircuit: true, url: pathToFileURL(path).href };
  }
  return next(specifier, context);
} });
const { runAction } = await import("../src/lib/actions.ts");
const ctx = { navigate() { throw Error("discovery must not navigate"); } };
const schema = { type: "object", properties: { query: { type: "string" } }, required: ["query"] };
function setup() {
  fixture.calls = [];
  const mcp = [{ id: "one", name: "GitHub", enabled: true, tools: [{ name: "search", description: "查仓库", inputSchema: schema }] }];
  fixture.state = { mcp, httpTools: [], skills: [], settings: { permissions: {} }, enabledTools: () => mcp.filter((server) => server.enabled) };
}
test("local action returns the real catalog and original schema without executing a network tool", async () => {
  setup();
  const result = JSON.parse(await runAction({ kind: "tool.search", query: "GitHub" }, ctx));
  assert.equal(result.tools[0].call.server, "GitHub"); assert.deepEqual(result.tools[0].parameters, schema);
  assert.equal(fixture.calls.length, 0);
  await runAction({ ...result.tools[0].call, args: { query: "qidao" } }, ctx);
  assert.deepEqual(fixture.calls, [{ server: "GitHub", tool: "search", args: { query: "qidao" } }]);
});
test("denied capabilities disappear from discovery; a removed named server never routes to another server", async () => {
  setup(); fixture.state.settings.permissions.mcp_tools = "deny";
  assert.equal(JSON.parse(await runAction({ kind: "tool.search", query: "GitHub" }, ctx)).matches, 0);
  fixture.state.settings.permissions = {};
  fixture.state.mcp[0].enabled = false;
  fixture.state.mcp.push({ id: "two", name: "Other", enabled: true, tools: [{ name: "search", inputSchema: schema }] });
  const result = await runAction({ kind: "tool.call", server: "GitHub", tool: "search", args: {} }, ctx);
  assert.match(result, /没找到/); assert.equal(fixture.calls.length, 0);
});
