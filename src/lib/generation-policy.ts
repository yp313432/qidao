/** 所有聊天通道共用的无数据等待时间；持续收到思考/正文/心跳时重新计时。 */
export const MODEL_IDLE_TIMEOUT_MS = 180_000;
export const NATIVE_MODEL_READ_TIMEOUT_MS = MODEL_IDLE_TIMEOUT_MS;
export const THINKING_ANSWER_RECOVERY_LIMIT = 1;

export class ModelIdleTimeoutError extends Error {
  readonly code = "idle_timeout";
  constructor(milliseconds = MODEL_IDLE_TIMEOUT_MS) {
    super(`等待上游超时：已连续 ${Math.round(milliseconds / 1000)} 秒未收到新数据。已收到的思考和正文会保留。`);
    this.name = "ModelIdleTimeoutError";
  }
}

/** 不给持续生成设置总时长上限；计时器只包住一次网络请求，不覆盖用户确认工具的时间。 */
export async function withModelIdleTimeout<T, D>(
  parent: AbortSignal | undefined,
  onDelta: (delta: D) => void,
  run: (signal: AbortSignal, receive: (delta: D) => void) => Promise<T>,
  milliseconds = MODEL_IDLE_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortFromParent = () => controller.abort(parent?.reason ?? new DOMException("用户停止了回复", "AbortError"));
  const touch = () => {
    clearTimeout(timer);
    if (!controller.signal.aborted) timer = setTimeout(() => controller.abort(new ModelIdleTimeoutError(milliseconds)), milliseconds);
  };
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason ?? new DOMException("已停止", "AbortError"));
  controller.signal.addEventListener("abort", onAbort, { once: true });
  parent?.addEventListener("abort", abortFromParent, { once: true });
  if (parent?.aborted) abortFromParent();
  touch();
  try {
    const work = controller.signal.aborted ? aborted : run(controller.signal, (delta) => {
      if (controller.signal.aborted) return;
      touch(); onDelta(delta);
    });
    return await Promise.race([work, aborted]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abortFromParent);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

/** 即使注入的流不自行响应 AbortSignal，也能取消读取并释放 reader。 */
export async function readModelChunk<T>(reader: ReadableStreamDefaultReader<T>, signal?: AbortSignal): Promise<ReadableStreamReadResult<T>> {
  if (!signal) return reader.read();
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    rejectAbort(signal.reason ?? new DOMException("已停止", "AbortError"));
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) { onAbort(); return await aborted; }
    return await Promise.race([reader.read(), aborted]);
  } finally { signal.removeEventListener("abort", onAbort); }
}

export function shouldRecoverThinking(input: {
  hasText: boolean; hasThinking: boolean; aborted: boolean; pendingTools: boolean;
  finishReason?: string; error?: string; attempts: number;
}): boolean {
  if (input.hasText || !input.hasThinking || input.aborted || input.pendingTools || input.attempts >= THINKING_ANSWER_RECOVERY_LIMIT) return false;
  if (input.finishReason && !["length", "stop"].includes(input.finishReason)) return false;
  // 鉴权/限流/上下文/协议错误不能靠再发一份回答请求修复。
  if (input.error && /HTTP\s*(?:400|401|402|403|404|409|422|429)|reasoning_content|context[_ .-]?length|content_filter|余额|权限|密钥|限流|协议错误/i.test(input.error)) return false;
  return !input.error || /超时|timeout|断流|没有正文|为空|已结束/i.test(input.error);
}
