// CI-only entry: real MCP UI, chat hook and action gate, without the unrelated app shell.
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useNavigate } from "@tanstack/react-router";
import { McpServers } from "../src/components/tools/mcp-servers";
import { ActionGate } from "../src/components/shared/action-gate";
import { Composer } from "../src/components/chat/composer";
import { useChatStream } from "../src/lib/use-chat";
import { termuxTerminal } from "../src/lib/mcp-config";
import { useApp } from "../src/lib/store";
import "../src/styles.css";
await new Promise<void>((resolve) => {
  if (useApp.persist.hasHydrated()) resolve();
  else { const off = useApp.persist.onFinishHydration(() => { off(); resolve(); }); }
});
useApp.getState().setHydrated(true);
useApp.setState((state) => ({ settings: { ...state.settings,
  customBaseUrl: "http://127.0.0.1:4650/v1", customApiKey: "fixture-key", upstreamModel: "fixture-model",
  permissions: { ...state.settings.permissions, mcp_tools: "allow" },
  toolProtocol: "native", toolProbeOk: true, voiceReplies: false, notifications: false,
  motion: "off", wakeEnabled: false, autonomyEnabled: false, mergeSend: false,
  chatCrab: { enabled: false, size: 32, activity: "quiet" },
}, conversations: [], activeId: null, pendingActions: [], actionLog: [], httpTools: [],
  mcp: [{ ...termuxTerminal("http://127.0.0.1:8767", "native-test-token"), id: "native-termux", tools: [] }],
}));
function NativeRoot() {
  const navigate = useNavigate();
  return <main><button className="k-btn" onClick={() => void navigate({ to: "/tools" })}>MCP</button><Outlet /><ActionGate /></main>;
}
function NativeChat() {
  const { busy, replying, send, stop, pendingCount } = useChatStream({ forceProtocol: "native" });
  const messages = useApp((state) => state.conversations.find((c) => c.id === state.activeId)?.messages);
  return <section><h1>原生 MCP 调用</h1>{messages?.map((message) => <p key={message.id}>{message.content || message.requestError}</p>)}
    <Composer streaming={busy} disabled={replying} queuedCount={pendingCount} onStop={stop} onSend={(text, attachments) => void send(text, attachments)} />
  </section>;
}
const root = createRootRoute({ component: NativeRoot });
const chat = createRoute({ getParentRoute: () => root, path: "/", component: NativeChat });
const tools = createRoute({ getParentRoute: () => root, path: "/tools", component: McpServers });
const router = createRouter({ routeTree: root.addChildren([chat, tools]), history: createMemoryHistory({ initialEntries: ["/tools"] }) });
Object.assign(window, { qidaoFixture: {
  navigate: (path: string) => router.navigate({ to: path }),
  read: () => ({ mcp: useApp.getState().mcp, messages: useApp.getState().conversations.flatMap((c) => c.messages) }),
  setMcpUrl: (url: string) => useApp.getState().patchMcp("native-termux", { url, status: undefined, tools: [] }),
} });
createRoot(document.getElementById("fixture")!).render(<RouterProvider router={router} />);
