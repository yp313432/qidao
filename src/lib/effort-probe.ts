/**
 * 上游能力探测 —— 「这三档推理强度，在你这台上游是真能调的吗」。
 *
 * 为什么必须测：设置页上「快答 / 均衡 / 深思」三个点，如果不真发参数，
 * 那就是三个换个名字的摆设 —— 用户点来点去，回复该多慢还多慢。用户原话：
 * "这个是有用的吧，就是真能调强度"、"挡位必须是真的能用的，不然就是误导"。
 *
 * 真参数（DeepSeek 官方「思考模式」口径，也是多数 OpenAI 兼容网关认的）：
 *   · `thinking: { type: "enabled" | "disabled" }` —— 开关
 *   · `reasoning_effort: "low" | "high" | "max"` —— 力度（medium 等同 high）
 * 两个都是**可选**字段，老网关会因为多出来的字段整轮 400。所以先测、测过了才发。
 *
 * 怎么算"测出来了"：不能只看 HTTP 200 —— 有些网关会把不认识的字段默默吃掉，
 * 200 了但根本没思考。所以看**流里有没有 reasoning_content 增量**：
 *   ① 开思考（thinking.enabled + effort high）→ 必须看到思考增量
 *   ② 关思考（thinking.disabled）            → 必须看不到思考增量
 * 两条都符合才叫「真能调」。只看①会漏掉"能开不能关"的上游（快答档就废了）。
 *
 * ⚠️ 跟 `tool-probe.ts` 一样，这个文件要**能在纯 node 里跑**：
 * 不 import 浏览器 API / React / zustand，不 import 路径别名，只用全局 fetch。
 */
export type EffortProbeResult = {
  /** 总结论：三档真能拉开差距（开得起来、也关得掉） */
  ok: boolean;
  /** 请求本身通不通（不是 401/404 那种连都连不上） */
  httpOk: boolean;
  /** 开思考时确实回了 `reasoning_content` */
  reasoningOn: boolean;
  /** 关思考时确实没有 `reasoning_content` */
  reasoningOff: boolean;
  /** 两次请求的总耗时（毫秒） */
  latencyMs: number;
  /** 人话的失败原因 */
  error?: string;
  /** 原始响应片段，便于诊断 */
  rawSnippet: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const SNIPPET_CHARS = 400;
const ERROR_BODY_CHARS = 200;

/**
 * 探测用的题目：必须**逼它思考**。
 * 用 "1+1" 这种会被直接答掉、根本不进思考，于是把支持的上游误判成不支持。
 */
const QUESTION = "9.11 和 9.9 哪个大？先说结论，再用两句话说明为什么。";

/** 发一次最小请求，把流里出现过的思考片段拼回来 */
async function probeOnce(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  thinking: boolean;
  effort?: "low" | "high" | "max";
  timeoutMs: number;
}): Promise<{ httpOk: boolean; status: number; thinking: string; content: string; text: string; error?: string }> {
  const base = args.baseUrl.trim().replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), args.timeoutMs);

  let thinking = "";
  let content = "";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: args.model.trim(),
        messages: [{ role: "user", content: QUESTION }],
        stream: true,
        // 探测只花几十个 token，别让思考链把额度吃光
        max_tokens: 96,
        thinking: { type: args.thinking ? "enabled" : "disabled" },
        ...(args.thinking && args.effort ? { reasoning_effort: args.effort } : {}),
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        httpOk: false,
        status: res.status,
        thinking: "",
        content: "",
        text: body.slice(0, SNIPPET_CHARS),
        error: `上游返回 ${res.status}：${body.slice(0, ERROR_BODY_CHARS) || "（没有正文）"}`,
      };
    }

    if (!res.body) {
      return { httpOk: true, status: res.status, thinking: "", content: "", text: "", error: "上游没有回可读的流" };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let raw = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      if (raw.length > SNIPPET_CHARS * 3) raw = raw.slice(0, SNIPPET_CHARS * 3);
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const payload = s.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload) as {
            choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[];
          };
          const d = j.choices?.[0]?.delta;
          if (!d) continue;
          const t = d.reasoning_content ?? d.reasoning;
          if (t) thinking += t;
          if (d.content) content += d.content;
        } catch {
          // 半截 JSON / 非 JSON 行：跳过，不影响结论
        }
      }
      // 拿够证据就停，省得把整段思考都拉下来
      if (thinking.length > 0 && content.length > 0) break;
      if (content.length > 80) break;
    }
    try {
      await reader.cancel();
    } catch {
      // 关流失败不影响结论
    }
    return { httpOk: true, status: res.status, thinking, content, text: raw.slice(0, SNIPPET_CHARS) };
  } catch (err) {
    const msg = (err as Error)?.message || "未知错误";
    return {
      httpOk: false,
      status: 0,
      thinking: "",
      content: "",
      text: "",
      error: ctrl.signal.aborted ? `等太久了（${Math.round(args.timeoutMs / 1000)} 秒没回音）` : `连不上上游：${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 跑完整探测（两次请求，几十 token，肉眼看不见的开销）。
 * **永不抛异常** —— 所有失败都折进 `error`，设置页据此决定显示哪句话。
 */
export async function probeEffortSupport(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): Promise<EffortProbeResult> {
  const started = Date.now();
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!args.baseUrl.trim() || !args.apiKey.trim() || !args.model.trim()) {
    return {
      ok: false,
      httpOk: false,
      reasoningOn: false,
      reasoningOff: false,
      latencyMs: 0,
      error: "地址 / 密钥 / 模型名三样都填了才能测",
      rawSnippet: "",
    };
  }

  // ① 开思考：必须看到 reasoning_content
  const on = await probeOnce({ ...args, thinking: true, effort: "high", timeoutMs });
  if (!on.httpOk) {
    return {
      ok: false,
      httpOk: false,
      reasoningOn: false,
      reasoningOff: false,
      latencyMs: Date.now() - started,
      error: on.error,
      rawSnippet: on.text,
    };
  }

  // ② 关思考：必须看不到 reasoning_content
  const off = await probeOnce({ ...args, thinking: false, timeoutMs });

  const reasoningOn = on.thinking.trim().length > 0;
  const reasoningOff = off.httpOk ? off.thinking.trim().length === 0 : false;
  const ok = reasoningOn && reasoningOff;

  let error: string | undefined;
  if (!reasoningOn) {
    error =
      "发了开思考的参数，但上游一点思考内容都没回 —— 这台多半不认这套参数（参数被忽略了，不是真生效）。";
  } else if (!off.httpOk) {
    error = `能开思考，但关思考那次请求失败了：${off.error ?? "未知原因"}`;
  } else if (!reasoningOff) {
    error = "能开思考，但关了之后上游还在思考 —— 开关不起作用，「快答」档就没意义了。";
  }

  return {
    ok,
    httpOk: true,
    reasoningOn,
    reasoningOff,
    latencyMs: Date.now() - started,
    error,
    rawSnippet: (on.text || off.text).slice(0, SNIPPET_CHARS),
  };
}
