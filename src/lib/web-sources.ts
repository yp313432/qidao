import { isPublicHttpUrl } from "./web-extract.ts";
import type { ChatMessage, ToolCallRecord } from "./types.ts";

export type WebSource = {
  index: number; title: string; url: string; snippet: string;
  engine?: string; query?: string;
  state: "summary" | "read" | "unavailable";
  excerpt?: string; why?: string; truncated?: boolean;
};
type Hit = { title: string; url: string; snippet: string };
export type WebReceipt =
  | { version: 1; kind: "web.search"; ok: boolean; summary: string; query: string; engine?: string; results: Hit[]; why?: string }
  | { version: 1; kind: "web.fetch"; ok: boolean; summary: string; url: string; title?: string; text?: string; truncated?: boolean; why?: string };
type Call = Pick<ToolCallRecord, "kind" | "name" | "args" | "result" | "ok">;

const text = (value: unknown, max = 6000) => typeof value === "string" ? value.slice(0, max) : "";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function publicUrl(raw: unknown): string {
  const checked = isPublicHttpUrl(text(raw).trim());
  return checked.ok && !checked.url.username && !checked.url.password ? checked.url.href : "";
}
function jsonIn(raw: string): Record<string, unknown> {
  try { return object(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))); }
  catch { return {}; }
}

/** Compare documents without changing the original address used to open them. */
export function sourceKey(raw: string): string {
  try { const url = new URL(raw); url.hash = ""; return url.href; }
  catch { return raw; }
}

/** Parse actual tool records only. Assistant prose is never used to manufacture sources. */
export function webReceiptFromCall(call: Call): WebReceipt | null {
  const kind = call.kind ?? ({ web_search: "web.search", web_fetch: "web.fetch" } as Record<string, string>)[call.name];
  if (kind !== "web.search" && kind !== "web.fetch") return null;
  const data = jsonIn(call.result);
  const args = jsonIn(call.args);
  if (data.version === 1 && data.kind === kind && typeof data.ok === "boolean") {
    if (kind === "web.search") {
      const results: Hit[] = [];
      for (const raw of Array.isArray(data.results) ? data.results.slice(0, 10) : []) {
        const hit = object(raw), url = publicUrl(hit.url), title = text(hit.title, 500).trim();
        if (url && title && !results.some((h) => sourceKey(h.url) === sourceKey(url))) results.push({ title, url, snippet: text(hit.snippet, 1000) });
      }
      const ok = data.ok && call.ok !== false && results.length > 0;
      return { version: 1, kind, ok, query: text(data.query, 1000), engine: text(data.engine, 80), results: ok ? results : [],
        summary: ok ? `找到 ${results.length} 个来源` : "这次搜索未取得可用结果", why: ok ? undefined : text(data.why || (data.ok ? "结果中没有可用的公开网页" : data.summary), 500) };
    }
    const url = publicUrl(data.url), body = text(data.text);
    const ok = data.ok && call.ok !== false && !!url && !!body.trim();
    return { version: 1, kind, ok, url, title: text(data.title, 500), text: ok ? body : undefined,
      summary: ok ? "已读取网页正文" : "这页正文未读到",
      truncated: data.truncated === true, why: ok ? undefined : text(data.why || (data.ok ? "未取得有效正文" : data.summary), 500) };
  }
  // Existing conversations stored human-readable receipts. Keep those links usable too.
  if (kind === "web.search") {
    const matches = [...call.result.matchAll(/^\s*\d+\.\s+([^\n]+)\n\s*(https?:\/\/[^\s]+)[ \t]*\n?/gm)];
    const results: Hit[] = [];
    for (let i = 0; i < matches.length && results.length < 10; i++) {
      const match = matches[i], url = publicUrl(match[2]);
      if (!url || results.some((h) => sourceKey(h.url) === sourceKey(url))) continue;
      const tail = call.result.slice(match.index! + match[0].length, matches[i + 1]?.index ?? call.result.length);
      const snippet = tail.split(/\n\s*(?:[（(]要用哪条|[（(]这个动作)/)[0].trim();
      results.push({ title: match[1].trim(), url, snippet: snippet.slice(0, 1000) });
    }
    if (!results.length) return null;
    const ok = call.ok !== false;
    return { version: 1, kind, ok, summary: ok ? `找到 ${results.length} 个来源` : "这次搜索未完成", query: text(args.query, 1000),
      engine: call.result.match(/结果来自\s+([^）)\s]+)/)?.[1], results: ok ? results : [] };
  }
  const old = call.result.match(/读到了：([^\n]*)\n(https?:\/\/[^\s（(]+)/);
  const url = publicUrl(old?.[2] || args.url);
  if (!url) return null;
  const bodyAt = call.result.indexOf("\n\n");
  const body = bodyAt >= 0 ? call.result.slice(bodyAt + 2, bodyAt + 6002).trim() : "";
  const ok = call.ok !== false && !!old && !!body;
  return { version: 1, kind, ok, url, title: old?.[1], text: ok ? body : undefined,
    summary: ok ? "已读取网页正文" : "这页正文未读到", why: ok ? undefined : text(call.result, 500) };
}

export function sourcesForReceipt(receipt: WebReceipt): WebSource[] {
  if (receipt.kind === "web.search") return receipt.ok ? receipt.results.map((hit, i): WebSource => ({ ...hit, index: i + 1,
    query: receipt.query, engine: receipt.engine, state: "summary" })) : [];
  if (!receipt.url) return [];
  return [{ index: 1, title: receipt.title || new URL(receipt.url).hostname, url: receipt.url, snippet: "",
    state: receipt.ok ? "read" : "unavailable", excerpt: receipt.text, why: receipt.why, truncated: receipt.truncated }];
}

export function collectWebSources(message: Pick<ChatMessage, "steps" | "rounds">): WebSource[] {
  const calls = [...(message.steps ?? []).flatMap((s) => s.kind === "call" ? [s.call] : []), ...(message.rounds ?? []).flatMap((r) => r.calls)];
  const found = new Map<string, WebSource>();
  for (const call of calls) {
    const receipt = webReceiptFromCall(call);
    if (!receipt) continue;
    for (const source of sourcesForReceipt(receipt)) {
      const key = sourceKey(source.url), previous = found.get(key);
      if (!previous) { if (found.size < 64) found.set(key, { ...source, index: found.size + 1 }); continue; }
      // Reading one page unsuccessfully cannot erase earlier search hits or a successful read.
      if (source.snippet && !previous.snippet) previous.snippet = source.snippet;
      if (source.query && !previous.query) previous.query = source.query;
      if (source.engine && !previous.engine) previous.engine = source.engine;
      if (receipt.kind === "web.search" && previous.title === new URL(previous.url).hostname) previous.title = source.title;
      if (source.state === "read" || (source.state === "unavailable" && previous.state !== "read")) {
        previous.state = source.state; previous.excerpt = source.excerpt; previous.why = source.why; previous.truncated = source.truncated;
        if (receipt.kind === "web.fetch" && receipt.title) previous.title = receipt.title;
      }
    }
  }
  return [...found.values()];
}

const cache = new WeakMap<object, WebSource[]>();
/** Store patches create new message objects; keep old source arrays stable during streaming. */
export function messageWebSources(message: Pick<ChatMessage, "steps" | "rounds">): WebSource[] {
  const cached = cache.get(message);
  if (cached) return cached;
  const sources = collectWebSources(message); cache.set(message, sources); return sources;
}

export function sourceForUrl(sources: WebSource[] | undefined, url: string): WebSource | undefined {
  const key = sourceKey(url);
  return sources?.find((source) => sourceKey(source.url) === key);
}
