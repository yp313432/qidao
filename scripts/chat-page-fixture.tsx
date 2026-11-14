// Full production shell, chat page and conversation settings; only the upstream is local.
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppShell } from "../src/components/shell/app-shell";
import { ChatView } from "../src/components/chat/chat-view";
import { MePage } from "../src/components/me/me-page";
import { ToolsView } from "../src/components/views/tools-view";
import { PluginHub } from "../src/components/play/plugin-hub";
import { PluginEditor } from "../src/components/play/plugin-editor";
import { termuxTerminal } from "../src/lib/mcp-config";
import { useApp } from "../src/lib/store";
import type { ToolCallRecord } from "../src/lib/types";
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
const root = createRootRoute({ component: AppShell });
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

