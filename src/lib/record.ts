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
  liveTranscript: () => string;
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

  /* ---- 顺带转写（尽力而为，失败不影响录音） ---- */
  let transcript = "";
  let sr: { stop: () => void; abort?: () => void } | null = null;
  try {
    const w = window as unknown as {
      webkitSpeechRecognition?: new () => SpeechRec;
      SpeechRecognition?: new () => SpeechRec;
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (SR) {
      const r = new SR();
      r.lang = (navigator.language || "zh-CN").slice(0, 5);
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i += 1) {
          const alt = e.results[i]?.[0];
          if (alt?.transcript) text += alt.transcript;
        }
        if (text.trim()) transcript = text.trim();
      };
      r.onerror = () => {
        /* 转写失败就算了，录音照常 */
      };
      r.start();
      sr = r;
    }
  } catch {
    sr = null;
  }

  const timer = onTick
    ? window.setInterval(() => {
        const ms = Date.now() - startedAt;
        onTick(ms);
        if (ms >= MAX_MS) void finish(false);
      }, 200)
    : 0;

  function shutdown() {
    if (timer) window.clearInterval(timer);
    try {
      sr?.stop();
    } catch {
      /* ignore */
    }
    sr = null;
    for (const t of stream.getTracks()) t.stop();
  }

  async function finish(wasCancelled: boolean): Promise<Attachment | null> {
    if (finalized) return null;
    finalized = true;
    const durationMs = Date.now() - startedAt;

    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try {
        if (rec.state !== "inactive") rec.stop();
        else resolve();
      } catch {
        resolve();
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
    liveTranscript: () => transcript,
    stop: () => finish(false),
    cancel: () => {
      cancelled = true;
      void finish(true);
    },
  };
}

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: { results: Array<Array<{ transcript: string }>> }) => void)
    | null;
  onerror: ((e: unknown) => void) | null;
  start: () => void;
  stop: () => void;
};
