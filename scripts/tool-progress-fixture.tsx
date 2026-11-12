// Browser fixture: real components, with the action execution boundary stubbed by Playwright.
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { ThinkingSheet } from "../src/components/chat/thinking-sheet";
import { ActionGate } from "../src/components/shared/action-gate";
import { useApp } from "../src/lib/store";
import { toolProgressLabel } from "../src/lib/tool-title";
import { resetExternalTools } from "../src/lib/external-tools";
import { waitHydrated } from "../src/lib/store-ready";
import type { AppAction, ChatStep } from "../src/lib/types";
import "../src/styles.css";

const scene = new URLSearchParams(location.search).get("scene") || "web";
const mode = new URLSearchParams(location.search).get("mode") || "live";
const samples: Record<string, { name: string; action: AppAction; permission: "web_search" | "mcp_tools" | "http_tools" }> = {
  web: { name: "web_search", action: { kind: "web.search", query: "山东女子开车撞翻300多斤切糕索赔" }, permission: "web_search" },
  read: { name: "web_fetch", action: { kind: "web.fetch", url: "https://example.com/article" }, permission: "web_search" },
  mcp: { name: "mcp_memory_search", action: { kind: "tool.call", server: "记忆", tool: "检索", args: { query: "上次聊天" } }, permission: "mcp_tools" },
  http: { name: "http_weather", action: { kind: "http.call", tool: "天气", args: { city: "上海" } }, permission: "http_tools" },
};
resetExternalTools([{ kind: "mcp", name: "mcp_memory_search", server: "记忆", tool: "检索" }, { kind: "http", name: "http_weather", tool: "天气" }]);
const sample = samples[scene] ?? samples.web;
const activeStep = `第 1 步 · 正在执行 ${toolProgressLabel([{ name: sample.name, args: "{}" }])}`;
const steps: ChatStep[] = [{ kind: "think", text: "先核对来源，再根据查到的结果回答。" }];
if (mode === "done") steps.push({ kind: "call", call: { name: sample.name, kind: sample.action.kind,
  title: scene === "mcp" ? "MCP · 记忆/检索" : "网页搜索", args: "{}", category: "ok", ok: true,
  result: "已找到两条相关记录：上次聊到了周末散步，以及那家常去的咖啡店。" } });

await waitHydrated();
useApp.setState((s) => ({ settings: { ...s.settings, aiName: "小克", permissions: {
  ...s.settings.permissions, [sample.permission]: mode === "ask" ? "ask" : "allow",
} }, pendingActions: mode === "done" ? [] : [{ id: "fixture-action", action: sample.action,
  title: "测试调用", permission: sample.permission, from: "AI", at: Date.now() }] }));

const route = createRootRoute({ component: () => <>
  <main className="p-6"><p>小克</p><p>工具过程展示验收</p></main>
  <ActionGate />
  <ThinkingSheet open text="" steps={steps} live={mode !== "done"}
    activeStep={mode === "ask" ? "等待你确认工具调用" : mode !== "done" ? activeStep : undefined} onClose={() => {}} />
</> });
const router = createRouter({ routeTree: route, history: createMemoryHistory({ initialEntries: ["/"] }) });
createRoot(document.getElementById("fixture")!).render(<RouterProvider router={router} />);
