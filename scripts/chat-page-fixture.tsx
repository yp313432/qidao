// Full production shell, chat page and conversation settings; only the upstream is local.
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppShell } from "../src/components/shell/app-shell";
import { ChatView } from "../src/components/chat/chat-view";
import { MePage } from "../src/components/me/me-page";
import { useApp } from "../src/lib/store";
import { waitHydrated } from "../src/lib/store-ready";
import "../src/styles.css";

// The production root's boot component sets this flag; the isolated entry must do the same.
await new Promise<void>((resolve) => {
  if (useApp.persist.hasHydrated()) resolve();
  else { const off = useApp.persist.onFinishHydration(() => { off(); resolve(); }); }
});
useApp.getState().setHydrated(true);
if (!localStorage.getItem("fixture-chat-ready")) {
  useApp.setState((s) => ({ settings: { ...s.settings,
    customBaseUrl: "http://127.0.0.1:4650/v1", customApiKey: "fixture-key", upstreamModel: "fixture-model",
    toolProtocol: "native", toolProbeOk: true, voiceReplies: false, notifications: false,
    motion: "off", wakeEnabled: false, autonomyEnabled: false,
    chatCrab: { enabled: false, size: 32, activity: "quiet" },
    segmentReply: true, segmentPacing: true, segmentSmartDelay: true, segmentMaxParts: 6, segmentMaxSentences: 1,
    mergeSend: true, mergeSendDelayMs: 600, replyWhileBusy: true, assistantAutoClean: true, aiStickers: true,
  }, conversations: [], activeId: null, pendingActions: [], actionLog: [], mcp: [], httpTools: [] }));
  localStorage.setItem("fixture-chat-ready", "1");
}
const root = createRootRoute({ component: AppShell });
const chat = createRoute({ getParentRoute: () => root, path: "/", component: ChatView });
const settings = createRoute({ getParentRoute: () => root, path: "/chat-settings", component: () =>
  <MePage tab="chat" title="对话" subtitle="思考过程、标点分句、发送节奏、连发与表情包" /> });
const router = createRouter({ routeTree: root.addChildren([chat, settings]),
  history: createMemoryHistory({ initialEntries: [new URLSearchParams(location.search).has("settings") ? "/chat-settings" : "/"] }) });
Object.assign(window, { qidaoFixture: {
  navigate: (path: string) => router.navigate({ to: path }),
  read: () => ({ settings: useApp.getState().settings, messages: useApp.getState().conversations.flatMap((c) => c.messages) }),
} });
createRoot(document.getElementById("fixture")!).render(<RouterProvider router={router} />);
