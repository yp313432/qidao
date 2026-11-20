import { makeDirectRound, type ApiMessage, type ChatRequest } from "@/lib/chat-client";
import type { Settings } from "@/lib/types";

type TranslationSettings = Pick<Settings,
  "customBaseUrl" | "customApiKey" | "upstreamModel" | "effortProbeOk"
>;

export async function translateThinking(
  passages: readonly string[],
  settings: TranslationSettings,
  signal: AbortSignal,
): Promise<string[]> {
  if (!settings.customBaseUrl.trim() || !settings.customApiKey.trim() || !settings.upstreamModel.trim()) {
    throw new Error("请先在「我的 → 自定义上游」填好地址、密钥和模型名。");
  }

  const messages: ApiMessage[] = [{
    role: "user",
    content: "将以下 JSON 数组中的文字逐项译为简体中文，保留顺序、段落和代码，仅返回等长的 JSON 字符串数组。\n"
      + JSON.stringify(passages),
  }];
  const request: ChatRequest = {
    model: "haiku",
    messages,
    name: "",
    style: "default",
    tools: [],
    customBaseUrl: settings.customBaseUrl,
    customApiKey: settings.customApiKey,
    upstreamModel: settings.upstreamModel,
    effortOn: settings.effortProbeOk === true,
    maxTokens: 16384,
  };

  const failed = "翻译失败，请检查网络和上游设置后重试。";
  const result = await makeDirectRound(request)({ messages, tools: null, signal, onDelta: () => {} })
    .catch(() => { throw new Error(failed); });
  if (result.error || result.stalled) throw new Error(failed);
  if (result.finishReason === "length") {
    throw new Error("译文超过模型输出上限，无法完整显示。");
  }

  const content = result.content.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  let translations: unknown;
  try {
    translations = JSON.parse(content);
  } catch {
    throw new Error("上游返回的译文格式不完整，请重试。");
  }
  if (!Array.isArray(translations) || translations.length !== passages.length ||
      !translations.every((item): item is string => typeof item === "string" && !!item.trim())) {
    throw new Error("上游返回的译文不完整，请重试。");
  }
  return translations;
}
