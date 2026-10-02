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

/** 语音 → 文字。audio 是录下来的音频（webm/mp4 都行） */
export async function transcribe(
  audio: Blob,
  cfg = voiceConfig(),
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  if (!cfg) return { ok: false, reason: "还没配语音服务（我的 → 语音服务）" };
  try {
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
