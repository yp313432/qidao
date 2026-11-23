import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { ApiMessage, ChatDelta } from "./chat-client";
import { normalizeUsage } from "./request-accounting";

type PlanStatus = { connected: boolean; allowed: boolean; email: string; hasRegistration: boolean };
type PlanModel = { id: string; label: string };
type ResponsePart =
  | { type: "input_text" | "output_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" };
type ResponseMessage = { role: "user" | "assistant" | "developer"; content: string | ResponsePart[] };

export const chatGptPlan = registerPlugin<{
  status(): Promise<PlanStatus>;
  signIn(options?: { replaceAccount: boolean }): Promise<PlanStatus>;
  disconnect(): Promise<{ revoked: boolean }>;
  models(): Promise<{ models: PlanModel[] }>;
  stream(options: { id: string; model: string; input: ResponseMessage[] }): Promise<void>;
  cancel(options: { id: string }): Promise<void>;
  addListener(name: "response", listener: (event: { id: string; text?: string; usage?: unknown }) => void):
    Promise<PluginListenerHandle>;
}>("ChatGptPlan");

export function chatGptPlanAvailable(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ChatGptPlan");
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
  const cancel = () => { void chatGptPlan.cancel({ id }).catch(() => {}); };
  let listener: PluginListenerHandle | undefined;
  try {
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
