/** Only control payloads and explicit placeholders are removed; ordinary emotion/sticker prose stays. */
const CONTROL = "emotion|emotion_report|emotion_state|sticker|status|tool_call|function_call|tool_result";
function internalObject(text: string): boolean {
  return /["']kind["']\s*:\s*["'](?:emotion\.report|sticker\.send)/i.test(text)
    || /["'](?:name|function)["']\s*:\s*["'][^"']*(?:emotion_report|sticker_send)/i.test(text)
    || /["']primaryEmotion["']\s*:/.test(text)
    || (/\b(?:intensity|confidence)\s*[:=]/i.test(text) && /\b(?:primaryEmotion|suggestedMode|secondaryEmotions)\s*[:=]/i.test(text));
}
export function cleanAssistantMarkup(raw: string): string {
  let text = (raw || "")
    .replace(/```(?:json|qidao)?[ \t]*\n([\s\S]*?)```/gi, (all, body: string) => internalObject(body) ? "" : all)
    .replace(/```(?:json|qidao)\b[\s\S]*$/i, (all) => internalObject(all) ? "" : all)
    .replace(new RegExp(`<(${CONTROL})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi"), "")
    .replace(new RegExp(`<(?:${CONTROL})\\b[^>]*\\/\\s*>`, "gi"), "")
    .replace(new RegExp(`<(?:${CONTROL})\\b[^>]*>[\\s\\S]*$`, "gi"), "")
    .replace(new RegExp(`<(?:${CONTROL})\\b[^>]*$`, "gi"), "");
  let out = "";
  for (let i = 0; i < text.length;) {
    if (text[i] !== "{") { out += text[i++]; continue; }
    let depth = 0, quote = "", escaped = false, end = text.length;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (quote) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === quote) quote = ""; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { end = j + 1; break; }
    }
    const chunk = text.slice(i, end);
    if (!internalObject(chunk)) out += chunk;
    i = end;
  }
  return out
    .replace(/(?:\[|【|（|\()\s*(?:表情包|sticker|emotion)(?:\s*[:：][^\]】）)\n]*)?\s*(?:\]|】|）|\))/gi, "")
    .replace(/^\s*表情包\s*$/gm, "")
    .replace(/^\s*(?:primaryEmotion|secondaryEmotions|suggestedMode|intensity|confidence)\s*[:=：][^\n]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function stickerAttachment(url: string, id: string) {
  if (!/^(?:data:image\/[a-z0-9.+-]+[;,]|https?:\/\/|blob:|\/(?!\/))/i.test(url)) return null;
  const mime = url.match(/^data:(image\/[^;,]+)/i)?.[1]
    || (/\.gif(?:\?|$)/i.test(url) ? "image/gif" : /\.webp(?:\?|$)/i.test(url) ? "image/webp" : "image/png");
  return { id, kind: "sticker" as const, name: "表情", mime, size: 0, dataUrl: url };
}
