import { isNativeApp } from "@/lib/platform";
import { saveNativeTextFile } from "@/lib/native-device";
import { useState } from "react";
import { KButton } from "@/components/ui-kit";
import { useApp } from "@/lib/store";
import { importMcpConfig, termuxConfig, termuxTerminal } from "@/lib/mcp-config";
import bridgeScript from "../../../public/bridges/qidao-mcp-bridge.mjs?raw";
import { TextInput, TextArea } from "./editor-page";

async function download(name: string, contents: string) {
  if (isNativeApp()) return saveNativeTextFile(name, contents);
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export function McpConfigImport() {
  const servers = useApp((s) => s.mcp);
  const [raw, setRaw] = useState(""), [message, setMessage] = useState("");
  const [bridgeUrl, setBridgeUrl] = useState("http://127.0.0.1:8767");
  async function exportFile(name: string, contents: string) {
    try { if (await download(name, contents)) setMessage(`已保存 ${name}；请放在手机 Download 目录。`); }
    catch (error) { setMessage(`文件保存失败：${(error as Error).message}`); }
  }
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
  function connectTerminal() {
    try {
      if (servers.some((server) => (server.bridgeRole === "terminal" || server.name === "Termux 终端"))) { setMessage("已添加 Termux，展开下方说明启动桥接后测试连接。"); return; }
      useApp.getState().addMcp({ ...termuxTerminal(bridgeUrl), tools: [] });
      setMessage("已添加 Termux 控制入口。下载脚本和配置、在 Termux 首次启动后测试连接，AI 才能执行命令。");
    } catch (error) { setMessage((error as Error).message); }
  }
  return <div className="k-list">
    <details className="k-note"><summary>让 AI 操作 Termux</summary><div className="k-note__body k-list">
      <p>连接后 AI 可以检查环境、安装 MCP 依赖、执行命令和读取退出码。命令通过现有工具权限确认后执行；首次启动仍需你在 Termux 操作一次。</p>
      <TextInput label="手机上的 Termux 桥接地址" value={bridgeUrl} onChange={setBridgeUrl} />
      <KButton onClick={connectTerminal}>添加 Termux 控制</KButton>
    </div></details>
    <details className="k-note"><summary>导入社区 MCP 配置</summary><div className="k-note__body k-list">
      <TextArea label="粘贴 mcpServers JSON 配置" rows={7} value={raw} onChange={setRaw} placeholder={'{"mcpServers":{"服务名":{"type":"streamable_http","url":"https://example.com/mcp"}}}'} />
      <TextInput label="Termux 桥接地址（command 型服务使用）" value={bridgeUrl} onChange={setBridgeUrl} />
      <KButton disabled={!raw.trim()} onClick={install}>导入配置</KButton>
      <p>远程 HTTP / SSE 直接连接；npx、uvx、Python 配置保留命令、参数和环境变量，通过你的 Termux 运行。</p>
    </div></details>
    {message && <p role="status" className="k-note">{message}</p>}
    {servers.some((server) => server.transport === "stdio" || server.bridgeRole === "terminal") && <details className="k-note"><summary>Termux 首次连接与本地 MCP</summary><div className="k-note__body k-list">
      <p>首次先在 Termux 安装 Node.js。启用终端工具后，其余兼容的 Python / uv / MCP 依赖可请 AI 检查并安装。下载下面两个文件，配置文件包含你填写的环境变量和连接令牌，请保留在自己的设备上。</p>
      <KButton onClick={() => void exportFile("qidao-mcp-bridge.mjs", bridgeScript)}>下载桥接脚本</KButton>
      <KButton onClick={() => void exportFile("qidao-mcp.json", JSON.stringify(termuxConfig(servers), null, 2))}>导出 Termux 配置</KButton>
      <p>文件放在手机 Download 目录后，在 Termux 运行：</p>
      <pre className="k-long">{'termux-setup-storage\npkg install nodejs\nnode ~/storage/downloads/qidao-mcp-bridge.mjs ~/storage/downloads/qidao-mcp.json'}</pre>
      <p>看到“桥接已启动”后回栖岛点测试连接，再说“检查 Termux 环境并帮我配置 MCP”。任务启动后 AI 要查询状态，直到拿到输出和退出码。保持 Termux 运行；修改配置后需重新导出并重启桥接。终端任务不支持交互输入，请使用无需交互的安装命令。</p>
    </div></details>}
  </div>;
}
