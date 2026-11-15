// Exercise real prompt assembly; only the unused native HTTP bridge is substituted.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
registerHooks({ resolve(specifier, context, next) {
  if (/native-http(?:\.ts)?$/.test(specifier)) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent("export const isNativeHttpPlatform=()=>false;export const getNativeHttp=async()=>null;") };
  if (specifier.startsWith("@/") || specifier.startsWith(".")) {
    const base = specifier.startsWith("@/") ? resolve(root, "src", specifier.slice(2)) : resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    const path = [base, base + ".ts", base + ".tsx"].find(existsSync);
    if (path) return { shortCircuit: true, url: pathToFileURL(path).href };
  }
  return next(specifier, context);
} });
const { assembleMessages, systemPrompt, systemPromptSections } = await import("../src/lib/prompt.ts");
const { measureRequest } = await import("../src/lib/request-accounting.ts");
const { actionToolsFor } = await import("../src/lib/action-schema.ts");
const schema = { type: "object", properties: { query: { type: "string", description: "仅在检索后提供的参数说明".repeat(1000) } }, required: ["query"] };
const req = { model: "sonnet", name: "yan", style: "default", discoverExternal: true, nativeTools: true,
  tools: [{ kind: "mcp", name: "GitHub", tools: [{ name: "search_repositories", description: "查仓库", inputSchema: schema }] }],
  skills: [{ id: "s", name: "写信", description: "写一封信", enabled: true, files: [{ path: "SKILL.md", data: "隐藏的完整技能正文", encoding: "utf8" }], source: "local", importedAt: 0 }], permissions: {} };
test("both prompt protocols include discovery instructions without full schemas or skill bodies", () => {
  for (const nativeTools of [true, false]) {
    const request = { ...req, nativeTools };
    const messages = assembleMessages(request, [{ role: "user", content: "吃过饭了" }]);
    assert.match(messages[0].content, /【外部能力目录】/);
    assert.match(messages[0].content, nativeTools ? /tool_search/ : /"kind":"tool.search"/);
    assert.doesNotMatch(messages[0].content, /仅在检索后提供的参数说明|隐藏的完整技能正文|search_repositories/);
    const measurement = measureRequest(messages, nativeTools ? actionToolsFor(["tool.search", "tool.call"]) : null, { sections: systemPromptSections(request) });
    assert.equal(measurement.sections.reduce((sum, section) => sum + section.tokens, 0), measurement.system);
  }
});
test("unrelated schema changes and clock updates preserve the fixed system prefix", () => {
  assert.equal(systemPrompt(req), systemPrompt({ ...req, context: { now: "以后" }, tools: [{ ...req.tools[0], tools: [{ ...req.tools[0].tools[0], inputSchema: { type: "object", properties: { anything: { type: "number" } } } }] }] }));
  const denied = systemPrompt({ ...req, permissions: { mcp_tools: "deny" } });
  assert.doesNotMatch(denied, /GitHub|Skills：写信/);
});
