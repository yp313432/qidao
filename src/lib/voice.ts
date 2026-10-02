/**
 * 语音：识别（听你说）与合成（念给你听）的最小封装。
 *
 * 说明白边界：这是「说话 → 文字 → 他回 → 朗读」的回合制语音模式，
 * **不是把音频发给他听**。真语音需要支持音频的模型 + 实时通道。
 */
import { startNativeListening } from "@/lib/asr";
import { IS_APP } from "@/lib/platform";
import { startRecording } from "@/lib/record";
import { speakTextAsync, speakText } from "@/lib/tts";
import { transcribe, voiceConfigured } from "@/lib/voice-service";

/**
 * 「自己录音 → 上传转文字」这条路。
 *
 * 跟别的识别实现**同一个回调接口**，所以语音页、输入框麦克风都不用改。
 * 录多久：默认 6 秒自动停（也可以在界面上手动停）。
 * 为什么不做"静音自动断"：那要接 AnalyserNode 判音量，代码多、还容易误判，
 * 先用固定时长 —— 界面上有秒数，用户看得见。
 */
const SERVICE_RECORD_MS = 6000;

function startServiceListening(opts: {
  lang?: string;
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (err: string) => void;
}): ListenHandle | null {
  let stopped = false;
  let rec: { stop: () => Promise<unknown>; cancel: () => void } | null = null;

  void (async () => {
    try {
      rec = (await startRecording(() => undefined)) as unknown as {
        stop: () => Promise<unknown>;
        cancel: () => void;
      };
      opts.onPartial?.("（录音中…说完等一下，6 秒后自动停）");
      window.setTimeout(() => {
        if (!stopped) void finish();
      }, SERVICE_RECORD_MS);
    } catch (e) {
      opts.onError?.(`录不了音：${e instanceof Error ? e.message : "麦克风打不开"}`);
      opts.onEnd?.();
    }
  })();

  async function finish() {
    if (stopped) return;
    stopped = true;
    const r = rec;
    rec = null;
    if (!r) return;
    try {
      const att = (await r.stop()) as { dataUrl?: string } | null;
      if (!att?.dataUrl) {
        opts.onError?.("没录到声音");
        opts.onEnd?.();
        return;
      }
      const blob = await (await fetch(att.dataUrl)).blob();
      const out = await transcribe(blob);
      if (out.ok) opts.onFinal(out.text);
      else opts.onError?.(out.reason);
    } catch (e) {
      opts.onError?.(`转文字出错：${e instanceof Error ? e.message : "未知"}`);
    }
    opts.onEnd?.();
  }

  return {
    stop: () => {
      void finish();
    },
  };
}

type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function RecognitionCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    webkitSpeechRecognition?: new () => SpeechRec;
    SpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function sttSupported(): boolean {
  // App 里走**原生**识别（安卓 WebView 没有 SpeechRecognition），所以照样算支持
  if (IS_APP) return true;
  return Boolean(RecognitionCtor());
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export type ListenHandle = { stop: () => void };

/** 听一次（说完自动结束）。返回句柄，失败返回 null。 */
export function startListening(opts: {
  lang?: string;
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (err: string) => void;
}): ListenHandle | null {
  /**
   * ① 配了**语音服务**（我的 → 语音服务）→ 走"自己录音 → 上传转文字"。
   *
   * 这是唯一在荣耀这类手机上真能用的路：安卓 WebView 没有 SpeechRecognition，
   * 系统识别又被 YOYO 接管（它自己接话、不还文字，用户实测）。
   */
  if (voiceConfigured()) return startServiceListening(opts);

  // ② App 里退而求其次走原生识别（别的机型可能正常）
  const native = startNativeListening(opts);
  if (native) return native;

  const Ctor = RecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = opts.lang ?? "zh-CN";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let final = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const r = e.results[i]!;
      const t = r[0]?.transcript ?? "";
      if (r.isFinal) final += t;
      else interim += t;
    }
    const shown = `${final}${interim}`.trim();
    if (shown) opts.onPartial?.(shown);
  };
  rec.onerror = (e) => opts.onError?.(e?.error ?? "unknown");
  rec.onend = () => {
    const text = final.trim();
    if (text) opts.onFinal(text);
    opts.onEnd?.();
  };

  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* 已经停了 */
      }
    },
  };
}

/** 去掉 markdown，让朗读听起来自然些。 */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "。代码块我略过了。")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>\-*+\d.\s]+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\n{2,}/g, "。")
    .replace(/\n/g, "，")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 600);
}

/** 语音语言候选。auto = 跟随系统。 */
export const VOICE_LANGS = [
  { id: "auto", label: "跟随系统" },
  { id: "zh-CN", label: "中文" },
  { id: "en-US", label: "English" },
  { id: "ja-JP", label: "日本語" },
  { id: "ko-KR", label: "한국어" },
];

/** 把设置里的语言选项解析成真正的 BCP-47 语言标签。 */
export function resolveVoiceLang(id: string): string {
  if (id && id !== "auto") return id;
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return "zh-CN";
}

export function speak(
  text: string,
  opts: { lang?: string; onEnd?: () => void } = {},
): void {
  if (!ttsSupported()) {
    opts.onEnd?.();
    return;
  }
  const clean = cleanForSpeech(text);
  if (!clean) {
    opts.onEnd?.();
    return;
  }
  // 统一走 lib/tts —— App 里会自动落到安卓系统朗读引擎上
  void speakTextAsync(clean, { lang: opts.lang, onEnd: opts.onEnd }).then((r) => {
    if (!r.ok) opts.onEnd?.();
  });
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}
