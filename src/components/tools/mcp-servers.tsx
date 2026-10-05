import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Wifi, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/store";
import type { McpServer, McpTransport } from "@/lib/types";
import { cn } from "@/lib/utils";

type Draft = Omit<McpServer, "id" | "tools" | "status"> & { id?: string };

const EMPTY: Draft = {
  name: "",
  description: "",
  transport: "http",
  url: "",
  command: "",
  args: "",
  headersText: "",
  enabled: true,
  kind: "mcp",
};

const TRANSPORTS: { id: McpTransport; label: string; hint: string }[] = [
  { id: "http", label: "HTTP", hint: "Streamable HTTP（推荐，浏览器能直连）" },
  { id: "sse", label: "SSE", hint: "Server-Sent Events 长连接" },
  { id: "stdio", label: "stdio", hint: "本地进程，需要服务端起子进程" },
];

function parseHeaders(text: string): Headers {
  const headers = new Headers();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return headers;
}

/**
 * 真实发起一次 MCP 的 `initialize` 握手（JSON-RPC 2.0）。
 * 这一步是真的在跟对方服务器说话，不是假装。
 */
async function probe(server: McpServer): Promise<{ ok: boolean; message: string }> {
  if (server.transport === "stdio") {
    return {
      ok: false,
      message:
        "stdio 型 MCP 要由服务端启动子进程，浏览器里连不了。\n需要在能起进程的环境跑服务端（自己的电脑 / VPS）；Vercel 这类 Serverless 起不了子进程，只能用 HTTP 或 SSE。",
    };
  }
  if (!server.url.trim()) return { ok: false, message: "还没填地址。" };

  const headers = parseHeaders(server.headersText);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (!headers.has("accept")) headers.set("accept", "application/json, text/event-stream");

  try {
    const res = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "qidao", version: "1.0.0" },
        },
      }),
    });
    const text = (await res.text()).slice(0, 1200);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}\n${text || "(空响应)"}` };

    let serverName = "";
    let version = "";
    try {
      const json = JSON.parse(text.replace(/^\s*data:\s*/m, "").split(/\n\n/)[0] ?? text) as {
        result?: { serverInfo?: { name?: string; version?: string } };
      };
      serverName = json.result?.serverInfo?.name ?? "";
      version = json.result?.serverInfo?.version ?? "";
    } catch {
      /* 可能是 SSE 分块，解析不了也不影响「连通」的结论 */
    }
    return {
      ok: true,
      message: serverName
        ? `握手成功 · 服务端 ${serverName}${version ? ` ${version}` : ""}`
        : "握手成功（对方有响应，但没解析出 serverInfo）",
    };
  } catch (err) {
    return {
      ok: false,
      message: `${(err as Error).message || "请求失败"}\n\n常见原因：对方没开跨域(CORS)、地址写错、或网络不通。`,
    };
  }
}

export function McpServers() {
  const servers = useApp((s) => s.mcp);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  async function test(server: McpServer) {
    setTesting(server.id);
    const result = await probe(server);
    useApp.getState().patchMcp(server.id, {
      status: { ok: result.ok, at: Date.now(), message: result.message },
    });
    setTesting(null);
  }

  function save() {
    if (!draft) return;
    if (!draft.name.trim()) return;
    const st = useApp.getState();
    if (draft.id) {
      const { id, ...patch } = draft;
      st.patchMcp(id, patch);
    } else {
      const { id: _ignored, ...rest } = draft;
      st.addMcp({ ...rest, tools: [] });
    }
    setDraft(null);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-dashed border-line px-4 py-3">
        <p className="text-[13px] font-medium">配置现在就能填，握手也是真的</p>
        <p className="mt-1 text-[12px] leading-5 text-muted">
          在这里填你自己的 MCP 服务器（比如 Horizon），「测试连接」会真的发一次 JSON-RPC{" "}
          <code className="font-mono">initialize</code> 握手。但要注意：
          <span className="font-medium text-fg">被模型自动调用</span>
          这一步仍然要等接入 AI —— 因为调用方是模型。现在你能做的是「配置 + 验证它连得通」。
        </p>
      </div>

      {servers.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">还没有 MCP 服务器，点下面添加</p>
      )}

      {servers.map((s) => (
        <article key={s.id} className="rounded-3xl border border-line bg-surface px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 rounded-full bg-chip px-2.5 py-1 font-mono text-[11px] uppercase">
              {s.transport}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.name}</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                {s.transport === "stdio" ? `${s.command} ${s.args}`.trim() || "(未填命令)" : s.url || "(未填地址)"}
              </p>
              {s.description && (
                <p className="mt-1 text-[12px] leading-5 text-muted">{s.description}</p>
              )}
            </div>
            <Switch
              checked={s.enabled}
              label={s.name}
              onCheckedChange={() => useApp.getState().toggleMcp(s.id)}
            />
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void test(s)}
              disabled={testing === s.id}
              className="flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[13px] font-medium text-ink-fg disabled:opacity-60"
            >
              {testing === s.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Wifi className="size-3.5" />
              )}
              测试连接
            </button>
            <button
              type="button"
              aria-label="编辑"
              onClick={() =>
                setDraft({
                  id: s.id,
                  name: s.name,
                  description: s.description,
                  transport: s.transport,
                  url: s.url,
                  command: s.command,
                  args: s.args,
                  headersText: s.headersText,
                  enabled: s.enabled,
                  kind: s.kind,
                })
              }
              className="rounded-full bg-chip p-2 text-muted"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="删除"
              onClick={() => useApp.getState().removeMcp(s.id)}
              className="rounded-full bg-chip p-2 text-muted"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          {s.status && (
            <div className="mt-2.5 rounded-2xl bg-chip px-3 py-2.5">
              <p className={cn("text-[12px] font-medium", s.status.ok ? "text-ok" : "text-warn")}>
                {s.status.ok ? "连通" : "未连通"}
              </p>
              <pre className="mt-1.5 max-h-40 overflow-auto font-mono text-[11px] leading-5 break-all whitespace-pre-wrap text-muted">
                {s.status.message}
              </pre>
            </div>
          )}
        </article>
      ))}

      <button
        type="button"
        onClick={() => setDraft({ ...EMPTY })}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm text-muted"
      >
        <Plus className="size-4" />
        添加 MCP 服务器
      </button>

      {draft && (
        <div className="fixed inset-0 z-40 flex items-end">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 bg-fg/20"
            onClick={() => setDraft(null)}
          />
          {/*
            跟 http-tools 同一个改法：「可滚动的字段区」+「固定在底部的按钮条」。
            原来整块面板 overflow-y-auto、保存按钮排在最底下 ——
            表单比屏幕高时按钮被挡在视口外，用户以为"没有保存按钮"
            （用户实测："新建 http 工具和 mcp 没有保存按钮，怎么用？"）。
          */}
          <div className="glass-panel relative z-10 flex max-h-[88vh] w-full flex-col rounded-t-[2.5rem]">
            <div className="flex items-center justify-between gap-2 px-5 pt-5">
              <p className="font-serif text-lg">{draft.id ? "编辑 MCP 服务器" : "添加 MCP 服务器"}</p>
              <div className="flex shrink-0 items-center gap-2">
                {/* 保存放**标题栏** —— 键盘弹起把面板压矮时它也不会跑到屏幕外 */}
                <button
                  type="button"
                  onClick={save}
                  disabled={!draft.name.trim()}
                  className="rounded-full bg-ink px-4 py-1.5 text-[13px] font-medium text-ink-fg disabled:opacity-40"
                >
                  保存
                </button>
                <button type="button" aria-label="关闭" onClick={() => setDraft(null)} className="size-9">
                  <X className="mx-auto size-5" />
                </button>
              </div>
            </div>
            {!draft.name.trim() && (
              <p className="px-5 pt-1 text-[11px] text-subtle">保存需要：名称</p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1">

            <label className="mt-4 block">
              <span className="text-[12px] text-muted">名称</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="例如：Horizon"
                className="mt-1 w-full rounded-2xl border border-line bg-chip px-4 py-2.5 text-[15px] outline-none placeholder:text-subtle"
              />
            </label>

            <label className="mt-3 block">
              <span className="text-[12px] text-muted">说明（可选）</span>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="它能做什么"
                className="mt-1 w-full rounded-2xl border border-line bg-chip px-4 py-2.5 text-[15px] outline-none placeholder:text-subtle"
              />
            </label>

            <div className="mt-3">
              <span className="text-[12px] text-muted">传输方式</span>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {TRANSPORTS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDraft({ ...draft, transport: t.id })}
                    className={cn(
                      "rounded-2xl border px-3 py-2.5 text-left",
                      draft.transport === t.id ? "border-fg" : "border-line",
                    )}
                  >
                    <span className="block text-[13px] font-medium">{t.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                {TRANSPORTS.find((t) => t.id === draft.transport)?.hint}
              </p>
            </div>

            {draft.transport === "stdio" ? (
              <>
                <label className="mt-3 block">
                  <span className="text-[12px] text-muted">命令</span>
                  <input
                    value={draft.command}
                    onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                    placeholder="npx"
                    className="mt-1 w-full rounded-2xl border border-line bg-chip px-4 py-2.5 font-mono text-[13px] outline-none placeholder:text-subtle"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-[12px] text-muted">参数</span>
                  <input
                    value={draft.args}
                    onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                    placeholder="-y @horizon/mcp-server"
                    className="mt-1 w-full rounded-2xl border border-line bg-chip px-4 py-2.5 font-mono text-[13px] outline-none placeholder:text-subtle"
                  />
                </label>
              </>
            ) : (
              <label className="mt-3 block">
                <span className="text-[12px] text-muted">地址</span>
                <input
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="https://example.com/mcp"
                  className="mt-1 w-full rounded-2xl border border-line bg-chip px-4 py-2.5 font-mono text-[13px] outline-none placeholder:text-subtle"
                />
              </label>
            )}

            <label className="mt-3 block">
              <span className="text-[12px] text-muted">请求头（每行一个 Key: Value）</span>
              <textarea
                value={draft.headersText}
                onChange={(e) => setDraft({ ...draft, headersText: e.target.value })}
                rows={3}
                placeholder={"Authorization: Bearer xxx"}
                className="mt-1 w-full resize-none rounded-2xl border border-line bg-chip px-4 py-3 font-mono text-[12px] leading-5 outline-none placeholder:text-subtle"
              />
            </label>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
