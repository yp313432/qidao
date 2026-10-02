import type { ModelId } from "./models";
import type { ChatMessage, ReplyStyle } from "./types";
import { attachmentsToText } from "./attachments";
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
};

export async function streamChat(
  req: ChatRequest,
  onDelta: (d: ChatDelta) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
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
