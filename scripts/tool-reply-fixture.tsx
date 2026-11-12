// Real chat hook and store: only the AI upstream and action execution boundary are fakes.
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { ActionGate } from "../src/components/shared/action-gate";
import { useChatStream } from "../src/lib/use-chat";
import { useApp } from "../src/lib/store";
import { waitHydrated } from "../src/lib/store-ready";
import "../src/styles.css";

await waitHydrated();
useApp.setState((s) => ({ settings: { ...s.settings,
  customBaseUrl: "http://127.0.0.1:4649/v1", customApiKey: "fixture-key", upstreamModel: "fixture-model",
  toolProtocol: "native", toolProbeOk: true, voiceReplies: false, notifications: false,
}, conversations: [], activeId: null, pendingActions: [], actionLog: [], mcp: [], httpTools: [] }));

function Fixture() {
  const { busy, send, stop } = useChatStream({ forceProtocol: "native" });
  const message = useApp((s) => s.conversations.flatMap((c) => c.messages).filter((m) => m.role === "assistant").at(-1));
  return <main className="p-6">
    <button onClick={() => void send("请核对后回答，并记录一下你的情绪。")}>开始复现</button>
    <button onClick={stop}>停止</button>
    <p data-testid="busy">{busy ? "busy" : "idle"}</p>
    <pre data-testid="reply">{message?.content ?? ""}</pre>
    <pre data-testid="message">{JSON.stringify(message ?? null)}</pre>
    <ActionGate />
  </main>;
}
const route = createRootRoute({ component: Fixture });
const router = createRouter({ routeTree: route, history: createMemoryHistory({ initialEntries: ["/"] }) });
createRoot(document.getElementById("fixture")!).render(<RouterProvider router={router} />);
