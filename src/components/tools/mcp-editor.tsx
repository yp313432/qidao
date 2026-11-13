import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { EditorPage, Segmented, TextArea, TextInput } from "@/components/tools/editor-page";
import { useApp } from "@/lib/store";
import type { McpServer } from "@/lib/types";

type Draft = Omit<McpServer, "id" | "tools" | "status"> & { id?: string };
export function McpEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const servers = useApp((s) => s.mcp);
  const existing = servers.find((s) => s.id === id);
  const [draft, setDraft] = useState<Draft>(() => existing ? { ...existing } : {
    name: "", description: "", transport: "http", url: "", command: "", args: "", headersText: "", enabled: true, kind: "mcp",
  });
  const [problem, setProblem] = useState("");
  const patch = (value: Partial<Draft>) => setDraft((current) => ({ ...current, ...value }));
  const canSave = Boolean(draft.name.trim() && draft.url.trim());
  function save() {
    try {
      if (!canSave) return;
      if (draft.name.trim() === "@skills") throw new Error("@skills 是系统保留名称，请换一个名字");
      const url = new URL(draft.url.trim());
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("请填写无内嵌密码的 HTTP 或 HTTPS 服务地址");
      const { id: savedId, ...rest } = draft;
      if (savedId) useApp.getState().patchMcp(savedId, rest);
      else useApp.getState().addMcp({ ...rest, tools: [] });
      void navigate({ to: "/tools" });
    } catch (error) { setProblem((error as Error).message); }
  }
  return <EditorPage title={existing ? "编辑 MCP 服务器" : "添加 MCP 服务器"} onSave={save} canSave={canSave} saveHint={!canSave ? "请填写名称和地址" : undefined}>
    {problem && <p role="alert" className="k-note">{problem}</p>}
    <TextInput label="名称" value={draft.name} onChange={(name) => patch({ name })} placeholder="社区服务名称" />
    <TextInput label="说明（可选）" value={draft.description} onChange={(description) => patch({ description })} />
    {draft.transport === "stdio" ? <p className="k-note">本地 MCP · 通过 Termux 桥接。命令和环境变量保留在社区导入配置中。</p> :
      <Segmented<"http" | "sse"> label="传输方式" value={draft.transport} onChange={(transport) => patch({ transport })}
        options={[{ id: "http", label: "Streamable HTTP" }, { id: "sse", label: "SSE" }]} />}
    <TextInput label="地址" value={draft.url} onChange={(url) => patch({ url })} mono placeholder="https://example.com/mcp"
      hint={draft.transport === "stdio" ? "Termux 桥接的服务地址；先保持桥接脚本运行" : "填写服务提供的完整 MCP 地址；GitHub 仓库主页不能作为连接地址"} />
    <TextArea label="请求头（每行一个 Key: Value）" value={draft.headersText} onChange={(headersText) => patch({ headersText })} rows={4} placeholder="Authorization: Bearer xxx" />
    <p className="k-note">保存后回列表点测试连接。拿到工具清单后，AI 才能调用。App 走原生网络；浏览器仍需服务开放跨域。</p>
  </EditorPage>;
}
