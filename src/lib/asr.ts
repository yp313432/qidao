import { IS_APP } from "@/lib/platform";

/**
 * 原生语音识别（安卓系统自带的识别引擎）。
 *
 * 为什么必须走原生：**安卓 WebView 根本没有 SpeechRecognition** ——
 * 代码里那一套 webkitSpeechRecognition 在 App 里永远拿不到结果，
 * 于是用户看到的就是"识别不到你的声音 / 转文字是空的 / 语音条也不行"。
 *
 * 插件是 @capacitor-community/speech-recognition（走系统识别引擎，
 * 所以中文识别质量取决于手机装的语音服务，通常是 Google 或厂商自带的）。
 */

type SrApi = {
  available: () => Promise<{ available: boolean }>;
  getSupportedLanguages: () => Promise<{ languages?: string[] }>;
  checkPermissions: () => Promise<{ speechRecognition?: string }>;
  requestPermissions: () => Promise<{ speechRecognition?: string }>;
  start: (o?: {
    language?: string;
    maxResults?: number;
    partialResults?: boolean;
    popup?: boolean;
  }) => Promise<{ matches?: string[] }>;
  stop: () => Promise<void>;
  addListener: (
    event: string,
    cb: (data: { matches?: string[] }) => void,
  ) => { remove?: () => void } | Promise<{ remove?: () => void }>;
};

/**
 * ⚠️ 跟通知/定位插件一样：Capacitor 的插件对象是 thenable，
 * 从 async 函数里直接 return 它会被当成 Promise（那个坑踩过三次了）。
 */
export async function srApi(): Promise<{ api: SrApi } | null> {
  if (!IS_APP) return null;
  try {
    const mod = await import("@capacitor-community/speech-recognition");
    return { api: mod.SpeechRecognition as unknown as SrApi };
  } catch {
    return null;
  }
}

export type NativeListenOpts = {
  lang?: string;
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (err: string) => void;
};

export type NativeListenHandle = { stop: () => void };

/** 原生识别：说一句 → 出文字。返回句柄，拿不到引擎时返回 null（调用方回退）。 */
export function startNativeListening(opts: NativeListenOpts): NativeListenHandle | null {
  if (!IS_APP) return null;
  let cancelled = false;
  let stopFn: (() => void) | null = null;

  void (async () => {
    const w = await srApi();
    if (!w) {
      opts.onError?.("这个版本没接上语音识别，装最新版再试");
      opts.onEnd?.();
      return;
    }
    try {
      const perm = await w.api.checkPermissions();
      if (perm.speechRecognition !== "granted") {
        const asked = await w.api.requestPermissions();
        if (asked.speechRecognition !== "granted") {
          opts.onError?.("你还没允许录音权限");
          opts.onEnd?.();
          return;
        }
      }
      const avail = await w.api.available();
      if (!avail.available) {
        opts.onError?.("这台手机没有可用的语音识别引擎（去系统设置里装一个语音服务）");
        opts.onEnd?.();
        return;
      }

      stopFn = () => {
        void w.api.stop().catch(() => undefined);
      };

      let partial = "";
      const raw = w.api.addListener("partialResults", (d) => {
        const m = d?.matches?.[0];
        if (m) {
          partial = m;
          opts.onPartial?.(m);
        }
      });
      // 有的版本 addListener 返回 Promise，有的直接返回句柄 —— 两种都兼容
      const listener = raw && typeof (raw as Promise<unknown>).then === "function"
        ? await (raw as Promise<{ remove?: () => void }>)
        : (raw as { remove?: () => void });

      const res = await w.api.start({
        language: opts.lang ?? "zh-CN",
        maxResults: 1,
        partialResults: true,
        popup: false,
      });

      try {
        listener?.remove?.();
      } catch {
        /* ignore */
      }
      if (cancelled) {
        opts.onEnd?.();
        return;
      }
      const text = (res?.matches?.[0] ?? partial ?? "").trim();
      if (text) opts.onFinal(text);
      else {
        /**
         * 没拿到文字时，带上**足够定位的信息**。
         * 用户之前只能看到"没听到你说什么"，看不出到底是引擎没采到、
         * 语言不支持、还是权限问题 —— 那种提示等于没说。
         */
        const langs = await w.api
          .getSupportedLanguages()
          .then((r) => (r?.languages ?? []).slice(0, 6).join("/"))
          .catch(() => "");
        opts.onError?.(
          `引擎没采到声音（语言=${opts.lang ?? "zh-CN"}${langs ? `，引擎支持：${langs}` : ""}` +
            `，返回=${JSON.stringify(res ?? null).slice(0, 60)}）`,
        );
      }
      opts.onEnd?.();
    } catch (e) {
      opts.onError?.(e instanceof Error ? e.message : "识别失败");
      opts.onEnd?.();
    }
  })();

  return {
    stop: () => {
      cancelled = true;
      stopFn?.();
    },
  };
}
