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
 * ⚠️ 2026-10 用户 m10646："把系统自带的语音删了吧，语音之后只考虑接其他家的" ——
 * **安卓系统 TTS 已经移除**（那是 YOYO 的声音）。App 里只认「我的 → 语音服务」接的那家；
 * 合成失败就**如实报错**，绝不悄悄用系统声音顶替（否则用户会以为"换音色没效果"）。
 * 网页版没有"手机自带语音"这回事，仍保留浏览器 speechSynthesis。
 *
 * 注意：**不要**在 await 之后再调 `speakText` —— iOS 要求在用户手势的
 * 同一拍里调用，中间隔了异步就会静默失败。所以它是同步函数。
 * （App 里没有 speechSynthesis，要用下面的 `speakTextAsync`。）
 */
import { IS_APP } from "@/lib/platform";
import { useApp } from "@/lib/store";
import { synthesize, voiceConfigured } from "@/lib/voice-service";
import { instructionOfEmotion } from "@/lib/dashscope";

export type SpeakResult = { ok: true } | { ok: false; reason: string };

/**
 * 合成时那句"怎么念"（情绪 + 语速/音调）。
 *
 * 系统 TTS 删掉之后，`voiceRate` / `voicePitch` 两个滑杆原来只喂给
 * `SpeechSynthesisUtterance` —— 已经不起作用了。百炼吃自然语言 `instruction`，
 * 所以把这两个值翻成人话捎上；别的家不认这个参数就自然忽略，不会报错。
 */
export function voiceInstruction(): string {
  const st = useApp.getState();
  const bits: string[] = [];
  if (st.settings.voiceEmotionTags !== false) {
    const last = st.emotionEvents?.[st.emotionEvents.length - 1];
    const emo = instructionOfEmotion(last?.group);
    if (emo) bits.push(emo);
  }
  const rate = st.settings.voiceRate ?? 0.95;
  if (rate < 0.88) bits.push("语速比平常慢一些");
  else if (rate > 1.12) bits.push("语速比平常快一些");
  const pitch = st.settings.voicePitch ?? 1;
  if (pitch < 0.9) bits.push("音调比平常低一些、更沉稳");
  else if (pitch > 1.12) bits.push("音调比平常高一些、更年轻");
  return bits.join("；");
}

export type VoiceBubbleAudio =
  | { ok: true; dataUrl: string; durationMs: number }
  | { ok: false; reason: string };

/**
 * 合成一段**能存进消息里**的语音（用户 m11313：语音气泡）。
 *
 * 和 `speakTextAsync` 的区别：那个是"合成完立刻播出去"，播完就把 blob 还掉了；
 * 气泡要的是**留着的数据**——所以他回消息时用它，合成完转成 dataURL 存进附件。
 */
export async function synthesizeVoiceBubble(text: string): Promise<VoiceBubbleAudio> {
  const clean = text.trim();
  if (!clean) return { ok: false, reason: "没内容可合成" };
  if (!voiceConfigured()) return { ok: false, reason: "还没配语音服务（我的 → 系统 → 语音）" };
  const out = await synthesize(clean, undefined, { instruction: voiceInstruction() });
  if (!out.ok) return { ok: false, reason: out.reason };
  try {
    const res = await fetch(out.url);
    if (!res.ok) return { ok: false, reason: `取音频失败：HTTP ${res.status}` };
    const blob = await res.blob();
    if (!blob.size) return { ok: false, reason: "合成回来了，但音频是空的" };
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result ?? ""));
      fr.onerror = () => reject(new Error("读不出音频数据"));
      fr.readAsDataURL(blob);
    });
    // 时长：按中文约 4 字/秒、再乘语速系数估（真实时长由播放器自己算）
    const rate = useApp.getState().settings.voiceRate ?? 0.95;
    const durationMs = Math.max(1000, Math.round((clean.length / (4 * rate)) * 1000));
    return { ok: true, dataUrl, durationMs };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "合成音频取不出来" };
  } finally {
    URL.revokeObjectURL(out.url);
  }
}

/**
 * 正在播的那一段音频（语音服务合成的 mp3）。
 *
 * ⚠️ 为什么必须留这个句柄：`new Audio(url).play()` 播出去之后**没有任何办法停** ——
 * `stopSpeaking()` 原来只 cancel 浏览器自带 TTS，对这条音频完全无效。
 * 后果很具体：通话里你想打断他、或者按挂断，他还在那儿把话念完。
 */
let currentAudio: HTMLAudioElement | null = null;
/** 让"等这段音频播完"的那个 promise 立刻落地（否则调用方会一直等） */
let abortCurrent: (() => void) | null = null;

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
    /**
     * **按情绪调整语气**（用户 m10841："这个百炼是千问的语音模型…情绪标签是啥意思"）。
     *
     * 只在百炼那条路上有意义：它支持 `instruction`（一句自然语言描述怎么念）。
     * 拿的是**最近一次情绪上报**的 group —— 他刚说"心跳快了一下"，下一句就该轻一点。
     * 读不到/关掉了就传空，平着念（宁可平，也不要瞎加）。
     */
    const instruction = voiceInstruction();
    const out = await synthesize(clean, undefined, { instruction });
    if (out.ok) {
      try {
        const audio = new Audio(out.url);
        /**
         * 播放失败**不能当成成功**（用户 m11226："还是没有声音"）。
         *
         * 原来 `onerror` 和 `play().catch()` 都只是 resolve，函数照样返回
         * `{ ok: true }` —— 于是界面上写"念出来了"，用户却什么都没听到，
         * 而且连个原因都没有。这里把失败原因带出去。
         */
        let playbackError: string | null = null;
        await new Promise<void>((resolve) => {
          /**
           * ⚠️ **必须有超时兜底**（用户："语音对话不顺畅、有时候能反应过来有时候不能"）。
           *
           * 语音模式是"念完 → onEnd → 继续听"的免手持循环，全靠这里 resolve。
           * 但 `onended` 在几种情况下**永远不触发**：
           *   · 播放被系统/别的 App 打断
           *   · 音频被暂停后没有恢复
           *   · 流式 mp3 的时长元信息缺失，播完了也不发事件
           * 一旦不触发，promise 永远挂着 → 界面卡在"正在说话" → 整个对话停死。
           * 这就是"有时候能反应过来，有时候不能"。
           *
           * 兜底时长：报告的音频时长 + 3 秒余量；拿不到时长就按文字长度估
           * （中文约 4 字/秒，语速 0.95 慢一点，给足余量）。
           */
          const textEstimateSec = Math.max(3, clean.length / 4);
          const budgetMs = Math.max(
            5000,
            ((Number.isFinite(audio.duration) && audio.duration > 0
              ? audio.duration
              : textEstimateSec) +
              3) *
              1000,
          );
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            window.clearTimeout(bail);
            resolve();
          };
          const bail = window.setTimeout(finish, budgetMs);
          audio.onended = finish;
          audio.onerror = () => {
            playbackError = playbackError ?? "播放器报错（音频可能损坏，或被系统拦了）";
            finish();
          };
          // 记下"正在播的这段" —— stopSpeaking() 靠它真的把声音掐掉
          currentAudio = audio;
          abortCurrent = finish;
          void audio.play().catch(() => {
            playbackError = playbackError ?? "播放被系统拦下（可能没给音频权限）";
            finish();
          });
        });
        currentAudio = null;
        abortCurrent = null;
        URL.revokeObjectURL(out.url);
        opts.onEnd?.();
        if (playbackError) return { ok: false, reason: playbackError };
        return { ok: true };
      } catch (e) {
        currentAudio = null;
        abortCurrent = null;
        URL.revokeObjectURL(out.url);
        opts.onEnd?.();
        return { ok: false, reason: e instanceof Error ? e.message : "播放失败" };
      }
    }
    /**
     * **不回落**（用户 m10646 明确要求）。以前这里会 `speakSystem()` 兜底，
     * 结果用户听到的永远是手机自带的 YOYO，还以为"换了音色没区别"。
     * 现在把失败原因原样交回去，界面上直接显示「合成失败：HTTP 400 …」。
     */
    opts.onEnd?.();
    return { ok: false, reason: out.reason };
  }

  /**
   * 没配语音服务：App 里**没有声音**（系统 TTS 已删），要明确告诉他去配；
   * 网页版仍用浏览器朗读（它没有"手机自带语音"这个问题）。
   */
  if (IS_APP) {
    opts.onEnd?.();
    return { ok: false, reason: "还没配语音服务（我的 → 语音服务）。系统自带语音已移除。" };
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

/**
 * 立刻停下正在念的声音 —— **三条路都要掐**：
 *   ① 浏览器自带 TTS（speechSynthesis）
 *   ② 语音服务合成的那段 mp3（`Audio` 元素，没有句柄就停不了）
 *   ③ 安卓原生朗读引擎
 *
 * 通话模式里"插话/挂断"全靠它；少掐一条，用户就会遇到
 * "我都按挂断了，他还在念"。
 */
export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      /* 已经停了 */
    }
    currentAudio = null;
  }
  abortCurrent?.();
  abortCurrent = null;
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
