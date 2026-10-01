/**
 * 纯函数工具，**不依赖任何浏览器 API 或 store** —— 这样服务端路由也能安全引用。
 */

/** 粗略估算 token：ASCII 每 4 字符约 1 个；中日韩每字约 1 个。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let wide = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii += 1;
    else wide += 1;
  }
  return Math.ceil(ascii / 4 + wide);
}

/** 给提示词算个稳定的短指纹，用来判断「前缀有没有变」。 */
export function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

/** 思考档案保留策略：返回按天数该清掉的条目 id。keepDays<=0 表示永久保留。 */
export function thinkingToPrune(
  archive: { id: string; createdAt: number }[],
  keepDays: number,
): string[] {
  if (!keepDays || keepDays <= 0) return [];
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  return archive.filter((t) => t.createdAt < cutoff).map((t) => t.id);
}
