export type MessageLink = { start: number; end: number; label: string; url: string };

/** Only web links are actionable; never turn generated script/app schemes into navigation. */
export function messageWebUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Markdown links and bare URLs, including balanced parentheses in an address. */
export function messageLinks(text: string): MessageLink[] {
  const links: MessageLink[] = [];
  const starts = /\[([^\]\n]+)\]\(<?(https?:\/\/)|https?:\/\//gi;
  let match: RegExpExecArray | null;
  while ((match = starts.exec(text))) {
    // Leave image syntax alone: the chat renders attachments separately.
    if (match[1] && text[match.index - 1] === "!") continue;
    const markdown = match[1] !== undefined;
    const start = markdown ? starts.lastIndex - match[2].length : match.index;
    let end = start;
    let depth = 0;
    while (end < text.length && !/[\s<>"'`\[\]，。！？；：、）】》」』]/.test(text[end])) {
      const char = text[end];
      if (char === "(") depth++;
      if (char === ")") { if (depth === 0) break; depth--; }
      end++;
    }
    if (!markdown) {
      while (end > start && /[.,!?;:]/.test(text[end - 1])) end--;
    }
    const raw = text.slice(start, end);
    const url = messageWebUrl(raw);
    const closing = text[end] === ">" ? end + 1 : end;
    if (!url || (markdown && text[closing] !== ")")) continue;
    links.push({ start: match.index, end: markdown ? closing + 1 : end, label: match[1] ?? raw, url });
    starts.lastIndex = links.at(-1)!.end;
  }
  return links;
}
