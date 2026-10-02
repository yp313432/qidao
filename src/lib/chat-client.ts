import type { ModelId } from "./models";
import { getModel } from "./models";
import type { ChatMessage, PermissionMode, ReplyStyle } from "./types";
import { attachmentsToText } from "./attachments";
import { assembleMessages } from "./prompt";
import { estimateTokens } from "./tokens";

export type ChatDelta = {
  thinking?: string;
  content?: string;
  error?: string;
  done?: boolean;
  /** 上游返回的用量（有的实现只在最后一帧给） */
  usage?: { prompt?: number; completion?: number; cached?: number; total?: number };
  /** 服务端第一帧报回来的提示词指纹（用于判断前缀有没有变） */
  meta?: { promptHash?: string; systemTokens?: number; model?: string };
};

/** 文本，或多模态的 content parts（OpenAI 风格）。 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ApiMessage = {
  role: "user" | "assistant" | "system";
  content: string | ContentPart[];
};

/** 随每条消息一起上报的「用户此刻的状态」，让 AI 知道你在干什么。 */
export type ChatContext = {
  /** 当前活动，例如「在听歌 · 夜航 · 播放中」 */
  activity?: string;
  /** 最近的活动轨迹（新 → 旧） */
  recent?: string[];
  /** 已被允许的能力（中文标题） */
  granted?: string[];
  /** 此刻正在播放的音乐（如果有） */
  nowPlaying?: string;
  /** 逐项感知内容（已按权限过滤），每行形如「文档库：…」 */
  aware?: string[];
  /** 客户端当前时间 */
  now?: string;
};

export type ChatRequest = {
  model: ModelId;
  messages: ApiMessage[];
  style: ReplyStyle;
  tools: { name: string; tools: string[] }[];
  customBaseUrl?: string;
  customApiKey?: string;
  /** 自定义上游的真实模型名（留空则用服务端配的） */
  upstreamModel?: string;
  name: string;
  /** AI 的名字（用户在设置里自填），用于服务端拼系统提示词 */
  aiName?: string;
  /** 他的人设/自述 */
  persona?: string;
  /** 用户此刻在干什么 —— 感知层 */
  context?: ChatContext;
  /** 世界书 · 常驻条目（进系统提示词） */
  worldAlways?: string[];
  /** 世界书 · 这轮命中关键词的条目（挂最后一条用户消息尾部） */
  worldHit?: string[];
  /** 用户给它的授权（实时）—— 用来生成说明书里"你现在的权限"那一节 */
  permissions?: Record<string, PermissionMode>;
};

/**
 * 直连模式：手机直接跟模型说话，中间不经过任何服务器。
 *
 * 为什么要它：封装成 APK 之后没有 `/api/chat` 这个服务端了。
 * 而这正是**解决"要挂梯子"的关键** —— 国内接口（DeepSeek 等）允许浏览器直连
 * （CORS 已实测放开），所以手机 ↔ 模型 是直路：又快又不用代理。
 *
 * 与走服务端**共用同一份提示词**（lib/prompt），所以他人设、感知层一模一样。
 */
async function streamDirect(
  req: ChatRequest,
  onDelta: (d: ChatDelta) => void,
  signal?: AbortSignal,
): Promise<void> {
  const base = (req.customBaseUrl ?? "").trim().replace(/\/+$/, "");
  const key = (req.customApiKey ?? "").trim();
  const model = (req.upstreamModel ?? "").trim();

  if (!base || !key) {
    onDelta({
      error: "还没接模型：去「我的 → 自定义上游」填地址和密钥。",
      done: true,
    });
    return;
  }
  if (!model) {
    onDelta({
      error: "还差模型名：去「我的 → 自定义上游」填（可点「拉取可用模型」问对方要列表）。",
      done: true,
    });
    return;
  }

  const messages = assembleMessages(req, req.messages);
  const maxTokens = getModel(req.model).maxTokens;

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens }),
      signal,
    });
  } catch (err) {
    onDelta({
      error: `连不上上游：${(err as Error).message || "网络错误"}（检查地址、密钥、以及手机能不能上网）`,
      done: true,
    });
    return;
  }

  if (!res.ok) {
    let msg = `上游返回 ${res.status}`;
    try {
      const text = await res.text();
      try {
        const j = JSON.parse(text) as { error?: { message?: string } | string };
        msg =
          typeof j.error === "string"
            ? j.error
            : (j.error?.message ?? `${msg}：${text.slice(0, 160)}`);
      } catch {
        msg = `${msg}：${text.slice(0, 160)}`;
      }
    } catch {
      /* ignore */
    }
    onDelta({ error: msg, done: true });
    return;
  }
  if (!res.body) {
    onDelta({ error: "上游没返回内容", done: true });
    return;
  }

  onDelta({ meta: { model } });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finished = false;

  const handle = (payload: string) => {
    if (!payload || payload === "[DONE]") {
      if (!finished) {
        finished = true;
        onDelta({ done: true });
      }
      return;
    }
    try {
      const j = JSON.parse(payload) as {
        choices?: {
          delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
          };
        }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          /** DeepSeek 用这个字段报"命中缓存的 token 数" */
          prompt_cache_hit_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        } | null;
        error?: { message?: string } | string;
      };
      if (j.error) {
        const m = typeof j.error === "string" ? j.error : (j.error.message ?? "上游报错");
        onDelta({ error: m, done: true });
        finished = true;
        return;
      }
      const d = j.choices?.[0]?.delta;
      // 思考链：DeepSeek 用 reasoning_content，个别实现用 reasoning
      const think = d?.reasoning_content ?? d?.reasoning;
      if (think) onDelta({ thinking: think });
      if (d?.content) onDelta({ content: d.content });
      if (j.usage) {
        onDelta({
          usage: {
            prompt: j.usage.prompt_tokens,
            completion: j.usage.completion_tokens,
            total: j.usage.total_tokens,
            // 缓存命中：DeepSeek 叫 prompt_cache_hit_tokens，OpenAI 那套在
            // prompt_tokens_details.cached_tokens —— 两个都读，否则永远是 0
            cached:
              j.usage.prompt_cache_hit_tokens ??
              j.usage.prompt_tokens_details?.cached_tokens,
          },
        });
      }
    } catch {
      /* 半截帧先跳过，下一轮补全 */
    }
  };

  /**
   * 看门狗：流式连接**长时间不吐字**绝不能无限等。
   *
   * 实测症状：思考链很长时，连接被中途掐断（经过代理/中转时尤其常见），
   * 界面上就是"卡住"，最后只剩一条空回复。
   * 这里 45 秒没有新数据就主动断开 —— 已经收到的内容全部保住，
   * 上层会告诉用户"是断了，不是没话说"。
   */
  let lastAt = Date.now();
  let stalled = false;
  const stallTimer = window.setInterval(() => {
    if (Date.now() - lastAt > 45_000) stalled = true;
  }, 3000);
  const stall = new Promise<"stall">((resolve) => {
    const wait = window.setInterval(() => {
      if (stalled) {
        window.clearInterval(wait);
        resolve("stall");
      }
    }, 500);
  });

  while (true) {
    const next = await Promise.race([reader.read(), stall]);
    if (next === "stall") {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    const { done, value } = next;
    if (done) break;
    lastAt = Date.now();
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      handle(trimmed.slice(5).trim());
    }
  }
  window.clearInterval(stallTimer);
  if (buf.trim().startsWith("data:")) handle(buf.trim().slice(5).trim());
  if (!finished) onDelta({ done: true });
}

/** 构建时就定下来：给 APK 打包时设 VITE_DIRECT_UPSTREAM=1 */
const DIRECT_BUILD = (import.meta.env?.VITE_DIRECT_UPSTREAM as string | undefined) === "1";

export async function streamChat(
  req: ChatRequest,
  onDelta: (d: ChatDelta) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (DIRECT_BUILD) {
    await streamDirect(req, onDelta, signal);
    return;
  }

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  /**
   * 兜底：万一在没有服务端的壳里跑（比如忘了设构建标志就打了包），
   * `/api/chat` 会返回 SPA 的 HTML 而不是事件流。认出来就改走直连 ——
   * 否则用户会看到"发出去了、一个字都不回"这种最难查的失败。
   */
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("text/event-stream")) {
    await streamDirect(req, onDelta, signal);
    return;
  }

  if (!res.ok) {
    let msg = `请求失败 ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    onDelta({ error: msg, done: true });
    return;
  }
  if (!res.body) {
    onDelta({ error: "无法读取回复流", done: true });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        onDelta({ done: true });
        continue;
      }
      try {
        const json = JSON.parse(payload) as ChatDelta;
        onDelta(json);
      } catch {
        /* skip malformed chunk */
      }
    }
  }
  onDelta({ done: true });
}

export type HistoryOpts = {
  /** 估算 token 预算 */
  budget?: number;
  /** 至少保留最近多少条 */
  keepRecent?: number;
  /** 超预算是否折叠更早的消息 */
  autoCompact?: boolean;
  /** 用到预算的百分之多少开始折叠 */
  compactAt?: number;
};

function tokensOf(m: ApiMessage): number {
  if (typeof m.content === "string") return estimateTokens(m.content);
  let n = 0;
  for (const p of m.content) {
    if (p.type === "text") n += estimateTokens(p.text);
    else n += 260; // 一张图粗估
  }
  return n;
}

/**
 * 组装发给上游的历史。
 *
 * 加了预算控制：从最近往回收，装不下就停 —— 但最近 keepRecent 条
 * 无论多长都保留（否则一句长文就能把当前问题挤掉）。
 */
export function historyForApi(messages: ChatMessage[], opts: HistoryOpts = {}): ApiMessage[] {
  const keep = Math.max(2, opts.keepRecent ?? 16);
  const autoCompact = opts.autoCompact ?? true;
  const budget = Math.max(500, opts.budget ?? 6000);
  const limit = budget * ((opts.compactAt ?? 80) / 100);

  const built: ApiMessage[] = messages
    .filter((m) => m.content.trim() || m.role === "user")
    .map((m) => {
      const text = m.content + attachmentsToText(m.attachments);
      // 只有图片/表情走图片通道；语音、文件都只发文字部分
      const images = (m.attachments ?? []).filter(
        (a) => (a.kind === "image" || a.kind === "sticker") && a.dataUrl,
      );
      // 没有图片就走纯文本（兼容所有上游）；
      // 有图片就发 content parts，模型支持视觉时自然就看得见。
      if (images.length === 0) return { role: m.role, content: text };
      return {
        role: m.role,
        content: [
          { type: "text" as const, text },
          ...images.map((a) => ({
            type: "image_url" as const,
            image_url: { url: a.dataUrl as string },
          })),
        ],
      };
    });

  if (!autoCompact) return built.slice(-keep);

  const kept: ApiMessage[] = [];
  let used = 0;
  for (let i = built.length - 1; i >= 0; i -= 1) {
    const item = built[i]!;
    const forced = built.length - i <= keep;
    const t = tokensOf(item);
    if (!forced && used + t > limit) break;
    used += t;
    kept.unshift(item);
  }
  return kept;
}
