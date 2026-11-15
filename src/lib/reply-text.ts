import { cleanAssistantMarkup } from "./assistant-cleanup.ts";

/** 线性时间计算前文尾部与续答头部的原样重叠。 */
function overlapLength(previous: string, current: string): number {
  const prefix = new Uint32Array(current.length);
  for (let i = 1, n = 0; i < current.length; i++) {
    while (n && current[i] !== current[n]) n = prefix[n - 1]!;
    if (current[i] === current[n]) n++;
    prefix[i] = n;
  }
  let n = 0;
  for (const character of previous.slice(-current.length).split("")) {
    if (n === current.length) n = prefix[n - 1]!;
    while (n && character !== current[n]) n = prefix[n - 1]!;
    if (character === current[n]) n++;
  }
  return n;
}

/** 只去除跨请求的原文重播/重叠，不用语义相似度删句，不改变同一轮内有意的重复。 */
export function mergeReplyText(previous: string, current: string): string {
  if (!current.trim()) return previous;
  if (!previous.trim()) return current;
  // 有的上游从头重播全文；流式重播还没追上旧正文时，也保住旧正文。
  if (current.startsWith(previous)) return current;
  if (previous.startsWith(current) || previous.endsWith(current)) return previous;
  const overlap = overlapLength(previous, current);
  if (overlap >= 12 || overlap >= 6 && /[\u3400-\u9fff]/.test(current.slice(0, overlap))) {
    return previous + current.slice(overlap);
  }
  // 有的中转在新开场后重复上一段，再给新增内容；仅去掉完全相同的长段落。
  const key = (text: string) => text.replace(/\s+/g, "").trim();
  const oldParagraphs = new Set(previous.split(/\n\s*\n/).map(key).filter((text) => text.length >= 12 && !/[`~]/.test(text)));
  const fresh = current.split(/(\n\s*\n)/).map((part) => oldParagraphs.has(key(part)) ? "" : part).join("").replace(/\n{3,}/g, "\n\n").trim();
  return fresh ? `${previous}\n\n${fresh}` : previous;
}

/** 接口偶尔把累计全文塞进 delta.content；对有充分前缀证据的累计快照输出真正新增部分。 */
export class StreamTextAccumulator {
  text = "";
  private snapshots = false;
  append(fragment: string, snapshot = false): string {
    if (!fragment) return "";
    const previous = this.text;
    if (snapshot || previous.length >= 12 && fragment.length > previous.length && fragment.startsWith(previous)) this.snapshots = true;
    if (this.snapshots && fragment.startsWith(previous)) this.text = fragment;
    else if (this.snapshots && previous.startsWith(fragment)) return "";
    else this.text += fragment;
    return this.text.slice(previous.length);
  }
}

const FINAL_SIDE_EFFECTS = new Set(["emotion.report", "sticker.send", "media.pause", "media.play", "media.next", "media.prev", "navigate"]);
/** 有正文、且仅有已完成的附带动作时无需再请模型组织一次回答。失败/待确认/查询仍须回灌。 */
export function canFinishAfterSideEffects(text: string, kinds: readonly (string | null)[], outcomes: readonly { ok: boolean; category?: string; alreadyCompleted?: boolean }[]): boolean {
  const visible = cleanAssistantMarkup(text).replace(/```qidao[\s\S]*?```/g, "").trim();
  if (!visible || /^(?:我去|让我|稍等|等一下|等我|我先)(?:查|看|搜|找|确认|核对|一下|一会)/.test(visible)
    || visible.length < 200 && /(?:稍等|我去|让我|我先|需要|准备|我来).{0,10}(?:查|搜|核对|确认|看一下)/.test(visible)) return false;
  return kinds.length > 0 && outcomes.length === kinds.length
    && kinds.every((kind) => kind !== null && FINAL_SIDE_EFFECTS.has(kind))
    && outcomes.every((outcome) => outcome.ok || outcome.category === "skipped" && outcome.alreadyCompleted === true);
}

