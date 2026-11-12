/** Punctuation-based message segmentation. Markdown structures remain indivisible. */
export const SEGMENT_SEP = "|||"; // Read old conversations; new prompts never request this marker.
export const SEGMENT_LIMITS = {
  maxParts: { min: 1, max: 12, def: 6 },
  maxSentences: { min: 1, max: 4, def: 1 },
  delayMs: { min: 400, max: 4000, def: 1200 },
  charDelayMs: { min: 20, max: 120, def: 60 },
} as const;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

function sentences(text: string): string[] {
  const protectedAt = new Uint8Array(text.length);
  for (const match of text.matchAll(/`[^`\n]+`|!?\[[^\]\n]*\]\([^\n)]*\)|https?:\/\/[^\s<>。！？]+|\b[\w.+-]+@[\w.-]+\.[a-z]+/gi)) {
    const protectedText = /^https?:/i.test(match[0]) ? match[0].replace(/[.,!?;:…”’"'）)\]}]+$/, "") : match[0];
    protectedAt.fill(1, match.index, match.index + protectedText.length);
  }
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (protectedAt[i] || !/[。！？!?….]/.test(text[i])) continue;
    if (text[i] === ".") {
      if (/\d/.test(text[i - 1] || "") && /\d/.test(text[i + 1] || "")) continue;
      if (text[i + 1] === ".") continue;
      const word = text.slice(0, i).match(/([A-Za-z.]+)$/)?.[1] || "";
      if (/^(?:Mr|Mrs|Ms|Dr|Prof|etc|vs|e\.g|i\.e)$/i.test(word)) continue;
      if (text[i + 1] && !/[\s”’"'）)\]}]/.test(text[i + 1])) continue;
    }
    while (i + 1 < text.length && /[。！？!?….]/.test(text[i + 1])) i++;
    while (i + 1 < text.length && /[”’"'」』）)\]}]/.test(text[i + 1])) i++;
    const part = text.slice(start, i + 1).trim();
    if (part) out.push(part);
    start = i + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function blocks(raw: string): { text: string; atomic: boolean }[] {
  const out: { text: string; atomic: boolean }[] = [];
  let lines: string[] = [], fence = "", structural = false;
  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) out.push({ text, atomic: Boolean(fence) || structural });
    lines = []; structural = false;
  };
  for (const line of raw.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,}|\$\$)/)?.[1];
    if (fence) {
      lines.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) { flush(); fence = ""; }
      continue;
    }
    if (marker) { flush(); fence = marker; lines.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    const atomic = /^\s*(?:[-*+]\s|\d+[.)]\s|>\s?|\||#{1,6}\s)/.test(line) || /(?<!\|)\|(?!\|)/.test(line);
    if (lines.length && structural !== atomic) flush();
    structural = atomic;
    lines.push(line);
  }
  flush();
  return out;
}

export function splitSegments(raw: string, opts: { maxParts?: number; maxSentences?: number } = {}): string[] {
  const text = (raw || "").trim();
  if (!text) return [];
  const maxParts = clamp(opts.maxParts ?? SEGMENT_LIMITS.maxParts.def, 1, 12);
  const per = clamp(opts.maxSentences ?? SEGMENT_LIMITS.maxSentences.def, 1, 12);
  const parts: string[] = [];
  for (const block of blocks(text)) {
    if (block.atomic) { parts.push(block.text); continue; }
    for (const legacy of block.text.split(SEGMENT_SEP)) {
      const split = sentences(legacy);
      for (let i = 0; i < split.length; i += per) parts.push(split.slice(i, i + per).join(" "));
    }
  }
  if (maxParts === 1) return [parts.join("\n\n")];
  return parts.length > maxParts
    ? [...parts.slice(0, maxParts - 1), parts.slice(maxParts - 1).join("\n\n")]
    : parts;
}
export function firstSegment(raw: string): string { return splitSegments(raw)[0] || ""; }
export function isSegmented(raw: string): boolean { return splitSegments(raw).length > 1; }
export function partsFor(raw: string, opts: { enabled?: boolean; maxParts?: number; maxSentences?: number } = {}): string[] | undefined {
  if (opts.enabled === false) return undefined;
  const parts = splitSegments(raw, opts);
  return parts.length > 1 ? parts : undefined;
}
export function stripInvisible(s: string): string { return (s || "").replace(/[\u200b-\u200f\u2060\ufeff]/g, ""); }
export function typingDelay(text: string, opts: { smart?: boolean; charDelayMs?: number; delayMs?: number } = {}): number {
  return opts.smart === false ? clamp(opts.delayMs ?? 1200, 400, 4000)
    : clamp(Array.from(text).length * (opts.charDelayMs ?? 60), 400, 4000);
}

/** One due bubble per tick. A suspended tab never releases the whole backlog at once. */
export class BubbleDelivery {
  visible: string[] = [];
  dueAt = 0;
  private target: string[] = [];
  private pending = "";
  private wait: (text: string) => number;
  constructor(wait: (text: string) => number) { this.wait = wait; }
  update(parts: string[], liveTail: boolean, now: number) {
    let common = 0;
    while (common < this.visible.length && common < parts.length) {
      if (this.visible[common] === parts[common] || (common === 0 && parts[0].startsWith(this.visible[0]))) common++;
      else break;
    }
    this.visible = parts.slice(0, common);
    this.target = liveTail ? parts.slice(0, -1) : parts;
    if (!this.visible.length && this.target.length) this.visible = [this.target[0]];
    this.schedule(now);
  }
  tick(now: number) {
    if (this.pending && now >= this.dueAt) {
      this.visible = [...this.visible, this.pending];
      this.pending = "";
      this.schedule(now);
    }
  }
  private schedule(now: number) {
    const next = this.target[this.visible.length] || "";
    if (!next) { this.pending = ""; this.dueAt = 0; return; }
    if (next !== this.pending) {
      this.pending = next;
      this.dueAt = next ? now + this.wait(next) : 0;
    }
  }
}
