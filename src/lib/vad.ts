/**
 * 说话结束检测（轻量 VAD）—— **通话模式的"说完就走"就靠它**。
 *
 * 为什么需要它：语音服务那条路原来是"固定录 6 秒"。用户的原话是
 * "那个说完等 6 秒时间也太长" —— 你说 1 秒说完也要再等 5 秒，
 * 而真打电话是你**停下来**对方就接。
 *
 * 为什么单独一个文件、纯逻辑不碰浏览器 API：
 *   音频判定最怕"看起来对" —— 阈值、抖动、噪声底噪都要能**单独验**。
 *   这里只吃「音量值 + 时间」，不碰麦克风，所以可以直接喂合成数据做断言
 *   （见 `verify-voice-vad.mjs`）。
 *
 * 判定规则（都写成可调的常量，别散在魔法数里）：
 *   1. **先等到真有人说话**（连续 `minSpeechMs` 超过阈值）才算"开始了"——
 *      否则一上来的一段静音会被当成"说完"，秒停。
 *   2. 说过话之后，**连续 `silenceMs` 低于阈值**就算说完。
 *   3. 一句话都没说：`noSpeechMs` 之后也结束（界面才好提示"没听到"）。
 *   4. 最长 `maxMs` 兜底（说个没完也不能一直录）。
 *
 * 阈值是**自适应**的：跟一条"噪声底线"走（只往下追、缓慢回升），
 * 取 `max(最低阈值, 底噪 × 4)`。固定阈值在安静房间和嘈杂环境里总有一头不灵。
 */

export type VadDecision = "waiting" | "speaking" | "done" | "silent";

export type VadOptions = {
  /** 连续这么久没声音 = 说完了 */
  silenceMs?: number;
  /** 有声多久才算"真的在说话"（防咳嗽/敲桌子误触发） */
  minSpeechMs?: number;
  /** 一直没说话，多久后放弃 */
  noSpeechMs?: number;
  /** 最长录多久 */
  maxMs?: number;
  /** 最低音量阈值（0-1 的 RMS） */
  minThreshold?: number;
};

export type Vad = {
  push: (rms: number, nowMs: number) => VadDecision;
  /** 当前自适应阈值（调试/显示用） */
  threshold: () => number;
};

export function createVad(opts: VadOptions = {}): Vad {
  const silenceMs = opts.silenceMs ?? 600;
  const minSpeechMs = opts.minSpeechMs ?? 150;
  const noSpeechMs = opts.noSpeechMs ?? 8000;
  const maxMs = opts.maxMs ?? 20000;
  const minThreshold = opts.minThreshold ?? 0.012;

  let startedAt: number | null = null;
  /** 噪声底线：只往下追，缓慢回升（这样环境一变安静，阈值也会跟着降） */
  let floor = 0.01;
  /** 连续有声的起点 / 上一次有声的时刻 */
  let loudSince: number | null = null;
  let lastLoudAt: number | null = null;
  let spoke = false;

  function threshold() {
    return Math.max(minThreshold, floor * 4);
  }

  function push(rms: number, nowMs: number): VadDecision {
    if (startedAt === null) startedAt = nowMs;
    const t = threshold();
    const loud = rms > t;

    // 噪声底线：低了立刻跟下去；高了只是慢慢回升（避免把说话本身抬成底噪）
    floor = loud ? Math.min(floor + 0.00005, 0.1) : Math.min(rms, floor * 0.9 + rms * 0.1);

    if (loud) {
      lastLoudAt = nowMs;
      if (loudSince === null) loudSince = nowMs;
      if (!spoke && nowMs - loudSince >= minSpeechMs) spoke = true;
    } else {
      loudSince = null;
    }

    if (nowMs - startedAt >= maxMs) return "done";

    if (!spoke) {
      // 还没说过话：等太久了就当没说
      if (nowMs - startedAt >= noSpeechMs) return "silent";
      return "waiting";
    }

    if (lastLoudAt !== null && nowMs - lastLoudAt >= silenceMs) return "done";
    return "speaking";
  }

  return { push, threshold };
}

/**
 * 把一段 0-1 的波形数据算成 RMS（音量）。
 *
 * 用 `getByteTimeDomainData` 拿到的字节是"128 = 静音"的偏移量，
 * 所以先减 128 再算均方根。
 */
export function rmsOfWaveform(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const v = (bytes[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / (bytes.length || 1));
}
