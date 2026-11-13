// CI-only entry: real MCP UI and agent loop, without unrelated chat input/audio lifecycle.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { McpServers } from "../src/components/tools/mcp-servers";
import { ActionGate } from "../src/components/shared/action-gate";
import { actionToolsFor } from "../src/lib/action-schema";
import { makeDirectRound } from "../src/lib/chat-client";
import { runToolLoop, type RunToolLoopResult } from "../src/lib/tool-loop";
import { termuxTerminal } from "../src/lib/mcp-config";
import { useApp } from "../src/lib/store";
import "../src/styles.css";
await new Promise<void>((resolve) => {
  if (useApp.persist.hasHydrated()) resolve();
  else { const off = useApp.persist.onFinishHydration(() => { off(); resolve(); }); }
});
useApp.getState().setHydrated(true);
useApp.setState((state) => ({ settings: { ...state.settings,
  permissions: { ...state.settings.permissions, mcp_tools: "allow" },
  motion: "off", wakeEnabled: false, autonomyEnabled: false,
}, conversations: [], activeId: null, pendingActions: [], actionLog: [], httpTools: [],
  mcp: [{ ...termuxTerminal("http://127.0.0.1:8767", "native-test-token"), id: "native-termux", tools: [] }],
}));
let result: Pick<RunToolLoopResult, "content" | "rounds"> = { content: "", rounds: [] };
async function runNativeAi() {
  const messages = [{ role: "user" as const, content: "检查 Termux 环境并执行测试命令" }];
  const send = makeDirectRound({ model: "sonnet", customBaseUrl: "http://127.0.0.1:4650/v1", customApiKey: "fixture-key", upstreamModel: "fixture-model", messages });
  const completed = await runToolLoop({ baseMessages: messages, tools: actionToolsFor(["tool.call"]), send });
  result = { content: completed.error ? `ERROR: ${completed.error}` : completed.content, rounds: completed.rounds };
  return result;
}
function NativeRoot() {
  const [content, setContent] = useState("");
  return <main><h1>安卓原生 MCP 验收</h1><McpServers />
    <button className="k-btn" onClick={() => void runNativeAi().then((value) => setContent(value.content)).catch((error) => { result = { content: String(error), rounds: [] }; setContent(String(error)); })}>执行原生 AI 工具测试</button>
    <p>{content}</p><ActionGate />
  </main>;
}
const root = createRootRoute({ component: NativeRoot });
const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
Object.assign(window, { qidaoFixture: {
  read: () => ({ mcp: useApp.getState().mcp, messages: [result] }),
  setMcpUrl: (url: string) => useApp.getState().patchMcp("native-termux", { url, status: undefined, tools: [] }),
} });
createRoot(document.getElementById("fixture")!).render(<RouterProvider router={router} />);
