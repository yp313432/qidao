/** Shared by native/direct requests, the server route and the chat UI. */
export function redactError(text: string): string {
  return text.replace(/\bBearer\s+[^\s"',}]+/gi, "Bearer [已隐藏]")
    .replace(/\bsk-[a-z0-9_-]{8,}/gi, "[密钥已隐藏]")
    .replace(/(["']?(?:api[_-]?key|authorization|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"',}&]+/gi, "$1[已隐藏]")
    .slice(0, 4000);
}

export function upstreamError(status: number | undefined, raw: string, requestId?: string | null): string {
  let message = raw;
  let code = "", type = "", id = requestId || "";
  try {
    const data = JSON.parse(raw);
    const error = data.error ?? data;
    message = typeof error === "string" ? error : String(error.message ?? raw);
    code = String(error.code ?? ""); type = String(error.type ?? "");
    id = String(data.request_id ?? error.request_id ?? data.requestId ?? id);
  } catch { /* Plain text errors remain useful. */ }
  return redactError([status ? `HTTP ${status}` : "", type && `type=${type}`, code && `code=${code}`, id && `request_id=${id}`, message].filter(Boolean).join("\n"));
}

export function chatError(raw: string) {
  const detail = redactError(raw || "回复流已结束，但没有正文或工具结果。");
  const status = Number(detail.match(/\bHTTP\s+(\d{3})\b/i)?.[1]) || undefined;
  let category = "未知错误", suggestion = "请根据下方原始错误检查对应接口；原因尚未确认。", retryable = false;
  if (/reasoning_content/i.test(detail)) {
    category = "接口协议错误 · 思考内容缺失";
    suggestion = "上游要求回传历史 assistant 消息的 reasoning_content。更新后重试；若旧记录的思考内容已被清理，请新建对话。无需更换密钥。";
  } else if (/先.*(?:地址|密钥|模型)|未配置|请填写|缺少.*(?:地址|密钥|模型)/.test(detail)) {
    category = "配置不完整"; suggestion = "到模型设置补全服务地址、API 密钥和模型 ID。";
  } else if (/CORS|cross.origin/i.test(detail)) {
    category = "浏览器跨域限制"; suggestion = "该网页请求被同源策略拦截；使用 App 原生网络通道，或由接口服务配置允许的来源。";
  } else if (status === 401 || /invalid.api.key|incorrect.api.key|authentication/i.test(detail)) {
    category = "认证失败"; suggestion = "检查该模型接口的 API 密钥及服务地址。";
  } else if (status === 403) {
    category = "访问被拒绝"; suggestion = "检查账号、模型权限及服务商的访问限制。";
  } else if (status === 402 || /insufficient_quota|insufficient.balance|credits|subscription|余额|额度不足/i.test(detail)) {
    category = "额度或余额不足"; suggestion = "检查服务商账户的余额、额度及订阅。";
  } else if (status === 429 || /rate.limit|too.many.requests/i.test(detail)) {
    category = "请求限流"; suggestion = "稍等后再试，或降低请求频率。"; retryable = true;
  } else if (/context.length|context_length|max.context|maximum.context|token.limit|上下文.*超/i.test(detail)) {
    category = "上下文超限"; suggestion = "减少历史记录或工具数量，或使用更大的上下文模型。";
  } else if (status === 404 || /model.*not.found|model_not_found/i.test(detail)) {
    category = "接口或模型不存在"; suggestion = "核对服务地址、接口路径和模型 ID。";
  } else if (status && status >= 500) {
    category = "上游服务异常"; suggestion = "服务端暂时无法完成请求，请稍后再试。"; retryable = true;
  } else if (status === 408 || /timeout|timed.out|超时/i.test(detail)) {
    category = "请求超时"; suggestion = "请求在规定时间内未完成，可稍后重试。"; retryable = true;
  } else if (/failed to fetch|network|load failed|连接|断流|流中断|fetch failed/i.test(detail)) {
    category = "网络请求失败"; suggestion = "检查连接和服务地址。当前信息不足以确定是网络、TLS 还是浏览器跨域限制。"; retryable = true;
  } else if (status && status >= 400 && status < 500) {
    category = "请求参数或协议错误"; suggestion = "按原始错误检查模型参数、消息格式和工具协议；相同请求重试通常无效。";
  } else if (!raw || /无法读取回复流|空回复|没有正文/i.test(detail)) {
    category = "回复内容为空"; suggestion = "接口没有返回正文或工具结果；检查响应格式、输出额度和结束原因。"; retryable = true;
  }
  return { category, suggestion, detail, status, retryable };
}

export function formatChatError(raw: string, retries = 0): string {
  const error = chatError(raw);
  return `错误类型：${error.category}\n${error.suggestion}\n\n原始错误：\n${error.detail}\n\n${retries ? `已自动重试 ${retries} 次。` : "未自动重试。"}`;
}
