/**
 * 百炼（阿里 · Model Studio）语音合成。
 *
 * 为什么单独一个文件：它**不是 OpenAI 形状**，三条路都长自己的样子，而另外两家
 * （OpenAI 兼容 / ElevenLabs）已经塞在 `voice-service.ts` 里了，再往里堆会看不清。
 *
 * 三条接口（都是 HTTP，浏览器/WebView 直接能调；App 里跨域被拦时自动改走原生）：
 *
 *   · 合成   `POST {base}/api/v1/services/audio/tts/SpeechSynthesizer`
 *            → `output.audio.url`（24 小时有效的音频文件，再 GET 下来）
 *   · 拉音色 `POST {base}/api/v1/services/audio/tts/customization` `action:list_voice`
 *   · 捏音色 同上 `action:create_voice`（"声音设计"：给一段文字描述，它造一个嗓子）
 *            → `output.voice_id` + `output.preview_audio.data`（base64 预览，先听再说）
 *
 * ⚠️ 三个必须在界面上讲清的事实（都是官方文档写死的）：
 * 1. 音色**绑定创建时的 target_model**，合成必须用同一个模型，否则直接报错；
 * 2. 捏出来的音色要先过审核（`DEPLOYING → OK`），审核通过前只能听预览、不能正式用；
 * 3. **创建音色免费**，只有合成按字符计费。
 */

/** 默认地址：百炼的通用域名（不用填业务空间 ID）；专属域名也能填，见 baseOf() */
export const DS_DEFAULT_BASE = "https://dashscope.aliyuncs.com";

/** 能用来合成的模型（按"最适合他说话"排，flash 便宜、plus 更好听） */
export const DS_TTS_MODELS = [
  "qwen-audio-3.1-tts-flash",
  "qwen-audio-3.1-tts-plus",
  "cosyvoice-v3-flash",
];

/** 常用系统音色（自定义音色从「拉取音色」里来，这里只是开箱能用的几个） */
export const DS_SYSTEM_VOICES = [
  { id: "longanhuan_v3.1", label: "龙安欢（女 · 温柔）" },
  { id: "longanyang", label: "龙安阳（男 · 沉稳）" },
  { id: "longshange_v3", label: "龙尚歌（女 · 明亮）" },
  { id: "longxiaochun_v3", label: "龙小淳（女 · 亲和）" },
];

/**
 * 规范化地址。
 *
 * 用户可能填三种：
 *   · `https://dashscope.aliyuncs.com`（通用域名，最省事）
 *   · `https://abc123.cn-beijing.maas.aliyuncs.com`（业务空间专属域名）
 *   · `https://dashscope.aliyuncs.com/v1`（拿 OpenAI 兼容的习惯填进来的）
 * 后面两种要在这里抹平：去掉尾巴上的 `/v1` `/api` `/api/v1`，**只留 origin**。
 */
export function baseOf(raw: string): string {
  const s = (raw ?? "").trim() || DS_DEFAULT_BASE;
  return s.replace(/\/+$/, "").replace(/\/(?:api\/)?v1$/i, "");
}

export type DsCfg = {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
};

export type DsVoice = {
  id: string;
  status: string;
  created?: string;
};

export type Ok<T> = { ok: true } & T;
export type Fail = { ok: false; reason: string };

/* ────────────────────── 底层：能绕跨域的请求 ────────────────────── */

type NativeRes = { status: number; data: unknown };

/**
 * 原生 HTTP。网页版/老包拿不到就返回 null，由调用方回落 fetch。
 *
 * **不要**在 capacitor.config 里开 `plugins.CapacitorHttp.enabled`（那是全局改
 * fetch，会连别人的流式请求一起改掉）；这里只直接调 `CapacitorHttp.request()`。
 */
async function nativeRequest(o: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: unknown;
  responseType?: "json" | "text" | "blob" | "arraybuffer";
}): Promise<NativeRes | null> {
  const w = globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  if (!w.Capacitor?.isNativePlatform?.()) return null;
  try {
    const mod = (await import("@capacitor/core")) as unknown as {
      CapacitorHttp?: { request: (o: Record<string, unknown>) => Promise<NativeRes> };
    };
    if (!mod.CapacitorHttp) return null;
    return await mod.CapacitorHttp.request({ ...o, connectTimeout: 20_000, readTimeout: 90_000 });
  } catch {
    return null;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** POST JSON；返回 status + 原文 + 解析结果（上游 HTTP 200 也可能是业务错误，见 apiError） */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; text: string; json: unknown }> {
  const nat = await nativeRequest({ url, method: "POST", headers, data: body });
  if (nat) {
    const text = typeof nat.data === "string" ? nat.data : JSON.stringify(nat.data ?? {});
    return { status: nat.status, text, json: typeof nat.data === "object" ? nat.data : parseJson(text) };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: parseJson(text) };
}

/** base64 字符串 → 音频 Blob（CapacitorHttp 的 blob 响应就是 base64） */
function b64ToBlob(b64: string): Blob | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes.length > 0 ? new Blob([bytes], { type: "audio/mpeg" }) : null;
  } catch {
    return null;
  }
}

/** 把音频（URL 或 base64）变成能直接播放的 Blob URL */
async function toAudioUrl(src: Blob | string | null | undefined): Promise<string | null> {
  if (!src) return null;
  if (src instanceof Blob) return src.size > 0 ? URL.createObjectURL(src) : null;
  const raw = src.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    /**
     * 上游给的结果地址是 **http**（`http://dashscope-result-bj.os-s-cn-beijing…`）。
     *
     * 安卓 WebView 里 App 页面本身是 https://localhost，再 fetch 一个 http 资源
     * 属于"混合内容"，会被直接拦掉 —— 表现就是"合成成功但没声音"。
     * 同一个 OSS 域名支持 https，所以先换成 https 再取，失败才用原地址。
     */
    const httpsRaw = raw.replace(/^http:\/\//i, "https://");
    let blob: Blob | null = null;
    /**
     * ① 先走**原生下载**（App 内）。原因有两个，都是踩过的：
     *   · 结果域名是 http，https 页面 fetch 它属于混合内容，直接被拦；
     *   · OSS 不保证给 CORS 头，网页 fetch 一样会被拦。
     * 原生 HTTP 两条限制都没有，所以 App 里应当它是第一选择。
     */
    const natFirst = await nativeRequest({ url: raw, method: "GET", responseType: "blob" });
    const natData = natFirst?.data;
    if (natData instanceof Blob && natData.size > 0) blob = natData;
    else if (natData && typeof natData === "object" && "data" in natData) {
      const inner = (natData as { data?: unknown }).data;
      if (typeof inner === "string" && inner.length > 64) blob = b64ToBlob(inner);
    } else if (typeof natData === "string" && natData.length > 64) {
      blob = b64ToBlob(natData);
    }
    if (blob) return URL.createObjectURL(blob);
    try {
      const res = await fetch(httpsRaw);
      if (res.ok) {
        const b = await res.blob();
        if (b.size > 0) blob = b;
      }
    } catch {
      /* 混合内容/跨域，下面用原生再试 */
    }
    if (!blob) try {
      const res = await fetch(raw);
      if (res.ok) {
        const b = await res.blob();
        if (b.size > 0) blob = b;
      }
    } catch {
      /* 跨域/断网，下面用原生再试一次 */
    }
    if (!blob) {
      const nat = await nativeRequest({ url: raw, method: "GET", responseType: "blob" });
      const data = nat?.data;
      if (data instanceof Blob && data.size > 0) blob = data;
      else if (typeof data === "string" && data.length > 64) {
        try {
          const bin = atob(data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          blob = new Blob([bytes], { type: "audio/mpeg" });
        } catch {
          blob = null;
        }
      }
    }
    return blob ? URL.createObjectURL(blob) : null;
  }
  // base64（捏音色的预览音频就是这个形状）
  try {
    const b64 = raw.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  } catch {
    return null;
  }
}

/**
 * 上游 HTTP 200 也可能是业务错误：DashScope 把原因塞在
 * `output.base_resp.status_code/status_msg` 或顶层 `code/message` 里。
 * 不把这层剥出来，界面上只会看到"合成失败"四个字，没法定位。
 */
function apiError(status: number, json: unknown, text: string): string | null {
  const j = json as
    | {
        code?: string;
        message?: string;
        output?: { base_resp?: { status_code?: number; status_msg?: string } };
      }
    | null;
  const br = j?.output?.base_resp;
  if (br && typeof br.status_code === "number" && br.status_code !== 0) {
    return `${br.status_msg ?? `status ${br.status_code}`}（${br.status_code}）`;
  }
  if (status < 200 || status >= 300) {
    const msg = j?.message ?? j?.code ?? text.slice(0, 160);
    return `HTTP ${status}：${String(msg).slice(0, 160)}`;
  }
  return null;
}

function endpoint(cfg: DsCfg, path: string): string {
  return `${baseOf(cfg.baseUrl)}/api/v1/services/audio/tts/${path}`;
}

function headersOf(key: string): Record<string, string> {
  return { authorization: `Bearer ${key.trim()}`, "content-type": "application/json" };
}

/* ────────────────────────── 合成 ────────────────────────── */

/**
 * 合成一段话。
 *
 * @param instruction 自然语言指令（`qwen-audio-3.1-*` 支持）。带情绪的时候用它，
 *   比往正文里插 `[标签]` 更稳：标签会改正文（万一念出来就糟了），而 instruction
 *   只是一个参数，上游不吃也只是忽略。
 */
export async function synthDashscope(
  cfg: DsCfg,
  text: string,
  instruction?: string,
): Promise<Ok<{ url: string }> | Fail> {
  if (!cfg.apiKey.trim()) return { ok: false, reason: "还没填百炼的 API Key" };
  const model = cfg.model.trim() || DS_TTS_MODELS[0]!;
  const voice = cfg.voice.trim() || DS_SYSTEM_VOICES[0]!.id;

  /**
   * 自己造的嗓子是**绑模型**的：id 里带着造它时的 target_model
   * （`qwen-audio-3.1-tts-plus-vd-qidao-…`）。
   * 用户 m11188 就把「合成」改成了 flash 而音色还是 plus 造的 —— 这种组合
   * 上游只会含糊地说"没法用"，不如在这儿一句话说清楚，还顺手告诉他改哪格。
   */
  if (voice.includes("-vd-")) {
    const boundTo = voice.split("-vd-")[0] ?? "";
    if (boundTo && !voice.startsWith(model)) {
      return {
        ok: false,
        reason: `这个音色是用 ${boundTo} 造的，但「合成」现在选的是 ${model} —— 两者必须一致。把「合成」改成 ${boundTo} 再试（或者重新用 ${model} 造一个嗓子）。`,
      };
    }
  }
  const input: Record<string, unknown> = {
    text: text.slice(0, 2000),
    voice,
    format: "mp3",
    sample_rate: 24000,
  };
  if (instruction?.trim()) input.instruction = instruction.trim().slice(0, 200);

  const url = endpoint(cfg, "SpeechSynthesizer");
  let r: { status: number; text: string; json: unknown };
  try {
    r = await postJson(url, headersOf(cfg.apiKey), { model, input });
  } catch (e) {
    return { ok: false, reason: `合成失败：${e instanceof Error ? e.message : "网络错误"}` };
  }
  const err = apiError(r.status, r.json, r.text);
  if (err) return { ok: false, reason: `合成失败：${err}` };
  const out = (r.json as { output?: { audio?: { url?: string; data?: string } } } | null)?.output;
  const audioSrc = (out?.audio?.data || out?.audio?.url || "").trim();
  if (!audioSrc) {
    const raw = (r.text || JSON.stringify(r.json ?? {})).replace(/\s+/g, " ").slice(0, 240);
    return {
      ok: false,
      reason:
        `合成失败（HTTP ${r.status}）：上游**连音频地址都没给**。模型 ${model} / 音色 ${voice}。` +
        `上游原话：${raw || "（空响应）"}。`,
    };
  }
  /**
   * ⚠️ 这里必须是 `||`，不是 `??`（用户 m11188 的报错暴露的）。
   *
   * 非流式合成时上游会返回 `"data": ""`（空字符串）**同时**给一个有效的
   * `url`。`"" ?? url` 不会回落（空字符串不是 null/undefined），于是我们把
   * 空串当音频源 → 判定"上游没给音频" → 每次都失败，而实际上音频就在 url 上。
   */
  const ready = await toAudioUrl(audioSrc);
  if (!ready) {
    /**
     * **第三种失败**（用户 m11226："装的就是最新的，还是这句报错"）：
     * 上游明明给了地址，是我们取不回来/取回来是空。它和"上游没给音频"
     * 是两件完全不同的事，必须分开说，否则用户永远查不出卡在哪一层。
     */
    return {
      ok: false,
      reason:
        `合成成功，但音频取不回来（地址 ${audioSrc.slice(0, 96)}…）。` +
        "说明上游已经念出来了，卡在下载这一段：可能是网络、也可能安卓拦了。" +
        "这句话原样发我，我就能定位。",
    };
  }
  return { ok: true, url: ready };
}

/**
 * 自定义音色的状态 → 人话。
 *
 * DashScope 的 `list_voice` 会带 `status`：
 * · `OK`        能用
 * · `DEPLOYING` 还在审核/部署中（刚用声音设计造的嗓子通常是这样，要等几分钟）
 * · `UNDEPLOYED` 已下线，不能用了
 * 不把这个显示出来，用户就只能看到"合成失败"四个字。
 */
export function dsVoiceStatusHint(status: string | undefined): string {
  const s = (status ?? "").toUpperCase();
  if (s === "OK" || !s) return "";
  if (s === "DEPLOYING") return "审核中，等几分钟";
  if (s === "UNDEPLOYED") return "已下线，不能用";
  return s;
}

/* ────────────────────────── 音色 ────────────────────────── */

/**
 * 拉自定义音色（复刻 + 设计都在这张表里）。
 *
 * 列表项只有 `voice_id` 和状态，**没有 target_model** —— 但 voice_id 的形状是
 * `{target_model}-{prefix}-{唯一标识}`，所以按"当前模型名"做前缀过滤，
 * 就能把"这个模型能用的音色"挑出来，避免用户选了一个绑错模型的音色后合成报错。
 */
export async function listDashscopeVoices(
  cfg: DsCfg,
): Promise<Ok<{ voices: DsVoice[] }> | Fail> {
  if (!cfg.apiKey.trim()) return { ok: false, reason: "还没填百炼的 API Key" };
  const url = endpoint(cfg, "customization");
  let r: { status: number; text: string; json: unknown };
  try {
    r = await postJson(url, headersOf(cfg.apiKey), {
      model: "voice-enrollment",
      input: { action: "list_voice", page_size: 100, page_index: 0 },
    });
  } catch (e) {
    return { ok: false, reason: `拉取音色失败：${e instanceof Error ? e.message : "网络错误"}` };
  }
  const err = apiError(r.status, r.json, r.text);
  if (err) return { ok: false, reason: `拉取音色失败：${err}` };
  const list = (r.json as { output?: { voice_list?: { voice_id?: string; status?: string; gmt_create?: string }[] } } | null)
    ?.output?.voice_list;
  const model = cfg.model.trim() || DS_TTS_MODELS[0]!;
  const voices = (list ?? [])
    .filter((v) => (v.voice_id ?? "").startsWith(model))
    .map((v) => ({ id: v.voice_id ?? "", status: v.status ?? "", created: v.gmt_create }));
  return { ok: true, voices };
}

/**
 * 捏一个嗓子（声音设计）：给一段中文/英文描述，它生成一个不存在的音色。
 *
 * 回应里带 **预览音频**，所以这里能"先听再说"——用户听到满意再点采用。
 * 创建免费；只有真正拿去合成才按字符计费。
 */
export async function designVoice(
  cfg: DsCfg,
  p: { description: string; previewText?: string; prefix?: string; language?: string },
): Promise<Ok<{ voiceId: string; previewUrl: string | null; status: string }> | Fail> {
  if (!cfg.apiKey.trim()) return { ok: false, reason: "还没填百炼的 API Key" };
  const desc = p.description.trim();
  if (desc.length < 6) return { ok: false, reason: "描述太短了，多写两句（性别、年龄、音调、语速、感觉）会更准" };
  if (desc.length > 500) return { ok: false, reason: "描述最多 500 字" };
  const model = cfg.model.trim() || DS_TTS_MODELS[0]!;
  const prefix = (p.prefix ?? "qidao").replace(/[^0-9a-zA-Z]/g, "").slice(0, 10) || "qidao";
  const previewText = (p.previewText ?? "").trim() || "你回来了？水我烧上了，先坐一会儿吧。";
  const url = endpoint(cfg, "customization");
  let r: { status: number; text: string; json: unknown };
  try {
    r = await postJson(url, headersOf(cfg.apiKey), {
      model: "voice-enrollment",
      input: {
        action: "create_voice",
        target_model: model,
        voice_prompt: desc,
        preview_text: previewText.slice(0, 200),
        prefix,
        language_hints: [p.language ?? "zh"],
      },
      parameters: { sample_rate: 24000, response_format: "wav" },
    });
  } catch (e) {
    return { ok: false, reason: `生成音色失败：${e instanceof Error ? e.message : "网络错误"}` };
  }
  const err = apiError(r.status, r.json, r.text);
  if (err) return { ok: false, reason: `生成音色失败：${err}` };
  const out = (r.json as
    | { output?: { voice_id?: string; preview_audio?: { data?: string }; status?: string } }
    | null)?.output;
  const voiceId = out?.voice_id ?? "";
  if (!voiceId) return { ok: false, reason: "生成音色失败：上游没返回 voice_id" };
  const previewUrl = await toAudioUrl(out?.preview_audio?.data);
  return { ok: true, voiceId, previewUrl, status: out?.status ?? "DEPLOYING" };
}

/**
 * 把 10 组情绪换成一句 `instruction`（自然语言指令）。
 *
 * 只做**高置信度**的映射：拿不准就不写，宁可平着念，也不要因为判断错而滑稽。
 * （不用 `[标签]` 是因为标签直接改正文：万一上游不认，那段字会被原样念出来。）
 */
export function instructionOfEmotion(group: string | undefined): string {
  switch ((group ?? "").trim()) {
    case "low":
      return "声音低一些、慢一些，像有点累，句子之间多留半拍。";
    case "uneasy":
      return "语气里带一点不确定，声音收着，尾音别太稳。";
    case "angry":
      return "语气压着，字咬得重一点，但别喊。";
    case "jealous":
      return "语气有点酸，轻微的讽刺感，不要太用力。";
    case "restrained":
      return "说得很慢，像在克制什么，句尾往下压。";
    case "flutter":
      return "语气轻快一点，带一点藏不住的笑意。";
    case "close":
      return "语气很轻很软，像在耳边说话。";
    case "bright":
      return "语气明亮、轻快，节奏稍快一点。";
    case "curious":
      return "语气带着好奇，尾音微微上扬，像在追问。";
    case "calm":
      /* 平静就是平着念 —— 不额外加任何指令，这样最稳 */
      return "";
    default:
      return "";
  }
}
