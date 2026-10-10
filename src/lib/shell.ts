/**
 * **系统栏那一层（网页侧）** —— 跟原生 `ShellBridgePlugin` 配对。
 *
 * 用户原话（2026-11）：
 *   "我想铺背景图的话，它能自然地延伸到导航栏和上面电量时间那块 —— 能不能把它铺满，
 *    而不是说想上花纹。"（**任何**背景图都要铺上去，浅色深色都得好看）
 *
 * ── 三件事，各管一段 ────────────────────────────────────────
 *   ① 原生已经把系统栏设成透明了（背景自然透上来）
 *   ② 安全区高度由原生推成 CSS 变量：`--q-inset-top` / `--q-inset-bottom`
 *      —— 安卓 WebView 里 `env(safe-area-inset-*)` 是 0，所以**不能只靠 env()**
 *   ③ **图标颜色跟着背景明暗走**：浅色背景 → 深色图标，否则状态栏那排字看不见
 *
 * ⚠️ 踩过的坑（第一次只做了 ①）：
 *   内容被顶进状态栏下面、顶栏被压住、界面看着"短了一截"。
 *   所以 `initShell()` 必须在 App 外壳挂载时就跑，而且 CSS 那边要真的用上那两个变量。
 */
import { registerPlugin } from "@capacitor/core";

type ShellApi = {
  getInsets: () => Promise<{ top?: number; bottom?: number }>;
  setBarIcons: (o: { light: boolean }) => Promise<void>;
};

const ShellBridge = registerPlugin<ShellApi>("ShellBridge");

/** 网页版没有这个插件 —— 别报错，静默跳过（对齐别的插件的做法） */
function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * 这颜色亮不亮（0..1）。
 * 用 sRGB 的相对亮度（人眼对绿最敏感，蓝最不敏感）—— 别用 (r+g+b)/3，
 * 那样深蓝会被判成"暗"、亮黄反而被判成"中"，图标就选错了。
 */
export function luminance(r: number, g: number, b: number): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** 解析 `rgb(a)` / `#rrggbb` */
export function parseColor(input: string): { r: number; g: number; b: number; a: number } | null {
  const s = (input ?? "").trim();
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/i.exec(s);
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  return null;
}

/**
 * 背景**最终看上去**是什么颜色（要算上背景图的模糊/暗化/不透明度 + 底下的画布色）。
 * 只在"系统栏那一条"上取样 —— 用户的背景图上下可能不一样亮。
 */
async function topBandColor(): Promise<{ r: number; g: number; b: number }> {
  const cs = getComputedStyle(document.documentElement);
  const canvas = parseColor(cs.getPropertyValue("--aster-canvas")) ?? { r: 14, g: 15, b: 18, a: 1 };
  const raw = (window as unknown as { __qidaoBg?: string }).__qidaoBg;
  if (!raw) return { r: canvas.r, g: canvas.g, b: canvas.b };

  const state = (window as unknown as { __qidaoBgState?: { dim?: number; opacity?: number } })
    .__qidaoBgState;
  const dim = state?.dim ?? 0;
  const opacity = state?.opacity ?? 1;

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("背景图解不开"));
      i.src = raw;
    });
    const w = 24;
    const h = Math.max(1, Math.round((img.height / Math.max(1, img.width)) * w));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { r: canvas.r, g: canvas.g, b: canvas.b };
    ctx.drawImage(img, 0, 0, w, h);
    /** 只取最上面那一条（状态栏那一条落在那里） */
    const band = Math.max(1, Math.round(h * 0.12));
    const data = ctx.getImageData(0, 0, w, band).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }
    r /= n;
    g /= n;
    b /= n;
    /** 暗化 = brightness(1 - dim)，不透明度 = 跟画布色混合 */
    const k = 1 - dim;
    const mix = (img1: number, base: number) => img1 * k * opacity + base * (1 - opacity);
    return { r: mix(r, canvas.r), g: mix(g, canvas.g), b: mix(b, canvas.b) };
  } catch {
    return { r: canvas.r, g: canvas.g, b: canvas.b };
  }
}

/** 按当前背景决定状态栏/导航栏图标用浅色还是深色 */
export async function syncBarIcons(): Promise<void> {
  if (!isNative()) return;
  try {
    const { r, g, b } = await topBandColor();
    /** 阈值 0.5：亮背景 → 深色图标（light=false） */
    const light = luminance(r, g, b) < 0.5;
    await ShellBridge.setBarIcons({ light });
  } catch {
    /* 取不到就保持原样，别把界面搞坏 */
  }
}

/**
 * 在外壳挂载时调一次：
 *   ① 主动问一次安全区（万一原生推得太早、文档还没准备好）
 *   ② 同步图标颜色
 * 之后原生在系统栏高度变化时会自己再推一次。
 */
export async function initShell(): Promise<void> {
  if (!isNative()) return;
  try {
    const r = await ShellBridge.getInsets();
    const top = Math.max(0, Math.round(Number(r?.top ?? 0)));
    const bottom = Math.max(0, Math.round(Number(r?.bottom ?? 0)));
    if (top > 0) document.documentElement.style.setProperty("--q-inset-top", `${top}px`);
    if (bottom > 0) document.documentElement.style.setProperty("--q-inset-bottom", `${bottom}px`);
  } catch {
    /* 插件不在（老包/网页版）→ 退回 env()，CSS 那边已经写了兜底 */
  }
  await syncBarIcons();
}
