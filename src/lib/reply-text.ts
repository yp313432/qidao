/** 合并工具前后的正文；只消除完整前文的原样重播，不按语义删掉已经显示的话。 */
export function mergeReplyText(previous: string, current: string): string {
  if (!current.trim()) return previous;
  if (!previous.trim()) return current;
  // 有的上游从头重播全文；流式重播还没追上旧正文时，也保住旧正文。
  if (current.startsWith(previous)) return current;
  if (previous.startsWith(current) || previous.endsWith(current)) return previous;
  return `${previous}\n\n${current}`;
}
