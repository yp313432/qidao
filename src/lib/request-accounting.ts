import { estimateTokens, shortHash } from "./tokens.ts";

export type ReportedUsage = { prompt?: number; completion?: number; cached?: number; total?: number };
type Message = {
  role: string;
  content: unknown;
  reasoning_content?: string;
  tool_calls?: unknown;
  tool_call_id?: string;
};
export type InputEstimate = {
  system: number;
  tools: number;
  history: number;
  dynamic: number;
  summary: number;
  toolResults: number;
  reasoning: number;
  images: number;
  protocol: number;
  total: number;
  imageCount: number;
  messageCount: number;
  toolCount: number;
  /** 实际序列化的 messages + tools 字节数，不是模型 tokenizer 的 token 数。 */
  payloadBytes: number;
  inputHash: string;
  toolsHash: string;
  sections: { id: string; title: string; tokens: number; chars: number }[];
};

/** 统计实际发送的 messages/tools；不保存正文、密钥或图片数据。所有 token 均为本地估算。 */
export function measureRequest(
  messages: readonly Message[],
  tools: readonly unknown[] | null | undefined,
  options: { perception?: string; sections?: readonly { id: string; title: string; text: string }[] } = {},
): InputEstimate {
  const result: InputEstimate = {
    system: 0, tools: tools?.length ? estimateTokens(JSON.stringify(tools)) : 0,
    history: 0, dynamic: 0, summary: 0, toolResults: 0, reasoning: 0,
    images: 0, protocol: 0, total: 0, imageCount: 0,
    messageCount: messages.length, toolCount: tools?.length ?? 0,
    payloadBytes: 0, inputHash: "", toolsHash: shortHash(JSON.stringify(tools ?? [])), sections: [],
  };
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") { lastUser = i; break; }
  }
  const skeleton = messages.map((message, index) => {
    const text = typeof message.content === "string" ? message.content
      : Array.isArray(message.content) ? message.content.map((part) => part?.type === "text" ? String(part.text ?? "") : "").join("") : "";
    let body = text;
    if (index === lastUser && options.perception && body.endsWith(options.perception)) {
      result.dynamic += estimateTokens(options.perception);
      body = body.slice(0, -options.perception.length);
    }
    if (index === 0 && message.role === "system") result.system += estimateTokens(body);
    else if (message.role === "system") result.summary += estimateTokens(body);
    else if (message.role === "tool") result.toolResults += estimateTokens(body);
    else result.history += estimateTokens(body);
    result.reasoning += estimateTokens(message.reasoning_content ?? "");
    const content = Array.isArray(message.content) ? message.content.map((part) => {
      if (part?.type === "image_url") {
        result.imageCount++;
        // 图片的真实 token 由模型、尺寸和 detail 决定；不把 base64 字符当文本收费。
        result.images += 260;
        return { type: "image_url", image_url: { url: "" } };
      }
      return { type: part?.type ?? "text", text: "" };
    }) : "";
    return { ...message, content, ...(message.reasoning_content ? { reasoning_content: "" } : {}) };
  });
  result.protocol = estimateTokens(JSON.stringify(skeleton));
  result.total = result.system + result.tools + result.history + result.dynamic + result.summary
    + result.toolResults + result.reasoning + result.images + result.protocol;
  const serialized = JSON.stringify({ messages, ...(tools?.length ? { tools } : {}) });
  result.payloadBytes = new TextEncoder().encode(serialized).length;
  result.inputHash = shortHash(serialized);
  const main = messages[0]?.role === "system" && typeof messages[0].content === "string" ? messages[0].content : "";
  if (options.sections && options.sections.map((section) => section.text).join("\n\n") === main) {
    let prefix = "";
    let previous = 0;
    result.sections = options.sections.map((section, i) => {
      prefix += (i ? "\n\n" : "") + section.text;
      const tokens = estimateTokens(prefix);
      const row = { id: section.id, title: section.title, tokens: tokens - previous, chars: section.text.length };
      previous = tokens;
      return row;
    });
  }
  return result;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 不把缺失字段补成 0；兼容 OpenAI、DeepSeek 和常见中转 usage 字段。 */
export function normalizeUsage(raw: unknown): ReportedUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as Record<string, unknown>;
  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const inputDetails = usage.input_tokens_details as Record<string, unknown> | undefined;
  const cached = count(usage.prompt_cache_hit_tokens) ?? count(promptDetails?.cached_tokens)
    ?? count(inputDetails?.cached_tokens) ?? count(usage.cached_tokens) ?? count(usage.cache_read_input_tokens);
  let prompt = count(usage.prompt_tokens);
  if (prompt === undefined && count(usage.input_tokens) !== undefined) {
    prompt = count(usage.input_tokens)!;
    // Anthropic 原生 input_tokens 不含 cache read/create；OpenAI 的 prompt_tokens 已包含缓存。
    if ("cache_read_input_tokens" in usage || "cache_creation_input_tokens" in usage) {
      prompt += count(usage.cache_read_input_tokens) ?? 0;
      prompt += count(usage.cache_creation_input_tokens) ?? 0;
    }
  }
  const completion = count(usage.completion_tokens) ?? count(usage.output_tokens);
  const total = count(usage.total_tokens) ?? (prompt !== undefined && completion !== undefined ? prompt + completion : undefined);
  return prompt !== undefined || completion !== undefined || cached !== undefined || total !== undefined
    ? { prompt, completion, cached, total } : undefined;
}

export function cacheHitRate(usage: ReportedUsage): number | undefined {
  return usage.prompt !== undefined && usage.prompt > 0 && usage.cached !== undefined
    ? Math.min(100, Math.max(0, usage.cached / usage.prompt * 100)) : undefined;
}

export function mergeReportedUsage(previous: ReportedUsage | undefined, next: ReportedUsage | undefined): ReportedUsage | undefined {
  if (!next) return previous;
  const merged = { ...previous };
  for (const key of ["prompt", "completion", "cached", "total"] as const) {
    if (next[key] !== undefined) merged[key] = next[key];
  }
  return merged;
}

/** 仅在上游明确拒绝 usage 选项时重发；鉴权、限流等错误不能当兼容问题。 */
export function usageOptionsUnsupported(status: number, detail: string): boolean {
  return [400, 422].includes(status) && /stream_options|include_usage/i.test(detail)
    && /unknown|unsupported|not supported|unrecognized|extra.*not permitted|不支持|未知|无法识别/i.test(detail);
}

/** 缓存比例只用同时返回输入和缓存数字的请求计算，缺失不能算未命中。 */
export function summarizeUsage(entries: readonly (ReportedUsage & { promptHash?: string; toolsHash?: string; inputEstimate?: InputEstimate; model?: string; upstream?: string; purpose?: string })[]) {
  let prompt = 0, completion = 0, cached = 0, cacheInput = 0;
  let known = 0, outputKnown = 0, cacheKnown = 0, local = 0, measured = 0, prefixChanges = 0, toolChanges = 0;
  const previous = new Map<string, typeof entries[number]>();
  for (const entry of entries) {
    if (entry.prompt !== undefined) { prompt += entry.prompt; known++; }
    if (entry.completion !== undefined) { completion += entry.completion; outputKnown++; }
    if (entry.prompt !== undefined && entry.prompt > 0 && entry.cached !== undefined) {
      cached += entry.cached; cacheInput += entry.prompt; cacheKnown++;
    }
    if (entry.inputEstimate) { local += entry.inputEstimate.total; measured++; }
    const key = `${entry.upstream ?? ""}|${entry.model ?? ""}|${entry.purpose === "summary" ? "summary" : "chat"}`;
    const older = previous.get(key);
    if (entry.promptHash && older?.promptHash && entry.promptHash !== older.promptHash) prefixChanges++;
    const hash = entry.inputEstimate?.toolsHash ?? entry.toolsHash;
    const olderHash = older?.inputEstimate?.toolsHash ?? older?.toolsHash;
    if (hash && olderHash && hash !== olderHash) toolChanges++;
    previous.set(key, entry);
  }
  return { count: entries.length, prompt, completion, cached, cacheInput, known, outputKnown, cacheKnown,
    local, measured, prefixChanges, toolChanges,
    hitRate: cacheInput > 0 ? Math.min(100, Math.max(0, cached / cacheInput * 100)) : undefined };
}
