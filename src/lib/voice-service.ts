import { useApp } from "@/lib/store";
import {
  DS_DEFAULT_BASE,
  DS_SYSTEM_VOICES,
  DS_TTS_MODELS,
  designVoice,
  listDashscopeVoices,
  synthDashscope,
  type DsVoice,
} from "@/lib/dashscope";

/**
 * 独立的语音服务（语音转文字 + 文字转语音）。
 *
 * 为什么要它：安卓 WebView 没有语音识别；而荣耀手机的系统识别就是 YOYO ——
 * 它会自己接话、不把文字还给调用方，等于把那条路堵死（用户实测）。
 * 所以改成"栖岛自己录音 → 上传给语音服务转文字；回复 → 让语音服务合成再播放"。
 *
 * 接口是 **OpenAI 兼容**的（硅基流动就是），所以地址/key 一填就能用，
 * 跟"自定义上游"是同一套思路。
 */

export type VoiceConfig = {
  baseUrl: string;
  apiKey: string;
  asrModel: string;
  ttsModel: string;
  voice: string;
};

const DEFAULT_BASE = "https://api.siliconflow.cn/v1";
const DEFAULT_ASR = "FunAudioLLM/SenseVoiceSmall";
const DEFAULT_TTS = "FunAudioLLM/CosyVoice2-0.5B";
const DEFAULT_VOICE = "alex";

/** 从设置里取配置；没填 key 就当作"没配" */
export function voiceConfig(): VoiceConfig | null {
  const s = useApp.getState().settings;
  const key = (s.voiceApiKey ?? "").trim();
  if (!key) return null;
  const baseUrl = (s.voiceBaseUrl ?? "").trim() || DEFAULT_BASE;
  const ds = voiceProviderOf(baseUrl) === "dashscope";
  return {
    baseUrl,
    apiKey: key,
    // 百炼的转文字是另一套接口，这里先留空（只用它的合成）
    asrModel: (s.voiceAsrModel ?? "").trim() || (ds ? "" : DEFAULT_ASR),
    ttsModel: (s.voiceTtsModel ?? "").trim() || (ds ? DS_TTS_MODELS[0]! : DEFAULT_TTS),
    voice: (s.voiceTtsVoice ?? "").trim() || (ds ? DS_SYSTEM_VOICES[0]!.id : DEFAULT_VOICE),
  };
}

export function voiceConfigured(): boolean {
  return voiceConfig() !== null;
}

const join = (base: string, path: string) => `${base.replace(/\/+$/, "")}${path}`;

/**
 * **语音服务商**：按地址认。
 *
 * ⚠️ 2026-10 用户问："后续我想换 ElevenLabs 的语音模型，能使用吗" ——
 * **能，但它不是 OpenAI 形状**：它用自己的 `xi-api-key` 头、路径是
 * `/text-to-speech/{voice_id}` 与 `/speech-to-text`，音色要用 `/voices` 拉；合成出来是 mp3。
 * 所以这里先**认服务商**（地址里带 `elevenlabs.io` 就是它），下面每条路分开走。
 */
export type VoiceProvider = "openai" | "elevenlabs" | "dashscope";

export function voiceProviderOf(baseUrl: string): VoiceProvider {
  const s = baseUrl.trim();
  /**
   * 百炼（阿里）：通用域名 `dashscope.aliyuncs.com`，业务空间专属域名
   * `{workspace}.cn-beijing.maas.aliyuncs.com`。它**不是** OpenAI 形状（见 lib/dashscope.ts）。
   */
  if (/dashscope\.aliyuncs\.com|\.maas\.aliyuncs\.com/i.test(s)) return "dashscope";
  return /elevenlabs\.io/i.test(s) ? "elevenlabs" : "openai";
}

/**
 * **拉取可用的模型 / 音色**（用户："现在是硅基流动的 key，但是没做拉取模型"）。
 *
 * · OpenAI 兼容那类（硅基流动等）：`GET {base}/models` → `data[].id`；
 * · ElevenLabs：`GET {base}/voices`（它的"模型"是固定的三个，音色才是要拉的）→ `voices[].voice_id`。
 * 只读、不改任何数据；失败原因如实返回，不猜。
 */
export async function listVoiceModels(
  cfg = voiceConfig(),
): Promise<
  | {
      ok: true;
      provider: VoiceProvider;
      models: string[];
      voices: string[];
      /** 音色 id → 上游状态（`OK` / `DEPLOYING` / `UNDEPLOYED`）；只有百炼会给 */
      voiceStatus?: Record<string, string>;
    }
  | { ok: false; reason: string }
> {
  if (!cfg) return { ok: false, reason: "先在「我的 → 语音服务」填密钥" };
  const provider = voiceProviderOf(cfg.baseUrl);
  try {
    if (provider === "dashscope") {
      const r = await listDashscopeVoices({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.ttsModel,
        voice: cfg.voice,
      });
      if (!r.ok) return { ok: false, reason: r.reason };
      return {
        ok: true,
        provider,
        models: DS_TTS_MODELS,
        voices: r.voices.map((v) => v.id),
        voiceStatus: Object.fromEntries(r.voices.map((v) => [v.id, v.status])),
      };
    }
    if (provider === "elevenlabs") {
      const res = await fetch(join(cfg.baseUrl, "/voices"), { headers: { "xi-api-key": cfg.apiKey } });
      if (!res.ok) return { ok: false, reason: `ElevenLabs 音色拉取失败：HTTP ${res.status}（密钥对吗？）` };
      const j = (await res.json()) as { voices?: { voice_id?: string; name?: string }[] };
      const voices = (j.voices ?? []).map((v) => v.voice_id ?? "").filter(Boolean);
      return {
        ok: true,
        provider,
        models: ["eleven_multilingual_v2", "eleven_turbo_v2_5", "scribe_v1"],
        voices,
      };
    }
    const res = await fetch(join(cfg.baseUrl, "/models"), {
      headers: { authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) {
      /**
       * 401 的排查提示（用户 m10539："拉取硅基流动的模型不成功"，弹的是 HTTP 401）。
       *
       * 光说"地址或密钥不对"没法定位 —— 401 / 403 / 404 是三种完全不同的病：
       * · 401 = 密钥没被认（复制少了、前后带了空格、key 已经删了/重置了）
       * · 403 = 密钥认了但没权限（没开通这个模型、余额为 0）
       * · 404 = 地址不对（地址要指到服务商的 /v1，有的还要带 /openai）
       * 顺手把上游返回的那句话带上，能直接看出是哪一种。
       */
      let hint = `拉取失败：HTTP ${res.status}`;
      if (res.status === 401) {
        hint +=
          "\n密钥没被认（401）。检查：①是否复制完整（硅基流动的 key 以 sk- 开头）②前后有没有带空格或换行 ③这个 key 是不是已经被重置/删了";
      } else if (res.status === 403) {
        hint += "\n密钥被拒或没额度（403）：去服务商控制台看余额、看这个 key 有没有开通该能力";
      } else if (res.status === 404) {
        hint += `\n地址不对（404）：现在填的是 ${cfg.baseUrl}，OpenAI 兼容的地址一般以 /v1 结尾`;
      }
      try {
        const body = (await res.text()).slice(0, 120);
        if (body.trim()) hint += `\n上游原话：${body.trim()}`;
      } catch {
        /* 读不到就不带 */
      }
      return { ok: false, reason: hint };
    }
    const j = (await res.json()) as { data?: { id?: string }[] };
    const all = (j.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    /**
     * **只留语音相关的模型**（用户 m10620："这个做的是语音相关的，其他的聊天、图像模型啥的不相关的就不拉取了"）。
     *
     * 硅基流动的 `/models` 会把账号里所有模型都列出来（聊天、画图、向量、重排…），
     * 一次 98 个，对"选哪个来听我说话"这件事毫无帮助。这里按名字筛出语音类：
     *   · 识别：asr / whisper / sensevoice / transcribe / speech-to-text
     *   · 合成：tts / cosyvoice / voice / speech / moss-ttsd / fish
     * 已知能走 OpenAI 兼容语音端点的排最前（`FunAudioLLM/SenseVoiceSmall`、`CosyVoice2`），
     * 因为其余新上架的语音模型**未必**支持 `/audio/*` 接口，填进去会 400。
     */
    const VOICE_RE = /(?:asr|whisper|sensevoice|cosyvoice|tts|voice|speech|transcri|moss-ttsd|funaudiollm|paraformer)/i;
    const KNOWN = ["FunAudioLLM/SenseVoiceSmall", "FunAudioLLM/CosyVoice2-0.5B"];
    const models = all
      .filter((id) => VOICE_RE.test(id))
      .sort((a, b) => {
        const ka = KNOWN.indexOf(a);
        const kb = KNOWN.indexOf(b);
        if (ka >= 0 || kb >= 0) return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
        return a.localeCompare(b);
      });
    return { ok: true, provider, models, voices: [] };
  } catch (e) {
    return { ok: false, reason: `拉取失败：${String((e as Error)?.message ?? e).slice(0, 60)}` };
  }
}

/**
 * **"听"用哪一家**（用户 m11063 选了"混搭"：耳朵别家、嗓子百炼）。
 *
 * 百炼没有 OpenAI 形状的 `/audio/transcriptions`，所以想用它的音色又说不出话，
 * 就得让"听"单独指一家。这里返回单独配的那套；没配返回 null（跟随主配置）。
 */
export function asrConfig(): { baseUrl: string; apiKey: string; model: string } | null {
  const s = useApp.getState().settings;
  const key = (s.voiceAsrApiKey ?? "").trim();
  if (!key) return null;
  return {
    baseUrl: (s.voiceAsrBaseUrl ?? "").trim() || "https://api.siliconflow.cn/v1",
    apiKey: key,
    model: (s.voiceAsrModel ?? "").trim() || "FunAudioLLM/SenseVoiceSmall",
  };
}

/** 语音 → 文字。audio 是录下来的音频（webm/mp4 都行） */
export async function transcribe(
  audio: Blob,
  cfg = voiceConfig(),
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  /**
   * 单独配了"听"就用它 —— 这样百炼那档（只有说）也能正常语音通话：
   * 说出来的是你捏的嗓子，听你的话靠硅基流动。
   */
  const own = asrConfig();
  if (own) {
    cfg = {
      baseUrl: own.baseUrl,
      apiKey: own.apiKey,
      asrModel: own.model,
      ttsModel: "",
      voice: "",
    };
  }
  if (!cfg) return { ok: false, reason: "还没配语音服务（我的 → 语音服务）" };
  /**
   * **百炼这一档只有"说"，没有"听"**（用户 m11038 看到表里那个叉号问过）。
   *
   * 它的语音识别是另一套接口（异步任务 + 文件上传），跟这里"发一段音频给
   * `/audio/transcriptions` 拿回文字"的形状完全不同，这次没接。
   * 与其让它走到 OpenAI 分支去撞 404，不如直接说清楚怎么办。
   */
  if (voiceProviderOf(cfg.baseUrl) === "dashscope") {
    return {
      ok: false,
      reason:
        "百炼没有「听」这条接口。想让语音通话也用它：去 我的 → 系统 → 语音 → 3·百炼 → 打开「转文字借别家」，填一家的地址和密钥（推荐硅基流动的 SenseVoiceSmall），听就不受影响了。",
    };
  }
  try {
    /**
     * ⚠️ **ElevenLabs 单独一条路**（2026-10 用户要换它）：头是 `xi-api-key`（不是 Bearer）、
     * 路径 `/speech-to-text`、模型字段叫 `model_id`（默认 `scribe_v1`）。
     */
    if (voiceProviderOf(cfg.baseUrl) === "elevenlabs") {
      const eh = new FormData();
      eh.append("file", audio, audio.type.includes("mp4") ? "speech.mp4" : "speech.webm");
      eh.append("model_id", cfg.asrModel || "scribe_v1");
      const er = await fetch(join(cfg.baseUrl, "/speech-to-text"), {
        method: "POST",
        headers: { "xi-api-key": cfg.apiKey },
        body: eh,
      });
      const eraw = await er.text();
      if (!er.ok) return { ok: false, reason: `转文字失败（HTTP ${er.status}）：${eraw.slice(0, 160)}` };
      let etext = "";
      try {
        etext = ((JSON.parse(eraw) as { text?: string }).text ?? "").trim();
      } catch {
        etext = eraw.trim();
      }
      return etext ? { ok: true, text: etext } : { ok: false, reason: "服务返回了空文字" };
    }

    const form = new FormData();
    // 文件名带扩展名：有些服务靠它判断格式
    form.append("file", audio, audio.type.includes("mp4") ? "speech.mp4" : "speech.webm");
    form.append("model", cfg.asrModel);
    const res = await fetch(join(cfg.baseUrl, "/audio/transcriptions"), {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, reason: `转文字失败（HTTP ${res.status}）：${raw.slice(0, 160)}` };
    }
    let text = "";
    try {
      const j = JSON.parse(raw) as { text?: string };
      text = (j.text ?? "").trim();
    } catch {
      text = raw.trim();
    }
    return text ? { ok: true, text } : { ok: false, reason: "服务返回了空文字" };
  } catch (e) {
    return { ok: false, reason: `转文字失败：${e instanceof Error ? e.message : "网络错误"}` };
  }
}

/** 文字 → 语音；返回可以直接播放的 Blob URL */
export async function synthesize(
  text: string,
  cfg = voiceConfig(),
  opts: { instruction?: string } = {},
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  if (!cfg) return { ok: false, reason: "还没配语音服务" };
  try {
    /**
     * **百炼（阿里）**：不是 OpenAI 形状，三条路都在 `lib/dashscope.ts` 里。
     * `instruction` 只在它这里有用（另外两家没有"用一句话描述怎么念"这种参数）。
     */
    if (voiceProviderOf(cfg.baseUrl) === "dashscope") {
      return await synthDashscope(
        { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.ttsModel, voice: cfg.voice },
        text,
        opts.instruction,
      );
    }
    /**
     * ⚠️ **ElevenLabs 单独一条路**：`POST {base}/text-to-speech/{voice_id}`，
     * 头 `xi-api-key`，body 用 `model_id`，回来是 mp3。
     * 音色那格填 **voice_id**（点设置页的「拉取模型」会把第一个音色填进去）。
     */
    if (voiceProviderOf(cfg.baseUrl) === "elevenlabs") {
      const voiceId = cfg.voice || "21m00Tcm4TlvDq8ikWAM";
      const er = await fetch(join(cfg.baseUrl, `/text-to-speech/${encodeURIComponent(voiceId)}`), {
        method: "POST",
        headers: {
          "xi-api-key": cfg.apiKey,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: text.slice(0, 1200),
          model_id: cfg.ttsModel || "eleven_multilingual_v2",
        }),
      });
      if (!er.ok) {
        const eraw = await er.text();
        return { ok: false, reason: `合成失败（HTTP ${er.status}）：${eraw.slice(0, 160)}` };
      }
      const eblob = await er.blob();
      if (eblob.size === 0) return { ok: false, reason: "合成返回了空音频" };
      return { ok: true, url: URL.createObjectURL(eblob) };
    }

    const res = await fetch(join(cfg.baseUrl, "/audio/speech"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.ttsModel,
        input: text.slice(0, 1200),
        voice: cfg.voice,
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const raw = await res.text();
      return { ok: false, reason: `合成失败（HTTP ${res.status}）：${raw.slice(0, 160)}` };
    }
    const blob = await res.blob();
    if (blob.size === 0) return { ok: false, reason: "合成返回了空音频" };
    return { ok: true, url: URL.createObjectURL(blob) };
  } catch (e) {
    return { ok: false, reason: `合成失败：${e instanceof Error ? e.message : "网络错误"}` };
  }
}
