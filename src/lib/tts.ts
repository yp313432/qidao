/**
 * 朗读（TTS）。集中放这里，因为「点了没声」有四种不同死法，
 * 散落在各处只会一遍遍踩：
 *
 *   1. **语音包还没加载** —— `getVoices()` 首次常常返回空数组（浏览器异步加载），
 *      这时 `speak()` 静默无效。要等一次 `voiceschanged`。
 *   2. **cancel() 抢跑** —— `cancel()` 紧接着同 tick 的 `speak()`，
 *      在 iOS 上会把这次朗读一起吞掉。必须隔一拍。
 *   3. **卡在 paused** —— 某些浏览器朗读状态会卡住，要 `resume()` 解一下。
 *   4. **设备根本没有语音包** —— 唯一正确的做法是**如实告诉用户**，
 *      而不是让他反复点一个永远不会响的按钮。
 *
 * 全 App 只有这一个朗读实现：英语卡的喇叭、消息「朗读」、语音模式、
 * AI 的 speak 动作，都走这里。
 *
 * 注意：**不要**在 await 之后再调 `speakText` —— iOS 要求在用户手势的
 * 同一拍里调用，中间隔了异步就会静默失败。所以它是同步函数。
 * （App 里没有 speechSynthesis，要用下面的 `speakTextAsync`。）
 */
import { IS_APP } from "@/lib/platform";
import { useApp } from "@/lib/store";
import { synthesize, voiceConfigured } from "@/lib/voice-service";

export type SpeakResult = { ok: true } | { ok: false; reason: string };

/* ------------------------- App 里的原生朗读（安卓系统 TTS）------------------------- */

type NativeTts = {
  speak: (opts: {
    text: string;
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
  }) => Promise<void>;
};

let nativeTtsCache: { api: NativeTts } | null | undefined;

/**
 * 拿到原生朗读插件。
 *
 * ⚠️ 和通知那边同一个坑：Capacitor 的插件对象是 thenable，
 * 从一个 async 函数里直接 return 它，JS 会当 Promise 去调 `.then()` →
 * 抛 "…then() is not implemented on web"。所以**必须包一层**。
 */
async function nativeTts(): Promise<{ api: NativeTts } | null> {
  if (!IS_APP) return null;
  if (nativeTtsCache !== undefined) return nativeTtsCache;
  try {
    const mod = await import("@capacitor-community/text-to-speech");
    nativeTtsCache = { api: mod.TextToSpeech as unknown as NativeTts };
  } catch {
    nativeTtsCache = null;
  }
  return nativeTtsCache;
}

/**
 * 朗读的**统一入口**（异步）。
 *
 * App 里 WebView 根本没有 `speechSynthesis` —— 所以必须走安卓系统的朗读引擎，
 * 否则用户点那个喇叭只会得到一句"这个浏览器不支持朗读"（他手机上明明有语音）。
 * 网页版仍然走浏览器那套。
 */
export async function speakTextAsync(
  text: string,
  opts: SpeakOptions = {},
): Promise<SpeakResult> {
  const clean = text.trim();
  if (!clean) {
    opts.onEnd?.();
    return { ok: false, reason: "没内容可读" };
  }

  /**
   * 配了**语音服务**就用它家的音色（我的 → 语音服务）。
   * 好处：音色可选、声音更像真人，而且是同一家给"识别"和"合成"，
   * 用户只要填一次地址和 key ✅
   */
  if (voiceConfigured()) {
    const out = await synthesize(clean);
    if (out.ok) {
      try {
        const audio = new Audio(out.url);
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        });
        URL.revokeObjectURL(out.url);
        opts.onEnd?.();
        return { ok: true };
      } catch (e) {
        URL.revokeObjectURL(out.url);
        opts.onEnd?.();
        return { ok: false, reason: e instanceof Error ? e.message : "播放失败" };
      }
    }
    // 合成失败就退回系统语音，别让"点了没声" —— 但把原因带回去
    const fallback = await speakSystem(clean, opts);
    return fallback.ok ? fallback : { ok: false, reason: `${out.reason}；${fallback.reason}` };
  }

  return speakSystem(clean, opts);
}

/** 系统语音（安卓 TTS / 浏览器 speechSynthesis）—— 没配语音服务时走它 */
async function speakSystem(clean: string, opts: SpeakOptions): Promise<SpeakResult> {
  const native = await nativeTts();
  if (native) {
    try {
      await native.api.speak({
        text: clean,
        lang: opts.lang ?? guessLang(clean),
        // 语速/音调从设置里读（用户在「我的 → 语音」里调过就用他的）
        rate: opts.rate ?? useApp.getState().settings.voiceRate ?? 0.95,
        pitch: opts.pitch ?? useApp.getState().settings.voicePitch ?? 1,
        volume: 1,
      });
    } catch (err) {
      opts.onEnd?.();
      return {
        ok: false,
        reason: `读不出来：${(err as Error).message || "系统朗读引擎没响应"}`,
      };
    }
    opts.onEnd?.();
    return { ok: true };
  }

  return speakText(clean, opts);
}

export type SpeakOptions = {
  /** 不传就按内容猜：有中文用 zh-CN，否则 en-US */
  lang?: string;
  /** 读完（或出错）时回调 —— 语音模式的免手持循环靠它接下一步 */
  onEnd?: () => void;
  /** 语速，默认 0.95（略慢一点更适合跟读） */
  rate?: number;
  /** 音调，默认 1（不传就用设置里那个） */
  pitch?: number;
};

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** 按内容猜语言：有汉字就中文，否则英文。 */
export function guessLang(text: string): string {
  return /[\u4e00-\u9fa5]/.test(text) ? "zh-CN" : "en-US";
}

/** 挑一个和 lang 匹配的语音；没有就退到同语种的，再没有交给浏览器默认。 */
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (!ttsSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const want = lang.toLowerCase();
  const prefix = want.slice(0, 2);
  return (
    voices.find((v) => v.lang.toLowerCase() === want) ??
    voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix)) ??
    voices.find((v) => v.default) ??
    null
  );
}

export function speakText(text: string, opts: SpeakOptions = {}): SpeakResult {
  const sync = opts.onEnd;
  if (!ttsSupported()) {
    sync?.();
    return { ok: false, reason: "这个浏览器不支持朗读" };
  }
  const synth = window.speechSynthesis;
  const clean = text.trim();
  if (!clean) {
    sync?.();
    return { ok: false, reason: "没内容可读" };
  }

  // 有些浏览器会卡在 paused，先解一下
  try {
    synth.resume();
  } catch {
    /* 忽略 */
  }

  const lang = opts.lang ?? guessLang(clean);
  const voice = pickVoice(lang);
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = voice?.lang ?? lang;
  if (voice) u.voice = voice;
  u.rate = opts.rate ?? useApp.getState().settings.voiceRate ?? 0.95;
  u.pitch = opts.pitch ?? useApp.getState().settings.voicePitch ?? 1;
  // 用户指定了音色就用它，否则让浏览器自己挑
  const wantVoice = useApp.getState().settings.voiceURI;
  if (wantVoice) {
    const v = window.speechSynthesis.getVoices().find((x) => x.voiceURI === wantVoice);
    if (v) u.voice = v;
  }
  u.volume = 1;
  let ended = false;
  const done = () => {
    if (ended) return;
    ended = true;
    sync?.();
  };
  u.onend = done;
  u.onerror = done;

  const busy = synth.speaking || synth.pending;
  const say = () => {
    try {
      synth.speak(u);
    } catch {
      done();
    }
  };

  if (busy) {
    // 隔一拍再读 —— 同 tick 的 cancel+speak 在 iOS 上会把这次朗读吞掉
    synth.cancel();
    window.setTimeout(say, 80);
  } else {
    say();
  }

  if (synth.getVoices().length === 0) {
    return {
      ok: false,
      reason: "这台设备好像没装语音包（系统设置里装一个朗读引擎就有声了）",
    };
  }
  return { ok: true };
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/**
 * 预热：进入朗读相关页面时调一次，把浏览器异步加载的语音包「叫醒」，
 * 这样用户第一次点就有声（否则第一次点常常是哑的）。
 */
export function warmUpVoices(): void {
  if (!ttsSupported()) return;
  const synth = window.speechSynthesis;
  if (synth.getVoices().length > 0) return;
  const once = () => {
    synth.getVoices();
    synth.removeEventListener("voiceschanged", once);
  };
  synth.addEventListener("voiceschanged", once);
  window.setTimeout(() => synth.getVoices(), 600);
}
