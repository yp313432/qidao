import type { Attachment } from "@/lib/types";
import { uid } from "@/lib/utils";

/**
 * 语音消息：录一段，像微信那样发出去。
 *
 * 两件事同时做：
 *  1. MediaRecorder 录**真实音频** —— 气泡里能点开听，是原声不是合成。
 *  2. 浏览器的语音识别**顺带转写** —— 这样他才「听得懂」。模型本身收不到音频，
 *     文字才是他能读到的部分。转写失败不影响发送，只是他看不懂内容。
 *
 * 需要 https 或 localhost：局域网明文 http 下浏览器不给麦克风。
 */

const MAX_MS = 60_000;

export function recordSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export type Recorder = {
  startedAt: number;
  elapsed: () => number;
  /** 停止并产出附件；取消过、或没录到东西就返回 null */
  stop: () => Promise<Attachment | null>;
  cancel: () => void;
};

export async function startRecording(onTick?: (ms: number) => void): Promise<Recorder> {
  if (!recordSupported()) {
    throw new Error("这个浏览器不支持录音（需要 https 或 localhost）");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: Blob[] = [];
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";

  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const startedAt = Date.now();
  let cancelled = false;
  let finalized = false;

  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  rec.start(250);

  /**
   * ── 这里**原来**还开了一个 webkitSpeechRecognition 想"顺带转写" ──────────
   *
   * 已删除（用户报"语音时不顺畅很卡、有时候能反应过来有时候不能"）。
   *
   * 为什么必须删：**两个东西同时向系统要麦克风**。
   * MediaRecorder 已经占住了输入设备，再让 SpeechRecognition 去开一路，
   * 安卓上经常直接抛 NotReadableError，或者把录音这一路也打断 ——
   * 表现就是"时好时坏"，因为谁先抢到设备是随机的。
   *
   * 而且配了「语音服务」时**根本不需要它**：那条路是
   * "自己录音 → 上传给语音服务转文字（transcribe）"，识别在上游做，
   * 这里再开一个浏览器识别纯属多余，只会抢设备。
   *
   * 语音消息里显示的文字，现在由**语音服务**负责（voice-service.transcribe）；
   * 没配语音服务时不显示文字，但录音本身是干净、稳定的 —— 这个取舍是对的：
   * 宁可没有转写文字，也不能把录音搞坏。
   */
  const transcript = "";

  const timer = onTick
    ? window.setInterval(() => {
        const ms = Date.now() - startedAt;
        onTick(ms);
        if (ms >= MAX_MS) void finish(false);
      }, 200)
    : 0;

  function shutdown() {
    if (timer) window.clearInterval(timer);
    for (const t of stream.getTracks()) t.stop();
  }

  async function finish(wasCancelled: boolean): Promise<Attachment | null> {
    if (finalized) return null;
    finalized = true;
    const durationMs = Date.now() - startedAt;

    /**
     * 等 MediaRecorder 收尾。
     *
     * ⚠️ **必须带超时兜底**：`onstop` 在某些情况下不会触发
     * （比如还没采到任何数据就 stop、或者轨道已经被系统收走）。
     * 原来这里就是干等 —— 一旦不触发，stop() 永远挂着，
     * 界面就卡在"正在录音"，点停止/发送都没反应（用户报的"像卡住了"）。
     * 800ms 足够正常收尾，等不到就继续往下走（chunks 里有多少算多少）。
     */
    await new Promise<void>((resolve) => {
      let done = false;
      const bail = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve();
      }, 800);
      rec.onstop = () => {
        if (done) return;
        done = true;
        window.clearTimeout(bail);
        resolve();
      };
      try {
        if (rec.state !== "inactive") rec.stop();
        else {
          if (!done) {
            done = true;
            window.clearTimeout(bail);
            resolve();
          }
        }
      } catch {
        if (!done) {
          done = true;
          window.clearTimeout(bail);
          resolve();
        }
      }
    });
    shutdown();

    if (wasCancelled || cancelled || chunks.length === 0) return null;

    const blob = new Blob(chunks, { type: mime || "audio/webm" });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error ?? new Error("读音频失败"));
      fr.readAsDataURL(blob);
    });

    return {
      id: uid(),
      kind: "audio",
      name: `语音 ${Math.max(1, Math.round(durationMs / 1000))}秒`,
      mime: blob.type,
      size: blob.size,
      dataUrl,
      durationMs,
      text: transcript || undefined,
    };
  }

  return {
    startedAt,
    elapsed: () => Date.now() - startedAt,
    stop: () => finish(false),
    cancel: () => {
      cancelled = true;
      void finish(true);
    },
  };
}
