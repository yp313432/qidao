import test from "node:test";
import assert from "node:assert/strict";
import { measureRequest, normalizeUsage, cacheHitRate, mergeReportedUsage, summarizeUsage, usageOptionsUnsupported } from "./request-accounting.ts";
import { buildManual, manualSections } from "./manual.ts";
import { defaultPermissions, permissionSnapshot, PERMISSIONS } from "./permissions.ts";

test("工具分项覆盖内置、发现入口、MCP、HTTP 与 Skills，合计等于真实工具数组估算", () => {
  const tools = [
    { function: { name: "emotion_report", description: "情绪" } },
    { function: { name: "tool_search", description: "本地查找" } },
    { function: { name: "mcp_github_search", description: "【MCP · GitHub】搜索" } },
    { function: { name: "mcp_skills_read", description: "【MCP · @skills】读取" } },
    { function: { name: "http_weather", description: "天气" } },
  ];
  const result = measureRequest([], tools);
  assert.equal(result.toolGroups!.reduce((sum, group) => sum + group.tokens, 0), result.tools);
  assert.deepEqual(new Set(result.toolGroups!.map((group) => group.id)), new Set(["builtin", "gateways", "mcp:GitHub", "skills", "http"]));
});

test("按真实消息拆分系统、动态、历史思考和工具结果，分类之和等于总量", () => {
  const sections = [{ id: "a", title: "规则", text: "固定规则" }, { id: "b", title: "地图", text: "页面地图" }];
  const system = sections.map((section) => section.text).join("\n\n");
  const messages = [
    { role: "system", content: system }, { role: "system", content: "旧对话摘要" },
    { role: "user", content: "我的问题\n当前状态" },
    { role: "assistant", content: "去查一下", reasoning_content: "历史推理内容", tool_calls: [{ id: "c", type: "function", function: { name: "sense_time", arguments: "{}" } }] },
    { role: "tool", content: "查询成功", tool_call_id: "c" },
  ];
  const tools = [{ type: "function", function: { name: "sense_time", parameters: { type: "object" } } }];
  const result = measureRequest(messages, tools, { sections, perception: "\n当前状态" });
  for (const key of ["system", "tools", "history", "dynamic", "summary", "toolResults", "reasoning", "protocol"] as const) assert.ok(result[key] > 0, key);
  assert.equal(result.total, result.system + result.tools + result.history + result.dynamic + result.summary + result.toolResults + result.reasoning + result.images + result.protocol);
  assert.equal(result.sections.reduce((sum, section) => sum + section.tokens, 0), result.system);
  assert.equal(result.payloadBytes, new TextEncoder().encode(JSON.stringify({ messages, tools })).length);
  assert.equal(result.toolCount, 1);
});

test("图片大小影响实际字节数，不把 base64 当文本 token", () => {
  const image = (size: number) => measureRequest([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(size) } }] }], []);
  const small = image(100), large = image(100_000);
  assert.equal(small.total, large.total);
  assert.equal(large.images, 260);
  assert.equal(large.imageCount, 1);
  assert.ok(large.payloadBytes > small.payloadBytes);
});

test("工具变化会改变工具指纹，动态变化不会改变系统分项", () => {
  const messages = [{ role: "system", content: "固定" }, { role: "user", content: "问题" }];
  const first = measureRequest(messages, [{ name: "first" }]);
  const second = measureRequest(messages, [{ name: "second" }]);
  assert.notEqual(first.toolsHash, second.toolsHash);
  assert.equal(first.system, second.system);
  assert.notEqual(first.inputHash, second.inputHash);
});

test("OpenAI 和 DeepSeek 的缓存字段归一化且不重复加进输入", () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 10000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 8000 } }), { prompt: 10000, completion: 200, cached: 8000, total: 10200 });
  assert.equal(cacheHitRate(normalizeUsage({ prompt_tokens: 10000, prompt_cache_hit_tokens: 8000 })!), 80);
  assert.equal(normalizeUsage({ prompt_tokens: 10, cached_tokens: 0 })?.cached, 0);
});

test("Anthropic 口径将 cache read/create 与 input_tokens 合并", () => {
  const usage = normalizeUsage({ input_tokens: 100, cache_read_input_tokens: 800, cache_creation_input_tokens: 100, output_tokens: 20 });
  assert.deepEqual(usage, { prompt: 1000, cached: 800, completion: 20, total: 1020 });
});

test("缺失缓存与零命中不同；不接受负数和非数字", () => {
  assert.equal(cacheHitRate({ prompt: 100 }), undefined);
  assert.equal(cacheHitRate({ prompt: 100, cached: 0 }), 0);
  assert.equal(cacheHitRate({ prompt: 0, cached: 0 }), undefined);
  assert.equal(normalizeUsage({ prompt_tokens: -1, cached_tokens: "10" }), undefined);
});

test("缓存合计只使用同时返回输入与缓存量的请求", () => {
  const stats = summarizeUsage([{ prompt: 10000, cached: 8000, completion: 200 }, { prompt: 20000, completion: 100 }, { completion: 10 }]);
  assert.equal(stats.prompt, 30000);
  assert.equal(stats.completion, 310);
  assert.equal(stats.hitRate, 80);
  assert.equal(stats.known, 2);
  assert.equal(stats.cacheKnown, 1);
});

test("跨上游/模型不误报系统变化，工具变化单独统计", () => {
  const estimate = (name: string) => measureRequest([{ role: "system", content: "规则" }], [{ name }]);
  const stats = summarizeUsage([
    { model: "a", upstream: "one", promptHash: "same", inputEstimate: estimate("new") },
    { model: "b", upstream: "two", promptHash: "other", inputEstimate: estimate("new") },
    { model: "a", upstream: "one", promptHash: "same", inputEstimate: estimate("old") },
  ]);
  assert.equal(stats.prefixChanges, 0);
  assert.equal(stats.toolChanges, 1);
});

test("usage 分帧返回时保留先前已返回的字段", () => {
  assert.deepEqual(mergeReportedUsage({ prompt: 100, cached: 80 }, { completion: 20, cached: undefined }), { prompt: 100, cached: 80, completion: 20 });
});

test("usage 选项只在明确不兼容时回退，鉴权/限流不重试", () => {
  assert.equal(usageOptionsUnsupported(400, "unknown parameter stream_options"), true);
  assert.equal(usageOptionsUnsupported(401, "unsupported stream_options"), false);
  assert.equal(usageOptionsUnsupported(429, "unsupported include_usage"), false);
  assert.equal(usageOptionsUnsupported(400, "invalid API key"), false);
});

const base = { displayName: "yan", aiName: "小克", userGender: "女" as const, titles: PERMISSIONS.map(({ id, title }) => ({ id, title })) };
test("固定正文不会随实时权限改变，保留用户确认的背景和页面地图", () => {
  const first = buildManual({ ...base, nativeTools: true, permissions: defaultPermissions() });
  const second = buildManual({ ...base, nativeTools: true, permissions: { navigate: "deny" } });
  assert.equal(first, second);
  assert.match(first, /你是小克/);
  assert.match(first, /这并不是 Roleplay/);
  assert.match(first, /思考链和回答都必须使用中文/);
  assert.match(first, /世界书 \/worldbook/);
  assert.doesNotMatch(first, /纯前端，没有这种通道|其余 .*项没设|亲手设的/);
});

test("原生模式去重参数示例，兼容模式保留情绪与感知调用说明", () => {
  const native = buildManual({ ...base, nativeTools: true });
  const compat = buildManual({ ...base, nativeTools: false });
  assert.doesNotMatch(native, /"primaryEmotion"|fresh 默认|days 默认/);
  assert.match(compat, /"primaryEmotion"/);
  assert.match(compat, /fresh 默认/);
  assert.match(compat, /days 默认/);
  assert.equal(manualSections({ ...base }).map((section) => section.text).join("\n\n"), compat);
});

test("权限快照区分默认许可、需确认、拒绝和永久禁止", () => {
  const snapshot = permissionSnapshot({ navigate: "deny", reset_all: "allow" });
  const lines = snapshot.split("\n");
  assert.ok(lines.find((line) => line.startsWith("拒绝："))!.includes("切换页面"));
  assert.ok(lines.find((line) => line.startsWith("需确认："))!.includes("重置设置"));
  assert.ok(lines.find((line) => line.startsWith("允许："))!.includes("当前设置"));
  assert.doesNotMatch(snapshot, /没设|亲手/);
});
