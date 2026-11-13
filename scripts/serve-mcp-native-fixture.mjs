import { createServer } from "node:http";
import { startMcpBridge } from "../public/bridges/qidao-mcp-bridge.mjs";
const bridge = startMcpBridge({ qidaoBridge: { terminalEnabled: true, tokens: { __qidao_terminal: "native-test-token" } } });
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "content-type": "application/json" };
const upstream = createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors).end(); return; }
  if (req.method === "GET") { res.writeHead(200, cors).end('{"ok":true}'); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const results = body.messages.filter((message) => message.role === "tool");
  const used = results.length;
  const message = { role: "assistant", content: "MCP_NATIVE_ANDROID_OK", reasoning_content: `原生工具检查${used}` };
  if (used < 4) {
    const tool = ["environment", "status", "execute", "status"][used];
    let jobId;
    if (tool === "status") {
      const text = results.at(-1).content;
      try { jobId = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).jobId; }
      catch { res.writeHead(500, cors).end(JSON.stringify({ error: `Native tool did not return a job: ${text}` })); return; }
    }
    const args = tool === "environment" ? {} : tool === "execute" ? { command: "printf NATIVE_TERMUX_OK" } : { jobId, waitMs: 20000 };
    const builtin = body.tools?.find((tool) => tool.function.name === "tool_call");
    const name = builtin?.function.name || body.tools?.find((entry) => entry.function.name.startsWith("mcp_") && entry.function.name.endsWith(`_${tool}`))?.function.name;
    if (!name) { res.writeHead(500, cors).end(JSON.stringify({ error: `Missing native tool ${tool}` })); return; }
    const payload = builtin ? { server: "Termux 终端", tool, args } : args;
    message.content = "";
    message.tool_calls = [{ id: `native_${used}`, type: "function", function: { name, arguments: JSON.stringify(builtin && used === 2 ? { arguments: payload } : payload) } }];
    console.log(`ANDROID_MODEL_TOOL ${used} ${name} ${tool}`);
  } else {
    if (!/NATIVE_TERMUX_OK/.test(results.at(-1).content) || !/"exitCode":0/.test(results.at(-1).content)) {
      res.writeHead(500, cors).end(JSON.stringify({ error: `Native terminal result invalid: ${results.at(-1).content}` })); return;
    }
    console.log("ANDROID_MCP_MODEL_RESULT real terminal stdout and exitCode verified");
  }
  if (body.stream === false) res.writeHead(200, cors).end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }));
  else {
    res.writeHead(200, { ...cors, "content-type": "text/event-stream" });
    const delta = { ...message }; delete delta.role;
    if (delta.tool_calls) delta.tool_calls[0].index = 0;
    res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  }
});
upstream.listen(4650, "127.0.0.1", () => console.log("Android native MCP fixtures ready"));
process.on("SIGTERM", () => { bridge.close(); upstream.close(); });
