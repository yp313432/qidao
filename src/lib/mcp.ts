import type { McpServer } from "./types";

/**
 * 默认不再预置任何 MCP 服务器。
 *
 * 以前这里写死了 6 条（长期记忆 / 网页抓取 / 工作区文件 / GitHub …），
 * 每条都只有名字和描述、背后没有任何连接，开关也只改本地布尔值 ——
 * 属于「能看不能用」。现在改成空列表，由用户在「工具 → MCP」里
 * 填自己的真实配置（比如 Horizon），并能用真实握手测试连通性。
 */
export const DEFAULT_MCP: McpServer[] = [];
