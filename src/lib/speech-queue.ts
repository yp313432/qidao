/**
 * 句子级"边说边念" —— **通话模式的核心**。
 *
 * 原来的做法是"等他整段回完 → 一次性合成 → 播放"，
 * 所以到听见第一个字要等：转写 + **整段生成** + 合成。
 * 现在改成：模型的话本来就是流式出来的，**凑满一句就送去合成、成一句念一句**，
 * 第一句在播的时候后面几段并行合成 —— 到听见第一个字只差"首句生成 + 合成"。
 *
 * 两件事分开写是有意的：
 *   · `createSentenceStreamer` 是**纯逻辑**（切句子），能喂合成数据单独验；
 *   · `createSpeechQueue` 负责排队播放（真正调 TTS 的地方），
 *     复用 `tts.ts` 的 `speakTextAsync` —— 它已经处理好了"语音服务 / 系统 TTS"
 *     两条路和"播完才 resolve"，所以这里只做顺序，不重复造轮子。
 */
import { speakTextAsync, stopSpeaking } from "@/lib/tts";

/** 硬边界：句号/问号/感叹号/分号/换行 */
const HARD_BOUNDARY = /[。！？!?；;\n]/;
/** 软边界：一句话太长时按逗号先断开，免得首句迟迟不出声 */
const SOFT_BOUNDARY = /[，,、：:]/;
/** 一句超过这么多字就先断（中文 TTS 一句话太长，听起来也累） */
const MAX_CHUNK = 60;

export type SentenceStreamer = {
  /** 追加流式文本，返回**这次新凑齐**的完整句子 */
  push: (chunk: string) => string[];
  /** 流结束了，把剩下的尾巴交出来（最后一句可能没有标点） */
  flush: () => string;
  reset: () => void;
};

export function createSentenceStreamer(): SentenceStreamer {
  let buffer = "";

  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const out: string[] = [];

      // ① 先按硬边界切干净
      for (;;) {
        const m = buffer.match(HARD_BOUNDARY);
        if (!m || m.index === undefined) break;
        const sentence = buffer.slice(0, m.index + 1).trim();
        buffer = buffer.slice(m.index + 1);
        if (sentence) out.push(sentence);
      }

      // ② 剩下这一大段迟迟没有句号：退一步在逗号处断，别让首句无限等
      while (buffer.length > MAX_CHUNK) {
        const head = buffer.slice(0, MAX_CHUNK);
        const soft = [...head.matchAll(new RegExp(SOFT_BOUNDARY, "g"))].pop();
        const cut = soft?.index !== undefined ? soft.index + 1 : MAX_CHUNK;
        const sentence = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut);
        if (sentence) out.push(sentence);
      }

      return out;
    },

    flush(): string {
      const rest = buffer.trim();
      buffer = "";
      return rest;
    },

    reset() {
      buffer = "";
    },
  };
}

export type SpeechQueue = {
  /** 追加一句（立刻开始排队播放；第一次调用就会出声） */
  push: (text: string) => void;
  /** 立刻全停（打断 / 挂断 / 离开页面） */
  stop: () => void;
  /** 新一轮开始前清掉上轮的停用状态 */
  reset: () => void;
  /** 还有没有没念完的 */
  speaking: () => boolean;
};

/**
 * 播放队列：一句接一句地念，**不重叠**（重叠会听成结巴）。
 * 全部念完调 `onIdle` —— 语音页靠它回到"继续听"。
 */
export function createSpeechQueue(opts: {
  lang?: () => string;
  onIdle?: () => void;
}): SpeechQueue {
  const queue: string[] = [];
  let running = false;
  let stopped = false;
  let playedAnything = false;

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (!stopped && queue.length > 0) {
        const text = queue.shift() as string;
        // speakTextAsync 是"合成 → 播放 → 播完才 resolve"（内部还有超时兜底），
        // 所以这里不需要自己管音频对象
        await speakTextAsync(text, { lang: opts.lang?.() });
      }
    } finally {
      running = false;
      // 被 stop() 打断时**不要再**喊"念完了"，否则会立刻开始听下一轮
      if (!stopped && playedAnything) opts.onIdle?.();
    }
  }

  return {
    push(text: string) {
      const t = text.trim();
      if (!t || stopped) return;
      playedAnything = true;
      queue.push(t);
      void pump();
    },
    stop() {
      stopped = true;
      queue.length = 0;
      stopSpeaking();
    },
    reset() {
      stopped = false;
      playedAnything = false;
      queue.length = 0;
    },
    speaking() {
      return running || queue.length > 0;
    },
  };
}
