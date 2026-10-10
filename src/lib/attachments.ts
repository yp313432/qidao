import type { Attachment } from "@/lib/types";
import { uid } from "@/lib/utils";

/**
 * 附件处理：图片压一压再转 dataURL，文本/代码文件抽出正文。
 *
 * 图片压到长边 1280 是有意的 —— 原图直接塞进请求体会让上下文瞬间爆炸，
 * 也会让本地存储爆掉。
 */

const MAX_IMAGE_EDGE = 1280;
const MAX_TEXT_CHARS = 60_000;

const TEXT_EXT =
  /\.(txt|md|markdown|json|jsonc|ya?ml|toml|ini|csv|tsv|log|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|bash|zsh|sql|vue|svelte)$/i;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error("读文件失败"));
    fr.readAsDataURL(file);
  });
}

async function shrinkImage(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("图片解不开"));
      i.src = original;
    });
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
    if (scale >= 1 && file.size < 500_000) return original;

    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, w, h);
    // PNG 保留透明，其余转 jpeg 省体积
    const keepPng = file.type === "image/png";
    return canvas.toDataURL(keepPng ? "image/png" : "image/jpeg", 0.82);
  } catch {
    return original;
  }
}

/**
 * **表情包入库**（跟普通图片那条路分开走，原因很实在）：
 *
 * 用户原话（2026-11）："保存的话也是照片，然后传上也是照片，还是有白边的，
 * 就不是表情包那个格式了。"
 *
 * 两个坑都在 `shrinkImage()` 那一步：
 *   1. 它**总是走 canvas 重画** → **GIF 动图直接变成静态的第一帧**（表情包废一半）
 *   2. 它不处理**白底** → 照片没有透明通道，贴到聊天里就是一块白边
 *
 * 所以这里：**动图/透明格式原样保留**（只要体积不离谱），其余才走缩放；
 * 白底由 `stripWhiteBackground()` 单独处理（它需要真读像素）。
 * 另外把长边限到 320 —— 表情在聊天里本来就只有一百多像素，存 4000px 是白占地方。
 */
const STICKER_MAX_EDGE = 320;
const STICKER_KEEP_BYTES = 512 * 1024;

export async function stickerFromFile(file: File): Promise<string> {
  const animatedOrAlpha = /^image\/(gif|webp|png)$/.test(file.type);
  if (animatedOrAlpha && file.size <= STICKER_KEEP_BYTES) return await readAsDataUrl(file);
  try {
    const original = await readAsDataUrl(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("图片解不开"));
      i.src = original;
    });
    const scale = Math.min(1, STICKER_MAX_EDGE / Math.max(img.width, img.height));
    if (scale >= 1 && file.size <= STICKER_KEEP_BYTES) return original;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, w, h);
    // ⚠️ 表情一律存 PNG：要保留透明（jpeg 会把透明变成黑/白底）
    return canvas.toDataURL("image/png");
  } catch {
    return await readAsDataUrl(file);
  }
}

/** 把一个文件变成附件；不认识的二进制只留名字和大小。 */
export async function fileToAttachment(file: File): Promise<Attachment> {
  const base = { id: uid("att"), name: file.name || "未命名", mime: file.type || "", size: file.size };

  if (file.type.startsWith("image/")) {
    return { ...base, kind: "image", dataUrl: await shrinkImage(file) };
  }

  if (TEXT_EXT.test(file.name) || file.type.startsWith("text/")) {
    try {
      const raw = await file.text();
      const truncated = raw.length > MAX_TEXT_CHARS;
      return {
        ...base,
        kind: "file",
        text: truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw,
        truncated,
      };
    } catch {
      return { ...base, kind: "file" };
    }
  }

  return { ...base, kind: "file" };
}

export async function filesToAttachments(files: File[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const f of files) {
    try {
      out.push(await fileToAttachment(f));
    } catch {
      /* 单个失败不影响其它 */
    }
  }
  return out;
}

/** 把附件折成给他看的文字（文本类附件、以及图片的说明）。 */
export function attachmentsToText(list: Attachment[] | undefined): string {
  if (!list || list.length === 0) return "";
  const parts: string[] = [];
  for (const a of list) {
    if (a.kind === "audio") {
      const secs = Math.max(1, Math.round((a.durationMs ?? 0) / 1000));
      parts.push(
        a.text
          ? `【语音消息 ${secs} 秒，转写出来的内容：${a.text}】`
          : `【语音消息 ${secs} 秒，但没能转成文字 —— 所以你听不到里面的内容，只能看到这条提示】`,
      );
    } else if (a.kind === "image") {
      parts.push(`【图片：${a.name}】`);
    } else if (a.kind === "sticker") {
      /**
       * 表情包：**他（或用户）发过来时，上游看到的就这一句**。
       *
       * 为什么不发图：图片只能挂在**用户**消息上（上游对 assistant 带图直接报错，
       * 见 `chat-client.ts` 的 `historyForApi`）。所以助手那句里的表情就折成这一行。
       */
      parts.push("【表情包】");
    } else if (a.text) {
      parts.push(`【附件：${a.name}】\n${a.text}${a.truncated ? "\n（内容过长，已截断）" : ""}`);
    } else {
      parts.push(`【附件：${a.name}（${Math.round(a.size / 1024)}KB，无法读取内容）】`);
    }
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

/** 人类可读的大小。 */
export function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
