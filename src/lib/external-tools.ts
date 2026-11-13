/**
 * 外部工具（MCP 服务器 + 用户自配的 HTTP 接口）→ **原生 `tools` 定义**。
 *
 * 为什么要有这个文件（用户 m05030：先做 agent 的 P0）：
 *   在这之前，外部工具只有一条路 —— `prompt.ts` 的 `toolCatalog()` 把它们
 *   **写成一段文字**贴进系统提示词（每个工具压成一行参数说明），模型照着那段文字
 *   自己拼一个 `tool.call` 动作。问题有三个：
 *     1. 参数靠"读说明"理解，比结构化 JSON Schema 差一截，一次调对的概率低；
 *     2. 那段清单每轮都要重发一遍，工具一多就白烧 token（还是进不了前缀缓存之外）；
 *     3. 不能并行 —— 文本协议里模型只能一条条写。
 *   所以这里把 `tools/list` 拿到的 `inputSchema` **原样**翻成原生 tools，
 *   模型走的就是跟 95 个内置动作完全一样的通道。
 *
 * 命名规则：`mcp_<服务器>_<工具>` / `http_<工具>`。
 *   · 为什么加前缀：内置动作名（`memory_add`）和外部工具名必须分得开，
 *     执行时靠前缀就能路由回 `tool.call` / `http.call`；
 *   · 为什么带服务器名：两台服务器可能有同名工具（都有 `search`），
 *     不区分的话模型分不清该调哪个；
 *   · 会被压成 `[a-z0-9_]`、截断到 60 字符以内（OpenAI 对函数名有长度与字符限制），
 *     重名时补 `_2` / `_3`。
 *
 * ⚠️ 这里**不在模块顶层 import store**：`tool-loop.ts` 要在纯 node 里被验收脚本跑，
 * 它的依赖链不能拽进 zustand/DOM。所以取 store 用动态 import，只在真要构建时发生。
 */

import type { ActionTool } from "@/lib/action-schema";
import { SKILL_READ_TOOL } from "./skills.ts";

/** 一条外部工具在"名字 → 怎么执行"上的档案 */
export type ExternalToolEntry =
  | {
      kind: "mcp";
      /** 发给模型的名字 */
      name: string;
      /** 服务器名（`tool.call` 认的是名字，不是 id） */
      server: string;
      /** 服务器上原来的工具名 */
      tool: string;
    }
  | {
      kind: "http";
      name: string;
      /** HTTP 工具名（`http.call` 按名字找） */
      tool: string;
    };

/**
 * 发出去的定义 —— 比 `ActionTool` 宽：MCP 服务器的 `inputSchema` 是任意 JSON Schema，
 * 不是我们那张"string/number/boolean/array/object"的窄表，硬塞会丢字段。
 */
export type ExternalActionTool = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

/** 上一轮构建出来的名字表（`matchExternalTool()` 靠它路由） */
let registry = new Map<string, ExternalToolEntry>();

function slug(raw: string | undefined | null, max = 24): string {
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const cut = s.slice(0, max).replace(/_+$/g, "");
  return cut || "x";
}

/** 名字撞了就补序号（同一次构建内保证唯一） */
function unique(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let i = 2; i < 100; i += 1) {
    const name = `${base}_${i}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${base}_${Date.now() % 1000}`;
  used.add(fallback);
  return fallback;
}

/**
 * 外部工具在 `tools` 里的名字（导出是为了单测 —— 命名一旦改，历史对话里
 * 模型记住的旧名字就全失效了，所以这条规则要有测试盯着）。
 *
 * `mcp_<服务器>_<工具>` / `http_<工具>`，只留 `[a-z0-9_]`，总长 ≤ 60
 * （OpenAI 对函数名的长度与字符有硬限制，超了整轮 400）。
 */
export function externalToolName(
  kind: "mcp" | "http",
  server: string,
  tool: string,
  used: Set<string> = new Set<string>(),
): string {
  const base =
    kind === "mcp" ? `mcp_${slug(server, 16)}_${slug(tool, 24)}` : `http_${slug(tool, 32)}`;
  return unique(base.slice(0, 60).replace(/_+$/g, ""), used);
}

/** 服务端没给合用的 schema 时兜底成"什么都收"（导出给单测用） */
export function normalizeToolSchema(raw: unknown): unknown {
  const s = raw as { type?: unknown; properties?: unknown } | null | undefined;
  if (!s || typeof s !== "object" || s.type !== "object" || typeof s.properties !== "object") {
    return { type: "object", properties: {}, additionalProperties: true };
  }
  return raw;
}

function schemaOf(raw: unknown): unknown {
  return normalizeToolSchema(raw);
}

/**
 * 一次请求里最多带多少个工具（内置 + 外部一起算）。
 *
 * 为什么是 120（2026-11-07，用户 m05306"参考市面常规要求做限制"）：
 *   · OpenAI Chat Completions 的 function calling 文档写明**一次请求最多 128 个工具**；
 *   · Gemini 的 function declarations 也是 128 个上限；
 *   · Anthropic 没写死条数，但官方建议工具定义别占太多上下文（超了改"按需检索工具"）。
 * → 取 **120**，留 8 个余量给"以后加几个内置动作"和不同上游的实现差异。
 *
 * 超了会怎样：整轮 400，模型那边表现为"完全没回话"，用户看到的是突然变哑巴 ——
 * 这是最难查的一类故障，所以在发请求之前就自己截断，不留给它去报错。
 */
export const MAX_TOOLS_PER_REQUEST = 120;

/**
 * 一条工具描述最多多少字。
 *
 * MCP 服务端给的 description 可能是一整段 markdown（有的还带示例），
 * 每个工具几百字，几十个工具就是几千 token —— 每轮都重发。
 * 240 字够说清"这工具干什么、什么时候用"，再长就是文档不是工具说明了。
 */
const MAX_DESC_CHARS = 240;

/** 上一次构建时因为超预算被丢掉的外部工具条数（诊断用：`?perf=1` 或 probing 时可看） */
let lastSkipped = 0;

/** 上一次 `buildExternalTools()` 因为超预算丢掉了几个（0 = 全发了） */
export function externalToolsSkipped(): number {
  return lastSkipped;
}

/** store 里 MCP 服务器长这样（只取这里用得到的字段，方便单测造假数据） */
export type McpServerLike = {
  enabled?: boolean;
  name?: string;
  tools?: { name?: string; description?: string; inputSchema?: unknown }[];
};

/** store 里自配 HTTP 工具长这样 */
export type HttpToolLike = {
  enabled?: boolean;
  name?: string;
  method?: string;
  description?: string;
};

/**
 * **纯函数那半**：给两组配置，算出这一轮要发的工具定义 + 名字表 + 丢掉了几个。
 *
 * 为什么拆出来：`buildExternalTools()` 得去 store 里取配置（动态 import zustand），
 * 在 `node --test` 里跑不起来。而"预算怎么切、描述怎么截、名字怎么排"恰恰是
 * 最该被测试盯住的部分，所以把这层做成不碰 DOM 的纯函数，单测直接喂数组。
 */
export function buildExternalToolDefs(
  mcp: readonly McpServerLike[] | undefined,
  httpTools: readonly HttpToolLike[] | undefined,
  limit = MAX_TOOLS_PER_REQUEST,
): { tools: ExternalActionTool[]; entries: Map<string, ExternalToolEntry>; skipped: number } {
  const used = new Set<string>();
  const entries = new Map<string, ExternalToolEntry>();
  const tools: ExternalActionTool[] = [];
  const budget = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : MAX_TOOLS_PER_REQUEST;
  let skipped = 0;

  /** 预算满了没？（满了两类都要继续数 skipped：用户要知道"还有几个没发"） */
  const full = () => tools.length >= budget;

  for (const server of mcp ?? []) {
    if (!server.enabled) continue;
    for (const tool of server.tools ?? []) {
      const rawTool = String(tool.name ?? "").trim();
      if (!rawTool) continue;
      if (full()) {
        skipped += 1;
        continue;
      }
      const serverName = String(server.name ?? "");
      const name = unique(`mcp_${slug(server.name)}_${slug(rawTool)}`, used);
      entries.set(name, { kind: "mcp", name, server: serverName, tool: rawTool });
      const desc = String(tool.description ?? "")
        .trim()
        .slice(0, MAX_DESC_CHARS);
      tools.push({
        type: "function",
        function: {
          name,
          description: `【MCP · ${serverName}】${rawTool}${desc ? ` —— ${desc}` : ""}`,
          parameters: schemaOf(tool.inputSchema),
        },
      });
    }
  }

  for (const t of httpTools ?? []) {
    if (!t.enabled) continue;
    const rawName = String(t.name ?? "").trim();
    if (!rawName) continue;
    if (full()) {
      skipped += 1;
      continue;
    }
    const name = unique(`http_${slug(rawName)}`, used);
    entries.set(name, { kind: "http", name, tool: rawName });
    const desc = String(t.description ?? "")
      .trim()
      .slice(0, MAX_DESC_CHARS);
    tools.push({
      type: "function",
      function: {
        name,
        description: `【自配接口 · ${t.method} ${rawName}】${desc} —— 参数会替换请求里 ${"{{参数名}}"} 占位符`,
        parameters: { type: "object", properties: {}, additionalProperties: true },
      },
    });
  }

  return { tools, entries, skipped };
}

/**
 * 构建这一轮的外部工具定义，并把名字表存起来给执行侧用。
 *
 * 每轮都重建（服务器可能在两轮之间被启用/授权/删掉），开销可以忽略：
 * 只是几次字符串处理，不发网络请求 —— `tools/list` 的结果早就在 store 里了。
 *
 * @param limit 这次最多给多少个外部工具（调用方按"120 − 内置动作数"算）。
 *              传 0 或负数就是"一个都别给"（这轮内置动作已经把预算吃满）。
 */
export async function buildExternalTools(
  limit = MAX_TOOLS_PER_REQUEST,
): Promise<ExternalActionTool[]> {
  const { useApp } = await import("@/lib/store");
  const st = useApp.getState();
  const mcp = [...st.mcp];
  if (st.skills?.some((skill) => skill.enabled)) mcp.unshift({ id: "@skills", name: "@skills", enabled: true,
    description: "用户启用的 Skills", transport: "http", url: "", command: "", args: "", headersText: "", kind: "mcp", tools: [SKILL_READ_TOOL] });
  const { tools, entries, skipped } = buildExternalToolDefs(mcp, st.httpTools, limit);
  registry = entries;
  lastSkipped = skipped;
  return tools;
}

/** 这个名字是不是外部工具；是就返回它的档案（不是返回 undefined） */
export function matchExternalTool(name: string): ExternalToolEntry | undefined {
  return registry.get(name);
}

/**
 * 测试用：清掉名字表。
 *
 * 也可以**直接灌一版**（`resetExternalTools([{ name: "mcp_x_y", … }])`）——
 * 单测要验"路由到哪台服务器哪个工具"，又不能真的去 `buildExternalTools()`
 * （那要 zustand/DOM 的 store）。灌一行就能测，别为了测试把 store 拉进来。
 */
export function resetExternalTools(entries: ExternalToolEntry[] = []): void {
  registry = new Map(entries.map((e) => [e.name, e]));
}

/** 只给调试看的：当前认得的外部工具名 */
export function externalToolNames(): string[] {
  return [...registry.keys()];
}

export type { ActionTool };
