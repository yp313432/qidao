import { createFileRoute } from "@tanstack/react-router";
import type { ActionTool } from "@/lib/action-schema";
import { getModel, type ModelId, type ReasoningEffort } from "@/lib/models";
import { assembleMessages, systemPrompt, type PromptTool } from "@/lib/prompt";
import { estimateTokens, shortHash } from "@/lib/tokens";
import type { PermissionMode, ReplyStyle } from "@/lib/types";

type Body = {
  model: ModelId;
  messages: { role: "user" | "assistant" | "system"; content: string | unknown[] }[];
  style: ReplyStyle;
  tools: PromptTool[];
  /**
   * **原生 `tools`（function calling）**：61 个内部动作的定义。
   *
   * 客户端已经判过"这把上游支不支持"（P1 的探测结果缓存在设置里），
   * 服务端**只负责原样转发**，不自己决定要不要带 —— 判断逻辑只有客户端一处
   * （`lib/tool-calls` / `lib/tool-wire`），否则两边会走散。
   */
  actionTools?: ActionTool[];
  /** 这一轮的原生 tools 是**按需挑的**（P3）→ 系统提示词要带一条"筛掉 != 不存在"的兜底规则 */
  selectiveTools?: boolean;
  /**
   * **原生工具循环里已经拼好的 messages**（含系统提示词、assistant 的 tool_calls、
   * role:"tool" 的执行结果）。有它就直接用它当上游的 messages ——
   * 那些"上一轮调了什么、结果是什么"只有客户端知道。
   *
   * 不带它（普通一轮）就走下面 `assembleMessages(body, body.messages)` 那条老路。
   * 两条路用的是**同一份** `lib/prompt`，所以人设、感知层、权限那一节不会有两套。
   */
  assembledMessages?: { role: string; content: unknown }[];

  customBaseUrl?: string;
  customApiKey?: string;
  /**
   * 自定义上游要用的**真实模型名**。
   *
   * 内置那三档（快答/均衡/深思）只是我们自己的推理力度分层；
   * 换成别家（DeepSeek / 智谱 / 通义…）时，模型名得听对方的 ——
   * 早先这里写死过一个厂商名，于是上游回来一句「不支持的模型名」，
   * 看起来像密钥不对，其实是名字不对。
   */
  upstreamModel?: string;
  name: string;
  aiName?: string;
  /** 他的人设/自述 */
  persona?: string;
  /**
   * 世界书条目（客户端本地存的，所以由客户端算好传上来）。
   * always = 常驻（进系统提示词）；hit = 这轮命中关键词（挂最后一条用户消息尾部）。
   */
  worldAlways?: string[];
  worldHit?: string[];
  /** 他刚才动手的结果（回执）—— 由客户端算好传上来 */
  recentActions?: string[];
  /** 用户给它的授权（客户端本地存的，所以由客户端传上来）—— 用于生成说明书里的权限一节 */
  permissions?: Record<string, PermissionMode>;
  /** 最大输出长度（0/空 = 跟随档位）—— 见 chat-client 里的说明 */
  maxTokens?: number;
  /** 客户端上报的用户状态（感知层） */
  context?: {
    activity?: string;
    recent?: string[];
    granted?: string[];
    nowPlaying?: string;
    aware?: string[];
    now?: string;
  };
};

function extractDelta(chunk: unknown): {
  thinking?: string;
  content?: string;
  /** 原生 tools：**原样透传**分片，拼装交给客户端（一处实现见 lib/tool-calls） */
  toolCalls?: unknown[];
  usage?: { prompt?: number; completion?: number; cached?: number; total?: number };
} {
  const c = chunk as {
    choices?: {
      delta?: {
        content?: string | null;
        reasoning_content?: string | null;
        reasoning?: string | { content?: string } | null;
        tool_calls?: unknown[];
      };
    }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      cached_tokens?: number;
      /** DeepSeek 用的是这个名字（命中缓存的 token 数）—— 不读它命中率永远是 0 */
      prompt_cache_hit_tokens?: number;
    } | null;
  };

  const out: {
    thinking?: string;
    content?: string;
    toolCalls?: unknown[];
    usage?: { prompt?: number; completion?: number; cached?: number; total?: number };
  } = {};

  // 用量可能单独一帧发过来（此时没有 choices）
  const u = c.usage;
  if (u) {
    out.usage = {
      prompt: u.prompt_tokens,
      completion: u.completion_tokens,
      cached:
        u.prompt_cache_hit_tokens ??
        u.prompt_tokens_details?.cached_tokens ??
        u.cached_tokens,
      total: u.total_tokens,
    };
  }

  const d = c.choices?.[0]?.delta;
  if (d) {
    const thinking =
      (typeof d.reasoning_content === "string" && d.reasoning_content) ||
      (typeof d.reasoning === "string" && d.reasoning) ||
      (d.reasoning && typeof d.reasoning === "object" && d.reasoning.content) ||
      undefined;
    if (thinking) out.thinking = thinking;
    if (typeof d.content === "string") out.content = d.content;
    if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) out.toolCalls = d.tool_calls;
  }
  return out;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "无效请求" }, { status: 400 });
        }
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          return Response.json({ error: "请先输入内容" }, { status: 400 });
        }

        const model = getModel(body.model ?? "sonnet");

        /**
         * 上游怎么定：**不绑定任何厂商**。
         *
         *   ① 用户在「我的 → 自定义上游」里填了地址+密钥 → 用他的（密钥只在他设备上）
         *   ② 否则用服务端环境变量配的那份（QIDAO_UPSTREAM_BASE / KEY / MODEL）
         *   ③ 都没有 → 明确告诉他要配什么，而不是偷偷调某个厂商的接口
         */
        const builtinBase = (process.env.QIDAO_UPSTREAM_BASE ?? "").trim();
        const builtinKey = (process.env.QIDAO_UPSTREAM_KEY ?? "").trim();
        const builtinModel = (process.env.QIDAO_UPSTREAM_MODEL ?? "").trim();

        const useCustom = Boolean(body.customBaseUrl && body.customApiKey);
        const apiKey = useCustom ? body.customApiKey : builtinKey;
        const base = (useCustom ? body.customBaseUrl : builtinBase)?.replace(/\/+$/, "");
        const upstreamModel = (useCustom ? body.upstreamModel?.trim() : "") || builtinModel;

        if (!apiKey || !base) {
          return Response.json(
            {
              error:
                "还没接模型：去「我的 → 自定义上游」填地址和密钥（推荐），或让服务端设 QIDAO_UPSTREAM_BASE / QIDAO_UPSTREAM_KEY。",
            },
            { status: 503 },
          );
        }
        if (!upstreamModel) {
          return Response.json(
            {
              error:
                "还差模型名：自定义上游要填「上游模型名」（可点「拉取可用模型」问对方要列表）。",
            },
            { status: 400 },
          );
        }

        // 拼提示词走 lib/prompt —— 和 App 内直连上游时**同一份实现**，
        // 否则封装成 APK 之后他的人设和感知层就丢了。
        const staticPrompt = systemPrompt(body);
        /**
         * 工具循环里由客户端拼好的那一份优先（它带着 assistant 的 tool_calls 和 tool 结果，
         * 服务端补不出来）；普通一轮仍然在这里拼 —— 两条路共用 lib/prompt，不会走散。
         */
        const messages =
          Array.isArray(body.assembledMessages) && body.assembledMessages.length > 0
            ? body.assembledMessages
            : assembleMessages(body, body.messages);

        const meta = {
          promptHash: shortHash(staticPrompt),
          systemTokens: estimateTokens(staticPrompt),
          model: body.model,
        };

        // 自定义上游：模型名听对方的；没填就用服务端配的那个
        const payload: Record<string, unknown> = {
          model: upstreamModel,
          messages,
          stream: true,
          max_tokens: body.maxTokens && body.maxTokens > 0 ? body.maxTokens : model.maxTokens,
        };
        /**
         * 客户端判过"这把上游支不支持原生 tools"才把 actionTools 传上来 ——
         * 这里只负责原样转发（判断逻辑只有客户端一处，别在这里再判一遍）。
         */
        if (Array.isArray(body.actionTools) && body.actionTools.length > 0) {
          payload.tools = body.actionTools;
        }
        // reasoning_effort 是 xAI 的参数；别家 OpenAI 兼容接口可能直接报错，
        // 所以只有走内置时才带它。
        if (!useCustom) payload.reasoning_effort = model.effort as ReasoningEffort;

        const upstream = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!upstream.ok || !upstream.body) {
          let detail = `上游 ${upstream.status}`;
          let toolsUnsupported = false;
          try {
            const err = (await upstream.json()) as {
              error?: { message?: string } | string;
              toolsUnsupported?: boolean;
            };
            if (typeof err.error === "string") detail = err.error;
            else if (err.error?.message) detail = err.error.message;
            toolsUnsupported = err.toolsUnsupported === true;
          } catch {
            /* ignore */
          }
          /**
           * ⚠️ 这个标记是**降级的唯一依据**，别删。
           *
           * 上游回 400「tools is not supported」时，这里是 502 —— 客户端只看状态码
           * 会把它当成"服务端挂了"，于是**永远不降级**，用户就卡在报错上。
           * 所以"要不要摘掉 tools 重试"这个判断必须由服务端显式说清楚。
           */
          if (/tool/i.test(detail) && /not supported|unsupported|unknown|invalid|不支持/i.test(detail)) {
            toolsUnsupported = true;
          }
          const friendly = /credits|subscription|quota|rate limit/i.test(detail)
            ? "模型额度暂时不可用。可以稍后再试，或到「我的」填写自己的 OpenAI 兼容上游。"
            : detail;
          return Response.json({ error: friendly, toolsUnsupported }, { status: 502 });
        }

        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const reader = upstream.body.getReader();

        const stream = new ReadableStream({
          async start(controller) {
            let buf = "";
            const send = (obj: unknown) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            };
            // 先把元信息发出去，界面据此判断前缀有没有变
            send({ meta });
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split("\n");
                buf = lines.pop() ?? "";
                for (const line of lines) {
                  const t = line.trim();
                  if (!t.startsWith("data:")) continue;
                  const raw = t.slice(5).trim();
                  if (!raw) continue;
                  if (raw === "[DONE]") {
                    send({ done: true });
                    continue;
                  }
                  try {
                    const parsed = JSON.parse(raw) as unknown;
                    const delta = extractDelta(parsed);
                    if (delta.thinking || delta.content || delta.usage || delta.toolCalls) send(delta);
                  } catch {
                    /* skip */
                  }
                }
              }
              send({ done: true });
            } catch (err) {
              send({ error: err instanceof Error ? err.message : "流中断" });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
