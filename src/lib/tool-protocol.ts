/**
 * 「这一轮走原生 `tools`，还是走正文里的动作块？」—— **这个判断只有这一处实现**。
 *
 * 为什么单独一个文件：聊天链路（`use-chat`）和设置页（`me-sections` 要显示"现在走的是哪条"）
 * 都要用它，而验收脚本还要在**纯 node** 里直接跑它（不能 import React / zustand）。
 * 所以这里零依赖。
 *
 * 判据必须**保守** —— 判错的两种下场都很糟：
 *   · 明明不支持却发了 `tools` → 上游报错，用户看到"一个字都回不出来"
 *   · 明明支持却退回文本 → 白白多花 ~1800 token 的动作清单
 */

export type ToolProtocol = "auto" | "native" | "text";

/** 判断只看这几个字段 */
export type ToolProtocolSettings = {
  toolProtocol?: ToolProtocol;
  /** P1 探测缓存的结论（探测按钮写进设置的那一格） */
  toolProbeOk?: boolean;
  customBaseUrl?: string;
  customApiKey?: string;
};

export function shouldUseNativeTools(settings: ToolProtocolSettings): boolean {
  const mode = settings.toolProtocol ?? "auto";
  if (mode === "native") return true;
  if (mode === "text") return false;
  // auto：必须"探测过 + 说支持 + 有自定义上游"才走原生
  if (!(settings.customBaseUrl ?? "").trim() || !(settings.customApiKey ?? "").trim()) return false;
  return settings.toolProbeOk === true;
}

/**
 * 走原生 tools 时，界面上那句"现在走的是哪条通道"。
 * 放在这里是为了跟判断**共用同一份逻辑** —— 界面写的和实际走的不许不一致。
 */
export function toolProtocolLabel(settings: ToolProtocolSettings): {
  native: boolean;
  text: string;
} {
  const native = shouldUseNativeTools(settings);
  if (native) {
    return {
      native,
      text: "每次对话会把动作定义当 tools 发给上游；上游不认时会自动退回保底那套，不会卡住。",
    };
  }
  const mode = settings.toolProtocol ?? "auto";
  if (mode === "text") return { native, text: "你选了「保底」—— 动作还是写在正文里的动作块。" };
  /**
   * ⚠️ 这两格最容易把人带偏：探测结论说"支持"，用户会看到
   * "选「自动」或「原生」就切过去" —— 但他**本来就在「自动」上**，
   * 真正卡住的是没填上游地址/密钥。所以要如实说清是哪一格没填。
   */
  const hasUpstream = Boolean(
    (settings.customBaseUrl ?? "").trim() && (settings.customApiKey ?? "").trim(),
  );
  if (settings.toolProbeOk === true) {
    return hasUpstream
      ? { native, text: "测过是支持的，但没走原生 —— 选「自动」或「原生」就切过去。" }
      : {
          native,
          text: "测过是支持的，但你还没填上游地址或密钥 —— 填完就自动切过去了（现在先用保底那套）。",
        };
  }
  if (settings.toolProbeOk === false) {
    return { native, text: "上次测出来不支持，所以走保底那套 —— 换把上游再测一次。" };
  }
  return {
    native,
    text: hasUpstream
      ? "还没测过，所以先走保底那套（绝不用你的对话去赌）。"
      : "还没填上游地址或密钥，也还没测过 —— 所以先走保底那套。",
  };
}
