import test from "node:test";
import assert from "node:assert/strict";
import { externalToolCatalog, searchExternalTools, visibleExternalSources, externalDiscoveryPrompt, DISCOVERY_RESULT_MAX_CHARS } from "./tool-discovery.ts";
import { measureRequest } from "./request-accounting.ts";
import { actionToolsFor } from "./action-schema.ts";

const schema = { type: "object", properties: { query: { type: "string", description: "仓库搜索词" } }, required: ["query"], additionalProperties: false };
const sources = [{ kind: "mcp" as const, name: "GitHub", tools: [
  { name: "search_repositories", description: "搜索 GitHub 仓库", inputSchema: schema },
  { name: "create_issue", description: "创建问题", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
] }, { kind: "http" as const, name: "天气", method: "GET", url: "https://example.com", description: "查询城市天气", params: ["city"] }];
const skills = [{ id: "letter", name: "写信", description: "写一封贴近当前心情的信", files: [{ path: "SKILL.md", data: "完整步骤不应常驻系统提示词", encoding: "utf8" as const }], enabled: true, source: "local", importedAt: 0 }];

test("闲聊只包含目录与固定入口，庞大外部 schema 不进入 messages/tools", () => {
  const largeSources = [{ ...sources[0]!, tools: Array.from({ length: 40 }, (_, i) => ({ name: `tool_${i}`, description: "外部工具", inputSchema: { ...schema, description: "完整工具参数不要常驻".repeat(500) } })) }];
  const directory = externalDiscoveryPrompt(largeSources, skills, true);
  assert.match(directory, /GitHub（40 个工具）/); assert.match(directory, /tool_search/);
  assert.doesNotMatch(directory, /完整工具参数不要常驻|完整步骤不应常驻系统提示词|tool_0/);
  const compact = measureRequest([{ role: "system", content: directory }], actionToolsFor(["tool.search", "tool.call", "http.call"]));
  const eager = measureRequest([], largeSources[0]!.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })));
  assert.ok(compact.total < eager.total / 20);
});
test("检索返回匹配工具的完整约束和调用路由，结果可复用", () => {
  const catalog = externalToolCatalog(sources, skills);
  const first = JSON.parse(searchExternalTools(catalog, { query: "搜索 GitHub 仓库", limit: 1 }));
  const entry = first.tools[0];
  assert.equal(entry.name, "search_repositories"); assert.deepEqual(entry.parameters, schema);
  assert.deepEqual(entry.call, { kind: "tool.call", server: "GitHub", tool: "search_repositories" });
  assert.equal(JSON.parse(searchExternalTools(catalog, { query: entry.id })).tools[0].id, entry.id);
  const weather = JSON.parse(searchExternalTools(catalog, { query: "天气", limit: 1 })).tools[0];
  assert.equal(weather.call.kind, "http.call"); assert.deepEqual(Object.keys(weather.parameters.properties), ["city"]);
});
test("Skills 先返回读取入口，不把 SKILL.md 正文预装进上下文", () => {
  const entry = JSON.parse(searchExternalTools(externalToolCatalog(sources, skills), { query: "写信", limit: 1 })).tools[0];
  assert.deepEqual(entry.call, { kind: "tool.call", server: "@skills", tool: "read", args: { name: "写信" } });
  assert.doesNotMatch(JSON.stringify(entry), /完整步骤不应常驻/);
});
test("禁用或拒绝的能力不在目录中，检索本身不联网、不执行", () => {
  const visible = visibleExternalSources(sources, [{ ...skills[0]!, enabled: false }], { mcp_tools: "deny" });
  assert.equal(visible.tools.length, 1); assert.equal(visible.skills.length, 0);
  const catalog = externalToolCatalog(visible.tools, visible.skills);
  assert.equal(JSON.parse(searchExternalTools(catalog, { query: "GitHub" })).matches, 0);
  assert.equal(JSON.parse(searchExternalTools(catalog, { query: "不存在" })).tools.length, 0);
  assert.equal(JSON.parse(searchExternalTools(catalog, { query: " " })).ok, false);
});
test("超大参数说明按 JSON Pointer 翻页，保留所有节点且不截断 JSON", () => {
  const properties = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field_${i}`, { type: "string", description: "很长的参数解释".repeat(80) }]));
  const catalog = externalToolCatalog([{ kind: "mcp", name: "large", tools: [{ name: "huge", inputSchema: { type: "object", properties, required: ["field_99"] } }] }]);
  const initial = JSON.parse(searchExternalTools(catalog, { query: "huge" })).tools[0];
  assert.ok(initial.children.some((child: { key: string }) => child.key === "properties"));
  const names: string[] = []; let offset = 0;
  do {
    const raw = searchExternalTools(catalog, { query: initial.id, schemaPath: "/properties", offset });
    assert.ok(raw.length <= DISCOVERY_RESULT_MAX_CHARS);
    const page = JSON.parse(raw).tools[0]; names.push(...page.children.map((child: { key: string }) => child.key)); offset = page.nextOffset;
  } while (offset !== undefined);
  assert.equal(new Set(names).size, 100); assert.ok(names.includes("field_99"));
  const leaf = JSON.parse(searchExternalTools(catalog, { query: initial.id, schemaPath: "/properties/field_99" })).tools[0];
  assert.deepEqual(leaf.parameters, properties.field_99);
  assert.equal(JSON.parse(searchExternalTools(catalog, { query: initial.id, schemaPath: "/__proto__" })).ok, false);
});
test("检索结果排序稳定，不随会话时间或未命中的工具参数变化", () => {
  const catalog = externalToolCatalog(sources, skills);
  assert.equal(searchExternalTools(catalog, { query: "GitHub" }), searchExternalTools([...catalog].reverse(), { query: "GitHub" }));
  assert.match(externalDiscoveryPrompt(sources, skills, false), /"kind":"tool.search"/);
});
