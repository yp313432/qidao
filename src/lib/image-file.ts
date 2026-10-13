/**
 * **把相册里选的图片读成一个 dataURL** —— 全 App 只有这一处。
 *
 * 为什么要有这个文件（而不是各页面自己写 FileReader）：
 * 用户在「我的 → 我的空间」换背景/头像、在朋友圈换封面，都是"选一张图 → 存进设置"，
 * 这是**同一个零件**。以前它藏在 `me-sections.tsx` 里当私有函数，
 * 新页面要用就只能再抄一份 —— 那就长出第二套写法了（§0.1 那条规矩）。
 *
 * ⚠️ `maxSide` 是**可选**的，别默认开：
 *   · 不传 = 原样读成 dataURL（跟以前**一模一样**的行为，老页面不受影响）；
 *   · 传了 = 先缩到"最长边 ≤ maxSide"再导出 JPEG。
 *
 * 为什么要能缩：设置是随存档一起序列化的（一个 JSON），
 * 手机相册随手一张 4000×3000 的原图当封面就是好几 MB ——
 * 每存一次都要重新序列化一遍（数据架构 §0.3 的 F3 就是这个病）。
 * 封面这种"整屏铺一张"的图，缩到 1440 宽肉眼看不出差别，体积却小一个量级。
 */

/** 读文件（不缩放）—— 就是原来 me-sections 里那个 FileReader 写法 */
function readRaw(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

/** 用 canvas 缩到最长边 ≤ maxSide，导出 JPEG（失败就退回原图，绝不丢用户的图） */
async function readScaled(file: File, maxSide: number): Promise<string> {
  const raw = await readRaw(file);
  if (!raw) return "";
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = raw;
    });
    if (!img) return raw;
    const { width, height } = img;
    const longest = Math.max(width, height);
    if (!longest || longest <= maxSide) return raw;
    const scale = maxSide / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", 0.85);
    return out.length > 0 && out.length < raw.length ? out : raw;
  } catch {
    return raw;
  }
}

/**
 * 读一张图。
 *
 * @param maxSide 传了就把最长边缩到这个值以内（cover 这类大图用；头像/背景照旧不传）
 * @param done    读到之后回调（读失败时**不回调** —— 调用方不必自己判空）
 */
export function readImageFile(file: File, done: (url: string) => void, maxSide?: number): void {
  void (async () => {
    const url = maxSide ? await readScaled(file, maxSide) : await readRaw(file);
    if (url) done(url);
  })();
}
