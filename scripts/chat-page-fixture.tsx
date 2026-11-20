// Full production shell, chat page and conversation settings; only the upstream is local.
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppShell } from "../src/components/shell/app-shell";
import { BackgroundLayer } from "../src/components/shell/background-layer";
import { ChatView } from "../src/components/chat/chat-view";
import { MePage } from "../src/components/me/me-page";
import { ToolsView } from "../src/components/views/tools-view";
import { PluginHub } from "../src/components/play/plugin-hub";
import { PluginEditor } from "../src/components/play/plugin-editor";
import { termuxTerminal } from "../src/lib/mcp-config";
import { applyAppearance, useApp } from "../src/lib/store";
import type { ChatMessage, ToolCallRecord } from "../src/lib/types";
import { waitHydrated } from "../src/lib/store-ready";
import "../src/styles.css";

// The production root's boot component sets this flag; the isolated entry must do the same.
await new Promise<void>((resolve) => {
  if (useApp.persist.hasHydrated()) resolve();
  else { const off = useApp.persist.onFinishHydration(() => { off(); resolve(); }); }
});
useApp.getState().setHydrated(true);
const nativeMcp = new URLSearchParams(location.search).has("nativeMcp");
if (!localStorage.getItem("fixture-chat-ready")) {
  useApp.setState((s) => ({ settings: { ...s.settings,
    customBaseUrl: "http://127.0.0.1:4650/v1", customApiKey: "fixture-key", upstreamModel: "fixture-model",
    ...(nativeMcp ? { permissions: { ...s.settings.permissions, mcp_tools: "allow" as const } } : {}),
    toolProtocol: "native", toolProbeOk: true, voiceReplies: false, notifications: false,
    motion: "off", wakeEnabled: false, autonomyEnabled: false,
    chatCrab: { enabled: false, size: 32, activity: "quiet" },
    segmentReply: true, segmentPacing: true, segmentSmartDelay: true, segmentMaxParts: 6, segmentMaxSentences: 1,
    mergeSend: true, mergeSendDelayMs: 600, replyWhileBusy: true, assistantAutoClean: true, aiStickers: true,
  }, conversations: [], activeId: null, pendingActions: [], actionLog: [], mcp: nativeMcp ? [{ ...termuxTerminal("http://127.0.0.1:8767", "native-test-token"), id: "native-termux", tools: [] }] : [], httpTools: [] }));
  localStorage.setItem("fixture-chat-ready", "1");
}
const thinkingPreview = new URLSearchParams(location.search).has("thinkingPreview");
function setupThinkingPreview(textTone: "dark" | "light") {
  const now = Date.now();
  const id = "android-thinking-preview";
  const message = (suffix: string, role: ChatMessage["role"], content: string, elapsed: number): ChatMessage => ({
    id: id + "-" + suffix, role, content, createdAt: now - elapsed, thinking: "", thinkingDurationMs: 0,
  });
  const thoughts = [
    "Give her room to talk, and let her choose what to share.",
    "Keep the reply short and warm. There is no rush to find a solution.",
  ];
  const assistant: ChatMessage = {
    ...message("4", "assistant", "我在。你想从哪儿说，我们就从哪儿说。", 5000),
    thinking: thoughts.join(" "),
    thinkingDurationMs: 15000,
    steps: [
      {kind: "think", text: thoughts[0]!},
      {kind: "call", call: {kind: "memory.add", name: "memory_add", ok: true,
        args: JSON.stringify({text: "她累的时候想有人陪着"}), result: "她累的时候想有人陪着"}},
      {kind: "think", text: thoughts[1]!},
    ],
  };
  useApp.setState(current => ({
    activeId: id,
    conversations: [{id, title: "傍晚的对话", pinned: false, incognito: false,
      createdAt: now - 90000, updatedAt: now, messages: [
        message("1", "user", "今天有点累，想说说话。", 85000),
        message("2", "assistant", "想说就慢慢说，我听着。", 65000),
        message("3", "user", "好像有很多话，不知道该从哪里说起。", 45000),
        assistant,
      ]}],
    settings: {...current.settings,
      material: "liquid", textTone, showThinking: true, motion: "off",
      aiName: "星芒", displayName: "yan", notifications: false,
      wakeEnabled: false, autonomyEnabled: false, voiceReplies: false,
      chatCrab: {enabled: false, size: 32, activity: "quiet"},
      background: {image: "/memory-universe/nebula.jpg", blur: 0, dim: 0.12, opacity: 1},
      customBaseUrl: "http://127.0.0.1:4661/v1", customApiKey: "android-preview", upstreamModel: "android-preview",
    },
  }));
  applyAppearance(useApp.getState().settings);
}
if (thinkingPreview) setupThinkingPreview("dark");

const root = createRootRoute({
  component: thinkingPreview ? () => <><BackgroundLayer /><AppShell /></> : AppShell,
});
const chat = createRoute({ getParentRoute: () => root, path: "/", component: ChatView });
const settings = createRoute({ getParentRoute: () => root, path: "/chat-settings", component: () =>
  <MePage tab="chat" title="对话" subtitle="思考过程、标点分句、发送节奏、连发与表情包" /> });
const tools = createRoute({ getParentRoute: () => root, path: "/tools", component: ToolsView });
const plugins = createRoute({ getParentRoute: () => root, path: "/play/plugins", component: PluginHub });
const pluginEditor = createRoute({ getParentRoute: () => root, path: "/play/plugins/edit", component: () => <PluginEditor /> });
const router = createRouter({ routeTree: root.addChildren([chat, settings, tools, plugins, pluginEditor]),
  history: createMemoryHistory({ initialEntries: [new URLSearchParams(location.search).has("settings") ? "/chat-settings" : new URLSearchParams(location.search).has("tools") ? "/tools" : "/"] }) });
Object.assign(window, { qidaoFixture: {
  navigate: (path: string) => router.navigate({ to: path }),
  setThinkingPreviewTone: (tone: "light") => {
    if (thinkingPreview) setupThinkingPreview(tone);
  },
  read: () => ({ settings: useApp.getState().settings, skills: useApp.getState().skills, mcp: useApp.getState().mcp, messages: useApp.getState().conversations.flatMap((c) => c.messages) }),
  setCopyExample: (id: string, content: string, parts: string[]) => {
    const state = useApp.getState();
    const conversation = state.conversations.find((c) => c.messages.some((m) => m.id === id));
    if (conversation) state.patchMessage(conversation.id, id, { content, parts });
  },
  setWebSourceExample: (id: string, content: string, calls: ToolCallRecord[]) => {
    const state = useApp.getState();
    const conversation = state.conversations.find((c) => c.messages.some((m) => m.id === id));
    if (conversation) state.patchMessage(conversation.id, id, { content, parts: [content],
      steps: calls.map((call) => ({ kind: "call" as const, call })), rounds: [{ round: 1, calls }] });
  },
  setMcpUrl: (url: string) => useApp.getState().patchMcp("native-termux", { url, status: undefined, tools: [] }),
  readSkill: async (name: string) => (await import("../src/lib/actions")).runAction({ kind: "tool.call", server: "@skills", tool: "read", args: { name } }, { navigate: () => {} }),
} });
createRoot(document.getElementById("fixture")!).render(<RouterProvider router={router} />);

