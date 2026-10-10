/**
 * **去白底**：把"白底表情图"变成真正透明的表情包。
 *
 * 用户原话（2026-11）：
 *   "咱们这个表情包其实是从相册里面传……保存的话也是照片，然后传上也是照片，
 *    还是有白边的，就不是表情包那个格式了。"
 *
 * 白边就是这么来的：相册里的图是**不透明**的（照片/白底截图），而表情包的标准
 * （微信 240×240 GIF/PNG、Telegram 512 透明 PNG/WebP、WhatsApp 512 WebP）都要求
 * **透明背景**。所以入库这一步得把白底抠掉。
 *
 * ── 为什么用"从边缘漫水填充"而不是"全图去掉白色" ──────────────
 *   表情图**内部**常常也有白色（眼白、白衣服、白字）。全局去白会把它们一起掏空，
 *   变成"漏气"的表情。从**边缘**开始 flood fill，只吃"跟外界连通的白色区域"，
 *   内部的白就留住了 —— 这是这个算法唯一要写对的地方。
 *
 * 只在**真的检测到一圈白边**时才动手；否则原样返回 null（让调用方用原图）。
 */
/** 判定"白"的容差：0 = 纯白（255,255,255），越大越宽松 */
const DEFAULT_TOLERANCE = 26;
/** 处理前先缩放的上限（手机上一张 4000px 的相机图算 flood fill 会卡） */
const MAX_EDGE = 512;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("这张图解不开"));
    img.src = dataUrl;
  });
}

/**
 * @returns 透明版 PNG 的 dataURL；**没有可去的白底**（或浏览器不支持）时返回 null
 */
export async function stripWhiteBackground(
  dataUrl: string,
  tolerance = DEFAULT_TOLERANCE,
): Promise<string | null> {
  if (typeof document === "undefined") return null;
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);

    const image = ctx.getImageData(0, 0, w, h);
    const px = image.data;
    const white = (i: number) =>
      px[i] >= 255 - tolerance && px[i + 1] >= 255 - tolerance && px[i + 2] >= 255 - tolerance;

    /**
     * 先从**四条边**上找"白"的种子。一条边一个白点都找不到，就认为这不是白底图 ——
     * 直接放弃（避免把正常照片的边缘吃掉）。
     */
    const seed: number[] = [];
    for (let x = 0; x < w; x += 1) {
      const top = (0 * w + x) * 4;
      const bottom = ((h - 1) * w + x) * 4;
      if (white(top)) seed.push(0, x);
      if (white(bottom)) seed.push(h - 1, x);
    }
    for (let y = 0; y < h; y += 1) {
      const left = (y * w + 0) * 4;
      const right = (y * w + w - 1) * 4;
      if (white(left)) seed.push(y, 0);
      if (white(right)) seed.push(y, w - 1);
    }
    const border = 2 * (w + h);
    if (seed.length / 2 < border * 0.5) return null; // 白边不到一半 → 不是白底图

    /** 栈式 flood fill（不用递归：大图递归会爆栈） */
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let i = 0; i < seed.length; i += 2) {
      const y = seed[i];
      const x = seed[i + 1];
      const flat = y * w + x;
      if (seen[flat]) continue;
      seen[flat] = 1;
      stack.push(flat);
    }
    while (stack.length > 0) {
      const flat = stack.pop() as number;
      const i = flat * 4;
      px[i + 3] = 0; // 透明
      const x = flat % w;
      const y = (flat - x) / w;
      /** 四邻（只处理"白的"邻居；不连通的内部白自动保留） */
      if (x > 0) {
        const n = flat - 1;
        if (!seen[n] && white(n * 4)) {
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (x < w - 1) {
        const n = flat + 1;
        if (!seen[n] && white(n * 4)) {
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (y > 0) {
        const n = flat - w;
        if (!seen[n] && white(n * 4)) {
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (y < h - 1) {
        const n = flat + w;
        if (!seen[n] && white(n * 4)) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }

    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
