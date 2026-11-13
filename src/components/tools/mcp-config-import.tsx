import { useState } from "react";
import { KButton } from "@/components/ui-kit";
import { useApp } from "@/lib/store";
import { importMcpConfig, termuxConfig } from "@/lib/mcp-config";
import bridgeScript from "../../../public/bridges/qidao-mcp-bridge.mjs?raw";
import { TextInput, TextArea } from "./editor-page";

function download(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function McpConfigImport() {
  const servers = useApp((s) => s.mcp);
  const [raw, setRaw] = useState(""), [message, setMessage] = useState("");
  const [bridgeUrl, setBridgeUrl] = useState("http://127.0.0.1:8767");
  function install() {
    try {
      const imported = importMcpConfig(raw, bridgeUrl);
      const names = new Set(servers.map((server) => server.name));
      for (const server of imported) { if (names.has(server.name)) throw new Error(`已有同名服务：${server.name}，请先改名或删除旧记录`); names.add(server.name); }
      for (const server of imported) useApp.getState().addMcp({ ...server, tools: [] });
      const locals = imported.filter((server) => server.transport === "stdio").length;
      setMessage(`已导入 ${imported.length} 个服务。${locals ? `${locals} 个需要在 Termux 启动下方桥接脚本后再测试连接。` : "现在可点测试连接。"}`);
      setRaw("");
    } catch (error) { setMessage((error as Error).message || "配置导入失败"); }
  }
  return <div className="k-list">
    <details className="k-note"><summary>导入社区 MCP 配置</summary><div className="k-note__body k-list">
      <TextArea label="粘贴 mcpServers JSON 配置" rows={7} value={raw} onChange={setRaw} placeholder={'{"mcpServers":{"服务名":{"type":"streamable_http","url":"https://example.com/mcp"}}}'} />
      <TextInput label="Termux 桥接地址（command 型服务使用）" value={bridgeUrl} onChange={setBridgeUrl} />
      <KButton disabled={!raw.trim()} onClick={install}>导入配置</KButton>
      <p>远程 HTTP / SSE 直接连接；npx、uvx、Python 配置保留命令、参数和环境变量，通过你的 Termux 运行。</p>
    </div></details>
    {message && <p role="status" className="k-note">{message}</p>}
    {servers.some((server) => server.transport === "stdio") && <details className="k-note"><summary>用已有 Termux 运行本地 MCP</summary><div className="k-note__body k-list">
      <p>先在 Termux 安装所需的 Node.js / Python / uv 及服务依赖。下载下面两个文件，配置文件包含你填写的环境变量和连接令牌，请保留在自己的设备上。</p>
      <KButton onClick={() => download("qidao-mcp-bridge.mjs", bridgeScript)}>下载桥接脚本</KButton>
      <KButton onClick={() => download("qidao-mcp.json", JSON.stringify(termuxConfig(servers), null, 2))}>导出 Termux 配置</KButton>
      <p>文件放在手机 Download 目录后，在 Termux 运行：</p>
      <pre className="k-long">{'termux-setup-storage\npkg install nodejs\nnode ~/storage/downloads/qidao-mcp-bridge.mjs ~/storage/downloads/qidao-mcp.json'}</pre>
      <p>看到“桥接已启动”后回栖岛点测试连接。保持 Termux 运行；缺少解释器、依赖或 cwd 不存在时，服务仍无法启动，导入不会代替环境安装。</p>
    </div></details>}
  </div>;
}
