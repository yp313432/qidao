import { createFileRoute } from "@tanstack/react-router";
import { getModel, type ModelId, type ReasoningEffort } from "@/lib/models";
import { estimateTokens, shortHash } from "@/lib/tokens";
import type { ReplyStyle } from "@/lib/types";

type Body = {
  model: ModelId;
  messages: { role: "user" | "assistant" | "system"; content: string | unknown[] }[];
  style: ReplyStyle;
  tools: { name: string; tools: string[] }[];
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

const STYLE: Record<ReplyStyle, string> = {
  default: "语气温和、准确、留白得当，不堆砌。",
  concise: "尽量短：先给结论，必要时再补一句理由。",
  explanatory: "把推理过程写清楚，分点说明，但仍避免空话。",
};

function systemPrompt(body: Body): string {
  const tools = body.tools.length
    ? `已配置的外部工具：${body.tools
        .map((t) => (t.tools.length ? `${t.name}（${t.tools.join(", ")}）` : t.name))
        .join("；")}。`
    : "当前未配置额外工具。";
  const who = body.name?.trim() || "yan";
  const self = body.aiName?.trim() || "星芒";
  return `你是${self}，一个安静、清晰、擅长深度思考的助手。用户名叫 ${who}。
你在「栖岛」里 —— 这是用户一个人的私人空间，界面和内容都只属于他。
用用户的语言回答。${STYLE[body.style] ?? STYLE.default}
思考在内部完成；正文不要重复「让我思考」之类的套话。${
    body.persona?.trim() ? `\n你给自己写下的设定：${body.persona.trim()}` : ""
  }
${tools}`;
}

/**
 * 每次都会变的东西（时间、在干什么、权限……）。
 *
 * **故意不放进系统提示词** —— 它一进去，系统提示词就每轮都不同，
 * 后面所有历史的前缀缓存全部失效。这里改成附在最后一条用户消息尾部。
 */
function perceptionBlock(body: Body): string {
  const ctx = body.context;
  if (!ctx) return "";
  const lines = [
    ctx.now ? `客户端时间：${ctx.now}。` : "",
    ctx.activity ? `用户此刻在做：${ctx.activity}。` : "",
    ctx.nowPlaying ? `用户此刻正在听：${ctx.nowPlaying}。` : "",
    ctx.recent && ctx.recent.length > 1
      ? `最近的活动轨迹（新→旧）：${ctx.recent.join(" → ")}。`
      : "",
    ctx.granted && ctx.granted.length
      ? `用户已授权你可以：${ctx.granted.join("、")}。`
      : "用户还没有授权你操作 App。",
    ctx.aware && ctx.aware.length
      ? `用户允许你了解这些（按权限过滤过）：\n${ctx.aware.map((l) => `- ${l}`).join("\n")}`
      : "",
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return `\n\n---\n【此刻的情况】（只是背景，不必刻意复述）\n${lines.join("\n")}`;
}

/**
 * 消息内容归一化：纯文本裁一段；带图片的 content parts 保留结构
 * （只裁其中的文字部分），这样支持视觉的模型就能直接看到图。
 */
function normalizeContent(content: string | unknown[]): string | unknown[] {
  if (typeof content === "string") return content.slice(0, 8000);
  if (Array.isArray(content)) {
    return content.map((part) => {
      const p = part as { type?: string; text?: string; image_url?: { url?: string } };
      if (p?.type === "text") return { type: "text", text: String(p.text ?? "").slice(0, 8000) };
      if (p?.type === "image_url") {
        return { type: "image_url", image_url: { url: p.image_url?.url ?? "" } };
      }
      return part;
    });
  }
  return String(content ?? "");
}

function extractDelta(chunk: unknown): {
  thinking?: string;
  content?: string;
  usage?: { prompt?: number; completion?: number; cached?: number; total?: number };
} {
  const c = chunk as {
    choices?: {
      delta?: {
        content?: string | null;
        reasoning_content?: string | null;
        reasoning?: string | { content?: string } | null;
      };
    }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      cached_tokens?: number;
    } | null;
  };

  const out: {
    thinking?: string;
    content?: string;
    usage?: { prompt?: number; completion?: number; cached?: number; total?: number };
  } = {};

  // 用量可能单独一帧发过来（此时没有 choices）
  const u = c.usage;
  if (u) {
    out.usage = {
      prompt: u.prompt_tokens,
      completion: u.completion_tokens,
      cached: u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens,
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

        const staticPrompt = systemPrompt(body);
        const perception = perceptionBlock(body);

        // 易变的「此刻情况」挂到最后一条用户消息上，而不是塞进系统提示词 ——
        // 系统提示词一动，前面所有历史的前缀缓存就全废了。
        const raw = body.messages.slice(-16);
        let lastUser = -1;
        for (let i = raw.length - 1; i >= 0; i -= 1) {
          if (raw[i]!.role === "user") {
            lastUser = i;
            break;
          }
        }

        const messages = [
          { role: "system" as const, content: staticPrompt },
          ...raw.map((m, i) => {
            const base = normalizeContent(m.content);
            if (i !== lastUser || !perception) return { role: m.role, content: base };
            if (typeof base === "string") return { role: m.role, content: base + perception };
            return {
              role: m.role,
              content: [...base, { type: "text", text: perception }],
            };
          }),
        ];

        // 前缀指纹：据此判断「缓存为什么没命中」
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
          max_tokens: model.maxTokens,
        };
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
          try {
            const err = (await upstream.json()) as { error?: { message?: string } | string };
            if (typeof err.error === "string") detail = err.error;
            else if (err.error?.message) detail = err.error.message;
          } catch {
            /* ignore */
          }
          const friendly = /credits|subscription|quota|rate limit/i.test(detail)
            ? "模型额度暂时不可用。可以稍后再试，或到「我的」填写自己的 OpenAI 兼容上游。"
            : detail;
          return Response.json({ error: friendly }, { status: 502 });
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
                    if (delta.thinking || delta.content || delta.usage) send(delta);
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
