/**
 * 语音：识别（听你说）与合成（念给你听）的最小封装。
 *
 * 说明白边界：这是「说话 → 文字 → 他回 → 朗读」的回合制语音模式，
 * **不是把音频发给他听**。真语音需要支持音频的模型 + 实时通道。
 */
import { startNativeListening } from "@/lib/asr";
import { IS_APP } from "@/lib/platform";
import { startRecording } from "@/lib/record";
import { speakTextAsync } from "@/lib/tts";
import { transcribe, voiceConfigured } from "@/lib/voice-service";

/**
 * 「自己录音 → 上传转文字」这条路。
 *
 * 跟别的识别实现**同一个回调接口**，所以语音页、输入框麦克风都不用改。
 *
 * ⚠️ 2026-10 改：「固定录 6 秒」→ **说完自动停**。
 * 用户的原话："那个说完等 6 秒时间也太长" —— 你说 1 秒说完也要再等 5 秒，
 * 而真打电话是你**停下来**对方就接。现在连续静音 700ms 就收尾，
 * 最长 20 秒、一直没说话 8 秒放弃（判定逻辑在 `lib/vad.ts`，有单独验收）。
 */

/** 连续静音多久算"说完了" */
const SERVICE_SILENCE_MS = 700;
/** 一句话最长录多久（说个没完也不能一直录） */
const SERVICE_MAX_MS = 20_000;

function startServiceListening(opts: {
  lang?: string;
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (err: string) => void;
  /** 实时音量（0-1）—— 通话页拿它画"我在听"的反馈 */
  onLevel?: (rms: number) => void;
}): ListenHandle | null {
  let aborted = false;
  let harvested = false;
  let rec: { done: Promise<unknown>; stop: () => Promise<unknown>; cancel: () => void } | null = null;

  /**
   * ⚠️ 这里踩过一个**真的把麦克风占死的竞态 bug**（用户："想结束或发送都不行，
   * 像卡了一样"、"时好时坏"）：
   *
   *   startRecording 要 await getUserMedia（第一次还要等权限弹窗），是**慢的**。
   *   而当时有个 6 秒定时器是**立刻**挂上的。
   *   如果 6 秒先到，finish() 里 `const r = rec` 拿到的还是 null →
   *   直接 return、**什么都没停**；随后 rec 才被赋值 → 录音真的开始了，但永远没人停它。
   *   结果：麦克风一直被占着，界面停在"正在录音"，点停止也没反应。
   *
   * 修法：把"已经决定要停"这个意图独立记成 `aborted`，
   * 录音**姗姗来迟**时立刻发现"哦我已经该停了"，当场把它停掉、把麦克风释放。
   * （现在定时器没了，但这个守卫仍然要留着 —— 用户随时可能在权限弹窗上点停止。）
   */
  void (async () => {
    try {
      const r = (await startRecording(() => undefined, {
        stopOnSilenceMs: SERVICE_SILENCE_MS,
        maxMs: SERVICE_MAX_MS,
        onLevel: opts.onLevel,
      })) as unknown as {
        done: Promise<unknown>;
        stop: () => Promise<unknown>;
        cancel: () => void;
      };
      // 迟到的录音：如果这期间已经按过停止，立刻收掉，别占着麦克风
      if (aborted) {
        try {
          r.cancel();
        } catch {
          /* ignore */
        }
        return;
      }
      rec = r;
      opts.onPartial?.("（在听你说…你停一下我就接）");
      await harvest(r);
    } catch (e) {
      opts.onError?.(`录不了音：${e instanceof Error ? e.message : "麦克风打不开"}`);
      opts.onEnd?.();
    }
  })();

  /**
   * 等这段录音结束（说完自动停 / 手动停 / 到上限都会让它落地），然后转文字。
   * 只跑一次 —— 自动停和手动停可能几乎同时发生，重复转写会白花钱。
   */
  async function harvest(r: { done: Promise<unknown> }): Promise<void> {
    if (harvested) return;
    harvested = true;
    try {
      const att = (await r.done) as { dataUrl?: string } | null;
      if (aborted) return;
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
      if (!aborted) opts.onError?.(`转文字出错：${e instanceof Error ? e.message : "未知"}`);
    }
    if (!aborted) opts.onEnd?.();
  }

  return {
    stop: () => {
      // 手动停：让录音收尾，harvest 接着往下走
      const r = rec;
      if (!r) {
        aborted = true;
        opts.onEnd?.();
        return;
      }
      void r.stop();
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
  /**
   * 实时音量（0-1）—— 给通话页的波形用。
   * 只有"自己录音 → 上传转文字"那条路会给（它是我们自己在分析麦克风）；
   * 系统识别那两条路拿不到电平，所以是可选参数。
   */
  onLevel?: (rms: number) => void;
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
