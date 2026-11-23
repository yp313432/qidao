import type { CapacitorGlobal, PluginListenerHandle } from "@capacitor/core";
import type { ApiMessage, ChatDelta } from "./chat-client";
import type { Settings } from "./types";
import { normalizeUsage } from "./request-accounting.ts";

type PlanStatus = { connected: boolean; allowed: boolean; email: string; hasRegistration: boolean };
type PlanModel = { id: string; label: string };
type ResponsePart =
  | { type: "input_text" | "output_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" };
type ResponseMessage = { role: "user" | "assistant" | "developer"; content: string | ResponsePart[] };

type ChatGptPlanBridge = {
  status(): Promise<PlanStatus>;
  signIn(options?: { replaceAccount: boolean }): Promise<PlanStatus>;
  disconnect(): Promise<{ revoked: boolean }>;
  models(): Promise<{ models: PlanModel[] }>;
  stream(options: { id: string; model: string; input: ResponseMessage[] }): Promise<void>;
  cancel(options: { id: string }): Promise<void>;
  addListener(name: "response", listener: (event: { id: string; text?: string; usage?: unknown }) => void):
    Promise<PluginListenerHandle>;
};

let bridge: ChatGptPlanBridge | undefined;

function nativeCapacitor(): CapacitorGlobal | undefined {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorGlobal }).Capacitor;
}

// Capacitor proxies expose method wrappers for arbitrary names, including "then".
// Returning the proxy from a Promise makes Promise resolution try to call a native "then" method.
export function getChatGptPlan(): ChatGptPlanBridge {
  const capacitor = nativeCapacitor();
  if (capacitor?.getPlatform?.() !== "android" || !capacitor.isPluginAvailable?.("ChatGptPlan")) {
    throw new Error("当前版本没有安卓 ChatGPT 计划组件");
  }
  return bridge ??= capacitor.registerPlugin<ChatGptPlanBridge>("ChatGptPlan");
}

export function chatGptPlanAvailable(): boolean {
  const capacitor = nativeCapacitor();
  return capacitor?.getPlatform?.() === "android" && capacitor.isPluginAvailable?.("ChatGptPlan") === true;
}

export async function readChatGptPlanStatus(timeoutMs = 5000): Promise<PlanStatus> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getChatGptPlan().status(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("读取本机 ChatGPT 授权超时，可以重新登录。")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function usesChatGptPlan(settings: Pick<Settings, "chatGptPlanEnabled">): boolean {
  return settings.chatGptPlanEnabled === true && chatGptPlanAvailable();
}

type ModelSelectionSettings = Pick<Settings,
  "chatGptPlanEnabled" | "chatGptPlanModel" | "chatGptPlanModels" | "upstreamModel" | "upstreamModels">;

export function chatModelSelection(settings: ModelSelectionSettings) {
  const plan = usesChatGptPlan(settings);
  const model = plan ? settings.chatGptPlanModel ?? "" : settings.upstreamModel;
  const catalog = plan
    ? settings.chatGptPlanModels ?? []
    : settings.upstreamModels.map((id) => ({ id, label: id }));
  const models = plan && catalog.length === 0 && model ? [{ id: model, label: model }] : catalog;
  return { plan, model, label: models.find((item) => item.id === model)?.label ?? model, models };
}

export function chatGptPlanCatalogPatch(models: PlanModel[], selected: string): Pick<Settings,
  "chatGptPlanModel" | "chatGptPlanModels"> {
  return {
    chatGptPlanModels: models,
    chatGptPlanModel: models.some((item) => item.id === selected) ? selected : models[0]?.id ?? "",
  };
}

function responseInput(messages: readonly ApiMessage[]): ResponseMessage[] {
  const input: ResponseMessage[] = [];
  for (const message of messages) {
    if (message.role === "tool") continue;
    const role = message.role === "system" ? "developer" : message.role;
    if (typeof message.content === "string") {
      if (message.content.trim()) input.push({ role, content: message.content });
      continue;
    }
    const content: ResponsePart[] = [];
    for (const part of message.content) {
      if (part.type === "text" && part.text) {
        content.push({ type: role === "assistant" ? "output_text" : "input_text", text: part.text });
      } else if (part.type === "image_url" && role === "user") {
        content.push({ type: "input_image", image_url: part.image_url.url, detail: "auto" });
      }
    }
    if (content.length) input.push({ role, content });
  }
  return input;
}

export async function streamChatGptPlan(
  model: string,
  messages: readonly ApiMessage[],
  onDelta: (delta: ChatDelta) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!chatGptPlanAvailable() || !model) {
    onDelta({ error: "请在安卓 App 的「我的 → ChatGPT 计划」授权并选择模型", done: true });
    return;
  }
  const id = crypto.randomUUID();
  let chatGptPlan: ChatGptPlanBridge | undefined;
  const cancel = () => { void chatGptPlan?.cancel({ id }).catch(() => {}); };
  let listener: PluginListenerHandle | undefined;
  try {
    chatGptPlan = getChatGptPlan();
    listener = await chatGptPlan.addListener("response", (event) => {
      if (event.id !== id || signal?.aborted) return;
      if (event.text) onDelta({ content: event.text });
      const usage = normalizeUsage(event.usage);
      if (usage) onDelta({ usage });
    });
    if (signal?.aborted) return;
    const pending = chatGptPlan.stream({ id, model, input: responseInput(messages) });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    await pending;
    if (!signal?.aborted) onDelta({ finishReason: "stop", done: true });
  } catch (error) {
    if (!signal?.aborted) {
      onDelta({ error: error instanceof Error ? error.message : "ChatGPT 计划连接失败", done: true });
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await listener?.remove().catch(() => {});
  }
}
