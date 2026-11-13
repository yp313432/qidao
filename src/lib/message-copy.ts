import { messageLinks } from "./message-links.ts";

export type CopyFormat = "plain" | "markdown";

/** Keep code literal while removing prose formatting. Preserve line breaks and link destinations. */
export function messagePlainText(markdown: string): string {
  const literals: string[] = [];
  // Pick a marker absent from the message, so user content cannot collide with placeholders.
  let marker = "\uE000";
  while (markdown.includes(marker)) marker += "\uE000";
  const hold = (value: string) => `${marker}${literals.push(value) - 1}${marker}`;
  let text = markdown.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm,
    (_all, _fence: string, code: string) => hold(code.replace(/\n$/, "")));
  text = text.replace(/(`+)([^\n]*?)\1/g, (_all, _ticks: string, code: string) => hold(code));
  const links = messageLinks(text);
  for (const link of links.reverse()) {
    const label = link.label.replace(/\*\*([^*]+)\*\*/g, "$1");
    const value = label === link.url || label === text.slice(link.start, link.end)
      ? label : `${label} (${link.url})`;
    text = text.slice(0, link.start) + hold(value) + text.slice(link.end);
  }
  text = text
    .replace(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?$/gm, "$1")
    .replace(/^ {0,3}(?:>\s?)+/gm, "")
    .replace(/^([ \t]*)[-+*]\s+/gm, "$1• ")
    .replace(/^ {0,3}(?:([-*_])(?:\s*\1){2,}|[=-]{3,})[ \t]*$/gm, "")
    .replace(/\*\*([\s\S]+?)\*\*|__([\s\S]+?)__/g, (_all, a: string, b: string) => a ?? b)
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/(^|[\s(（])([*_])([^\s*_][^\n]*?)\2(?=$|[\s.,!?;:，。！？；：)）])/gm, "$1$3")
    .replace(/\\([\\`*{}\[\]()#+.!_>~-])/g, "$1");
  const token = new RegExp(`${marker}(\\d+)${marker}`, "g");
  // Inline code may have been protected inside a protected link label.
  for (let i = 0; i <= literals.length && token.test(text); i++) {
    token.lastIndex = 0;
    text = text.replace(token, (_all, n: string) => literals[Number(n)]);
  }
  return text;
}

export function messageCopyText(content: string, format: CopyFormat): string {
  return format === "markdown" ? content : messagePlainText(content);
}

/** Older WebViews may lack Clipboard API. Never report success for an absent/failed write. */
export async function copyMessageText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* Try the WebView-compatible selection path below. */ }
  const active = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px";
  // Stay inside a modal's focus trap when copying from its preview.
  (active?.closest('[role="dialog"]') ?? document.body).appendChild(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, text.length);
    if (!document.execCommand("copy")) throw new Error("clipboard unavailable");
  } finally {
    field.remove();
    active?.focus({ preventScroll: true });
    if (selection) { selection.removeAllRanges(); ranges.forEach((range) => selection.addRange(range)); }
  }
}
