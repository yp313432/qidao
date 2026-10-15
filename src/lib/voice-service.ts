import { useApp } from "@/lib/store";

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
  return {
    baseUrl: (s.voiceBaseUrl ?? "").trim() || DEFAULT_BASE,
    apiKey: key,
    asrModel: (s.voiceAsrModel ?? "").trim() || DEFAULT_ASR,
    ttsModel: (s.voiceTtsModel ?? "").trim() || DEFAULT_TTS,
    voice: (s.voiceTtsVoice ?? "").trim() || DEFAULT_VOICE,
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
export type VoiceProvider = "openai" | "elevenlabs";

export function voiceProviderOf(baseUrl: string): VoiceProvider {
  return /elevenlabs\.io/i.test(baseUrl.trim()) ? "elevenlabs" : "openai";
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
  { ok: true; provider: VoiceProvider; models: string[]; voices: string[] } | { ok: false; reason: string }
> {
  if (!cfg) return { ok: false, reason: "先在「我的 → 语音服务」填密钥" };
  const provider = voiceProviderOf(cfg.baseUrl);
  try {
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
    if (!res.ok) return { ok: false, reason: `拉取失败：HTTP ${res.status}（地址或密钥不对？）` };
    const j = (await res.json()) as { data?: { id?: string }[] };
    return { ok: true, provider, models: (j.data ?? []).map((m) => m.id ?? "").filter(Boolean), voices: [] };
  } catch (e) {
    return { ok: false, reason: `拉取失败：${String((e as Error)?.message ?? e).slice(0, 60)}` };
  }
}

/** 语音 → 文字。audio 是录下来的音频（webm/mp4 都行） */
export async function transcribe(
  audio: Blob,
  cfg = voiceConfig(),
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  if (!cfg) return { ok: false, reason: "还没配语音服务（我的 → 语音服务）" };
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
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  if (!cfg) return { ok: false, reason: "还没配语音服务" };
  try {
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
