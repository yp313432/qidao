/**
 * 外部工具的命名与路由契约（`src/lib/external-tools.ts`）。
 *
 * 为什么这些要写成测试（而不是"跑起来看看"）：
 *
 * 1. **工具名是模型看得见的接口**。P0 之后 MCP 服务器 / 自配接口的每个工具，
 *    都会以 `mcp_<服务器>_<工具>` / `http_<工具>` 的名字发给模型。名字规则一旦漂移，
 *    模型在历史对话里学到的旧名字就全失效 —— 表现为"配了工具但他说没这个工具"，
 *    而且只在老会话里复现，极难查。
 * 2. **OpenAI 兼容上游对函数名有硬限制**（只认小写字母/数字/下划线，有长度上限）。
 *    中文服务器名、带空格或斜杠的工具名、超长的名字，必须在这里被抹平 ——
 *    否则整轮请求 400，用户看到的是"发不出去"。
 * 3. 参数 schema 的兜底同理：MCP 服务端可能给 `null` / 缺 `properties`，
 *    原样发出去上游会拒；兜底成"什么都收"才能让模型正常调用。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  externalToolName,
  normalizeToolSchema,
  matchExternalTool,
  externalToolNames,
  resetExternalTools,
  buildExternalToolDefs,
  MAX_TOOLS_PER_REQUEST,
} from "./external-tools.ts";

describe("externalToolName", () => {
  it("MCP 工具 = mcp_服务器_工具，全部小写、非字母数字压成下划线", () => {
    assert.equal(
      externalToolName("mcp", "Weather Bot", "get/current time"),
      "mcp_weather_bot_get_current_time",
    );
  });

  it("HTTP 工具 = http_工具（没有服务器这一层）", () => {
    assert.equal(externalToolName("http", "", "My API"), "http_my_api");
    // 服务器名对 http 这种没有意义，传了也不该混进名字
    assert.equal(externalToolName("http", "别管我", "My API"), "http_my_api");
  });

  it("中文/符号名字也能落成合法函数名（不能留着让上游 400）", () => {
    const name = externalToolName("mcp", "天气服务", "查今天");
    assert.match(name, /^[a-z0-9_]+$/);
    assert.ok(name.length > 0);
  });

  it("名字全被抹掉时不会出空串（兜底成 x）", () => {
    assert.equal(externalToolName("mcp", "___", "///"), "mcp_x_x");
  });

  it("总长不超过 60（OpenAI 的函数名长度上限）", () => {
    const long = "a".repeat(80);
    assert.ok(externalToolName("mcp", long, long).length <= 60);
    assert.ok(externalToolName("http", "", long).length <= 60);
  });

  it("缺字段/undefined 也不能崩（配置是用户手填的，可能只有一半）", () => {
    assert.match(externalToolName("mcp", undefined as unknown as string, "x"), /^[a-z0-9_]+$/);
    assert.match(externalToolName("http", "", undefined as unknown as string), /^[a-z0-9_]+$/);
  });

  it("同一次构建里撞名会补 _2 / _3，不会互相覆盖", () => {
    const used = new Set<string>();
    const a = externalToolName("http", "", "same", used);
    const b = externalToolName("http", "", "same", used);
    const c = externalToolName("http", "", "same", used);
    assert.deepEqual([a, b, c], ["http_same", "http_same_2", "http_same_3"]);
  });
});

describe("normalizeToolSchema", () => {
  it("已经是合法的 object schema 就原样返回（连 enum 都不许动）", () => {
    const schema = {
      type: "object",
      properties: { city: { type: "string", enum: ["北京", "上海"] } },
      required: ["city"],
    };
    assert.equal(normalizeToolSchema(schema), schema);
  });

  it("不是 object schema 就兜底成'什么都收'", () => {
    const fallback = { type: "object", properties: {}, additionalProperties: true };
    assert.deepEqual(normalizeToolSchema(undefined), fallback);
    assert.deepEqual(normalizeToolSchema(null), fallback);
    assert.deepEqual(normalizeToolSchema("nope"), fallback);
    assert.deepEqual(normalizeToolSchema({ type: "array" }), fallback);
    assert.deepEqual(normalizeToolSchema({ type: "object" }), fallback);
  });
});

describe("registry 路由", () => {
  it("灌进去的名字能被 matchExternalTool 认出来，别的名字认不出来", () => {
    resetExternalTools([
      { kind: "mcp", name: "mcp_srv_weather", server: "天气", tool: "get_weather" },
      { kind: "http", name: "http_my_api", tool: "my-api" },
    ]);
    assert.deepEqual(matchExternalTool("mcp_srv_weather"), {
      kind: "mcp",
      name: "mcp_srv_weather",
      server: "天气",
      tool: "get_weather",
    });
    assert.equal(matchExternalTool("http_my_api")?.kind, "http");
    assert.equal(matchExternalTool("memory_add"), undefined);
    assert.deepEqual(externalToolNames().sort(), ["http_my_api", "mcp_srv_weather"]);
    resetExternalTools();
    assert.deepEqual(externalToolNames(), []);
  });
});

describe("buildExternalToolDefs（预算与截断）", () => {
  const server = (name: string, n: number, desc = "查天气") => ({
    enabled: true,
    name,
    tools: Array.from({ length: n }, (_, i) => ({
      name: `tool_${i}`,
      description: desc,
      inputSchema: { type: "object", properties: { city: { type: "string" } } },
    })),
  });

  it("默认预算 = MAX_TOOLS_PER_REQUEST（120），不是无限发", () => {
    const { tools, skipped } = buildExternalToolDefs([server("big", 200)], []);
    assert.equal(tools.length, MAX_TOOLS_PER_REQUEST);
    assert.equal(skipped, 80);
  });

  it("按调用方给的余量截断（内置动作多时外部要让位）", () => {
    const { tools, skipped } = buildExternalToolDefs(
      [server("a", 10)],
      [{ enabled: true, name: "x", method: "GET" }],
      4,
    );
    assert.equal(tools.length, 4);
    // 10 个 MCP + 1 个 HTTP = 11，只发 4
    assert.equal(skipped, 7);
  });

  it("余量为 0 时一个都不发，但要把丢了多少数出来", () => {
    const { tools, skipped } = buildExternalToolDefs(
      [server("a", 3)],
      [{ enabled: true, name: "x", method: "GET" }],
      0,
    );
    assert.deepEqual(tools, []);
    assert.equal(skipped, 4);
  });

  it("停用的服务器/接口一个都不算（也不计入 skipped）", () => {
    const off = { ...server("off", 5), enabled: false };
    const { tools, skipped } = buildExternalToolDefs(
      [off],
      [{ enabled: false, name: "y", method: "GET" }],
    );
    assert.deepEqual(tools, []);
    assert.equal(skipped, 0);
  });

  it("描述超长会被截到 240 字（每轮都重发，长描述就是长期税）", () => {
    const long = "很长的说明".repeat(200);
    const { tools } = buildExternalToolDefs([server("a", 1, long)], []);
    const desc = tools[0]!.function.description;
    assert.ok(desc.length < 400, `描述太长了：${desc.length}`);
    assert.ok(desc.endsWith("很长的说明很长的说明"), "截断不该把结尾切一半");
  });

  it("名字表与工具一一对应（执行侧靠它对上号）", () => {
    const { tools, entries } = buildExternalToolDefs(
      [server("a", 2)],
      [{ enabled: true, name: "api", method: "POST" }],
      3,
    );
    assert.deepEqual(tools.map((t) => t.function.name).sort(), [...entries.keys()].sort());
    assert.equal(entries.get("http_api")?.kind, "http");
  });
});
