/**
 * 上游体检（App 内「模型与用量 → 自定义上游」里的那五项）
 *
 * 跟 `scripts/probe-upstream.mjs` 是同一套检查，区别只有两点：
 *   · 这里要能跑在手机里 —— App 的 WebView 里直接 fetch 会被 CORS 拦，
 *     所以失败时用 `nativeHttp` 走原生请求（跟聊天那条降级路同一个函数）；
 *   · 结果要给 UI 用，所以返回结构化数组，不打印。
 *
 * 为什么需要它：用户接中转站最怕的两件事是
 *   ① 号称 Claude Opus，实际给换成小模型；② 把 thinking / tools 字段吞了。
 * 这两件事用"看签名"是看不出来的（`model` 字段、`system_fingerprint` 都是
 * 一个字符串，代理想抄成什么都行），但**分词指纹**抄不了：
 * 同一段固定文本的 `prompt_tokens` 由上游真正的 tokenizer 决定。
 */

import { nativeHttp, looksLikeNetworkBlock } from "@/lib/native-http";

export type ProbeItem = {
  key: string;
  label: string;
  /** true = 正常，false = 有问题，null = 没测出结论（网络/鉴权失败等） */
  pass: boolean | null;
  detail: string;
};

export type UpstreamProbeResult = {
  ok: boolean;
  items: ProbeItem[];
  /** 人话结论（可能多条） */
  verdict: string[];
  error?: string;
};

/** 固定文本：中英混排 + 数字 + emoji，不同分词器数出来的 token 数差得明显 */
const FINGERPRINT_TEXT = `请只回复一个字符：好。
下面这段文字用来测分词：栖岛是一个把长期记忆、情绪和星空放在一起的小应用。它在 2026 年 11 月 1 日凌晨改过一版界面，包含中文标点、英文单词 memory / emotion / universe、数字 42 和 3.14159，以及 emoji 🌙 与 ✨。请不要改写、不要解释，只需确认收到。`;

type Base = { base: string; key: string; model: string };

function joinUrl(base: string, path: string) {
  const b = base.replace(/\/+$/, "");
  // 用户可能填到 /v1，也可能只填域名 —— 两种都接受
  if (/\/v\d+$/.test(b)) return `${b}${path}`;
  return `${b}/v1${path}`;
}

async function request(
  { base, key }: Base,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const url = joinUrl(base, path);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  const bodyText = init.body === undefined ? undefined : JSON.stringify(init.body);

  // 先直接 fetch（Web / 允许跨域的上游都能走通）
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: bodyText,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  } catch (err) {
    // App 里被 CORS 拦（Failed to fetch）→ 退到原生请求再来一次
    if (!looksLikeNetworkBlock(err)) throw err;
    const native = await nativeHttp({
      url,
      method: init.method ?? "GET",
      headers,
      data: init.body,
    });
    if (!native) throw err;
    const text = typeof native.data === "string" ? native.data : JSON.stringify(native.data ?? null);
    return { status: native.status, json: native.data ?? null, text };
  }
}

function pick(obj: unknown, path: (string | number)[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

export async function probeUpstreamModel(input: Base): Promise<UpstreamProbeResult> {
  const cfg: Base = {
    base: input.base.trim(),
    key: input.key.trim(),
    model: input.model.trim(),
  };
  const items: ProbeItem[] = [];
  const verdict: string[] = [];

  // ① 模型清单
  let modelIds: string[] = [];
  try {
    const r = await request(cfg, "/models");
    const data = pick(r.json, ["data"]);
    if (Array.isArray(data)) {
      modelIds = data.map((m) => String((m as { id?: string }).id ?? "")).filter(Boolean);
    }
    const hit = modelIds.some((id) => id.toLowerCase() === cfg.model.toLowerCase());
    items.push({
      key: "models",
      label: "这个模型名在上游清单里",
      pass: r.status === 200 ? hit : null,
      detail:
        r.status !== 200
          ? `清单没拿到（HTTP ${r.status}）`
          : hit
            ? `清单里有它（共 ${modelIds.length} 个）`
            : `清单里没有「${cfg.model}」（共 ${modelIds.length} 个，有些中转只给别名）`,
    });
  } catch (err) {
    items.push({
      key: "models",
      label: "这个模型名在上游清单里",
      pass: null,
      detail: `请求失败：${(err as Error).message}`,
    });
  }

  // ② 分词指纹
  let promptTokens: number | null = null;
  try {
    const r = await request(cfg, "/chat/completions", {
      method: "POST",
      body: {
        model: cfg.model,
        messages: [{ role: "user", content: FINGERPRINT_TEXT }],
        max_tokens: 1,
        stream: false,
      },
    });
    promptTokens = (pick(r.json, ["usage", "prompt_tokens"]) as number | undefined) ?? null;
    items.push({
      key: "fingerprint",
      label: "分词指纹（同一段固定文本的 prompt_tokens）",
      pass: r.status === 200 && promptTokens !== null,
      detail:
        r.status === 200
          ? promptTokens === null
            ? "上游没回 usage.prompt_tokens"
            : `${promptTokens} tokens —— 记下来，换站或换模型时对比这一项`
          : `HTTP ${r.status}`,
    });
  } catch (err) {
    items.push({
      key: "fingerprint",
      label: "分词指纹（同一段固定文本的 prompt_tokens）",
      pass: null,
      detail: `请求失败：${(err as Error).message}`,
    });
  }

  // ③ 思考链开关
  try {
    const off = await request(cfg, "/chat/completions", {
      method: "POST",
      body: {
        model: cfg.model,
        messages: [{ role: "user", content: "现在几点？用一句话回答。" }],
        max_tokens: 64,
        thinking: { type: "disabled" },
      },
    });
    const on = await request(cfg, "/chat/completions", {
      method: "POST",
      body: {
        model: cfg.model,
        messages: [{ role: "user", content: "现在几点？用一句话回答。" }],
        max_tokens: 64,
        thinking: { type: "enabled" },
        reasoning_effort: "max",
      },
    });
    const thinkOn = pick(on.json, ["choices", 0, "message", "reasoning_content"]);
    const lenOn = typeof thinkOn === "string" ? thinkOn.length : 0;
    const lenOff = (() => {
      const v = pick(off.json, ["choices", 0, "message", "reasoning_content"]);
      return typeof v === "string" ? v.length : 0;
    })();
    const hasField = lenOn > 0;
    items.push({
      key: "thinking",
      label: "思考链：能开能关，长度有差别",
      pass: hasField ? lenOn > lenOff : null,
      detail: hasField
        ? `关思考 ${lenOff} 字 / 开思考 ${lenOn} 字`
        : "拿不到 reasoning_content：要么不是思考型模型，要么上游把思考字段丢了",
    });
    if (!hasField) verdict.push("⚠️ 拿不到思考内容：这个站很可能把 reasoning 字段丢了");
    else if (lenOn <= lenOff) verdict.push("⚠️ 开关思考长度没差别：reasoning 参数很可能没被透传");
  } catch (err) {
    items.push({
      key: "thinking",
      label: "思考链：能开能关，长度有差别",
      pass: null,
      detail: `请求失败：${(err as Error).message}`,
    });
  }

  // ④ tools
  try {
    const r = await request(cfg, "/chat/completions", {
      method: "POST",
      body: {
        model: cfg.model,
        messages: [{ role: "user", content: "现在几点？请调用 get_time 工具，不要自己编。" }],
        max_tokens: 120,
        tools: [
          {
            type: "function",
            function: {
              name: "get_time",
              description: "获取当前时间",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      },
    });
    const calls = (pick(r.json, ["choices", 0, "message", "tool_calls"]) as unknown[] | undefined) ?? [];
    const called = Array.isArray(calls) && calls.length > 0;
    items.push({
      key: "tools",
      label: "认原生 tools（回结构化 tool_calls）",
      pass: r.status === 200 ? called : null,
      detail:
        r.status === 200
          ? called
            ? "会回 tool_calls —— 栖岛能走原生通道，工具 token 也会算进用量"
            : "带了工具也没回 tool_calls —— 栖岛会退到「保底协议」，工具用量不计"
          : `HTTP ${r.status}`,
    });
    if (r.status === 200 && !called) verdict.push("⚠️ 上游不认原生 tools：会用保底协议执行动作");
  } catch (err) {
    items.push({
      key: "tools",
      label: "认原生 tools（回结构化 tool_calls）",
      pass: null,
      detail: `请求失败：${(err as Error).message}`,
    });
  }

  // ⑤ 流式形状（用真实流请求，只统计形状）
  try {
    const url = joinUrl(cfg.base, "/chat/completions");
    const body = JSON.stringify({
      model: cfg.model,
      messages: [{ role: "user", content: "用两句话介绍一下你自己。" }],
      max_tokens: 160,
      stream: true,
    });
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` };
    let chunks = 0;
    let firstAt: number | null = null;
    const started = Date.now();
    let sawReasoning = false;
    try {
      const res = await fetch(url, { method: "POST", headers, body });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload) as {
              choices?: { delta?: { content?: string; reasoning_content?: string } }[];
            };
            const d = j.choices?.[0]?.delta ?? {};
            if (firstAt === null && (d.content || d.reasoning_content)) firstAt = Date.now() - started;
            if (d.reasoning_content) sawReasoning = true;
            if (d.content) chunks += 1;
          } catch {
            /* 分片不完整，忽略 */
          }
        }
      }
    } catch (err) {
      // fetch 被跨域拦：App 里用原生整段请求测不了"分片"，直接如实说明
      if (looksLikeNetworkBlock(err)) {
        items.push({
          key: "stream",
          label: "真流式（逐片吐字）",
          pass: null,
          detail: "App 里测不了分片（原生请求是整段返回），到电脑上跑 scripts/probe-upstream.mjs 才能看这一项",
        });
        return finish(items, verdict);
      }
      throw err;
    }
    items.push({
      key: "stream",
      label: "真流式（逐片吐字）",
      pass: chunks > 1,
      detail:
        chunks > 1
          ? `吐了 ${chunks} 片，首字 ${firstAt ?? "?"}ms${sawReasoning ? "，含思考分片" : ""}`
          : "只回了一个大分片 —— 像是代理一次性转发，不是真流式",
    });
    if (chunks <= 1) verdict.push("⚠️ 流式只回了一个大分片：不像真流式");
  } catch (err) {
    items.push({
      key: "stream",
      label: "真流式（逐片吐字）",
      pass: null,
      detail: `请求失败：${(err as Error).message}`,
    });
  }

  return finish(items, verdict);
}

function finish(items: ProbeItem[], verdict: string[]): UpstreamProbeResult {
  const failed = items.filter((i) => i.pass === false);
  const ok = failed.length === 0;
  if (!verdict.length && ok) verdict.push("✅ 这几项都没发现明显异常（冒充这件事只能降低概率，不能 100% 排除）");
  return { ok, items, verdict };
}
