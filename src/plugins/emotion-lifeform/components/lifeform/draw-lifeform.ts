import type { VisualParams } from "@/plugins/emotion-lifeform/lib/emotion/types";

const BG = "#09070e";

export type Dust = {
  angle: number;
  dist: number;
  size: number;
  speed: number;
  alpha: number;
  phase: number;
  front: boolean;
  drift: number;
};

export type MemoryNode = { id: string; title: string };

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(n: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, n));
}

function smooth(t: number) {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
}

function hsla(h: number, s: number, l: number, a: number) {
  return `hsla(${((h % 360) + 360) % 360} ${s}% ${l}% / ${a})`;
}

export function createDust(count = 72): Dust[] {
  return Array.from({ length: count }, (_, i) => ({
    angle: hash(i + 1) * Math.PI * 2,
    dist: 0.35 + hash(i + 2) * 1.15,
    size: hash(i + 3) > 0.86 ? 2.4 : 0.7 + hash(i + 4) * 1.15,
    speed: 0.35 + hash(i + 5) * 0.9,
    alpha: 0.2 + hash(i + 6) * 0.55,
    phase: hash(i + 7) * Math.PI * 2,
    front: hash(i + 8) > 0.5,
    drift: (hash(i + 9) - 0.5) * 0.4,
  }));
}

export function stepDust(dust: Dust[], params: VisualParams, dt: number) {
  for (const mote of dust) {
    mote.angle += dt * mote.speed * (0.15 + params.ribbonSpeed * 0.35) * (mote.front ? 1 : -0.6);
    mote.drift += dt * params.particleLift * mote.speed * 0.18;
    if (mote.drift > 0.85) mote.drift = -0.85;
    if (mote.drift < -0.85) mote.drift = 0.85;
  }
}

function envelope(time: number, retreat: number, approach: number) {
  const u = ((time % 1) + 1) % 1;
  let close = 0;
  if (u < 0.38) close = smooth(u / 0.38);
  else if (u < 0.56) close = 1;
  else close = 1 - smooth((u - 0.56) / 0.44) * (0.25 + retreat * 0.75);
  close *= 0.3 + approach * 0.7;
  return 1.14 - close * 0.5;
}

function traceSeed(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.45);
  ctx.bezierCurveTo(r * 0.78, -r * 0.78, r * 0.86, r * 0.08, r * 0.1, r * 0.95);
  ctx.quadraticCurveTo(0, r * 1.28, -r * 0.1, r * 0.95);
  ctx.bezierCurveTo(-r * 0.86, r * 0.08, -r * 0.78, -r * 0.78, 0, -r * 1.45);
  ctx.closePath();
}

function tracePetal(ctx: CanvasRenderingContext2D, r: number, open: number) {
  const reach = r * (0.28 + open * 0.92);
  ctx.beginPath();
  ctx.moveTo(0, r * 0.2);
  ctx.bezierCurveTo(reach * 0.18, -r * 0.05, reach * 0.95, -r * 0.72, reach * 0.05, -r * (1.2 + open * 0.18));
  ctx.bezierCurveTo(reach * 0.02, -r * 0.4, -reach * 0.28, -r * 0.15, 0, r * 0.28);
  ctx.closePath();
}

function strokeLoop(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  ctx.closePath();
}

/* ═══════════════════════════════════════════════════════════════════════
   花形开关（2026-10，用户要在手机上试的那次改动）
   ═══════════════════════════════════════════════════════════════════════
   用户原话："你保留一份原来的叶子那个，先改，完了手机上效果不好，
             我就还是用原来那个咋样"

   · true  = 花心用「层层莲花」：五排花瓣、每片往后面的花瓣上投影（遮挡感），
             开合由情绪驱动（`membraneOpen` 为主）
   · false = **回到最早那个竖叶子** —— 下面 `traceSeed` 那条路一个字都没删，
             只把这一行翻成 false 就完全恢复（也留了 .orig / .backup-叶子版 两份备份）

   ⚠️ 为什么"开合"用 membraneOpen：它本来就是"膜张开的程度"，
     正好等于"花开了多少"，不用新造一个参数。
   ═══════════════════════════════════════════════════════════════════════ */
const USE_LOTUS = true;

/** 一片花瓣的轮廓（基部在 (0,0)、尖端在 (0,-len)）
    顶端刻意收成**圆弧**而不是尖角：宽度按 sin(π·t^0.55)^0.8 收，
    t→1 时还留着约 1/3 的宽度 —— 这是"花瓣顶端圆润"的那一下。 */
function lotusPetalPoints(len: number, halfW: number) {
  const N = 30;
  const pts: { x: number; y: number }[] = [];
  const w = (t: number) => halfW * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 0.8);
  for (let i = 0; i <= N; i++) pts.push({ x: w(i / N), y: -len * (i / N) });
  for (let i = N - 1; i >= 1; i--) pts.push({ x: -w(i / N), y: -len * (i / N) });
  return pts;
}

/** 五排花瓣：由后到前。dh = 相对基准色的色相偏移，light = 亮度权重 */
const LOTUS_ROWS = [
  /* 最后排（正视图里在最上面）：按透视**片数少、更小、更淡** —— 之前 3 片挤在一起，很局促 */
  { n: 2, spread: 30, len: 0.54, wid: 0.23, y: -0.38, dh: -22, light: 0.38, alpha: 0.4 },
  { n: 3, spread: 52, len: 0.72, wid: 0.24, y: -0.21, dh: -14, light: 0.52, alpha: 0.54 },
  { n: 5, spread: 74, len: 0.94, wid: 0.255, y: 0.03, dh: -6, light: 0.68, alpha: 0.74 },
  /* 侧排：往外摊开（参考图左右那两片横向伸出去的） */
  { n: 4, spread: 108, len: 1.02, wid: 0.245, y: 0.34, dh: 4, light: 0.78, alpha: 0.84 },
  /* 前下垂排 */
  { n: 3, spread: 152, len: 0.86, wid: 0.235, y: 0.47, dh: 12, light: 0.7, alpha: 0.78 },
  /* 前排：立着、最亮、压在花心前面 */
  { n: 3, spread: 26, len: 0.62, wid: 0.255, y: 0.22, dh: 20, light: 1.0, alpha: 1.0 },
];

/**
 * 层层莲花。全程画布 2D，坐标以花心为原点。
 *
 * ⚠️ 性能：**没用 `shadowBlur`**（那个每片花瓣每帧都很贵，手机上会掉帧）。
 * 影子的做法是"同一片花瓣的暗色副本，往右下偏一点、放大一点"——
 * 因为花瓣是**由后往前**画的，这个暗副本正好压在前面已经画好的花瓣上，
 * 效果就是"后面那层被挡住了、发暗"。24 片花瓣 = 24 次额外填充，很便宜。
 */
function drawLotus(
  ctx: CanvasRenderingContext2D,
  r: number,
  hue: number,
  warm: number,
  bloom: number,
  bright: number,
) {
  const b = Math.max(0, Math.min(1, bloom));
  const grow = 0.48 + b * 0.52; // 开合 → 花瓣长度
  const fan = 0.26 + b * 0.74; // 开合 → 张开角度
  const baseLen = r * 1.9 * grow;

  for (const row of LOTUS_ROWS) {
    for (let k = 0; k < row.n; k++) {
      const u = row.n === 1 ? 0 : (k / (row.n - 1)) * 2 - 1;
      const ang = ((row.spread * fan * u) * Math.PI) / 180;
      const len = baseLen * row.len * (1 - Math.abs(u) * 0.14);
      const wid = baseLen * row.wid * (1 + Math.abs(u) * 0.08);
      const pts = lotusPetalPoints(len, wid);

      ctx.save();
      ctx.translate(0, row.y * r * (1 - b * 0.35));
      ctx.rotate(ang);

      /* ① 影子：暗色副本往右下偏一点 → 投在后面那层花瓣上 */
      ctx.save();
      ctx.translate(len * 0.03, len * 0.05);
      ctx.scale(1.03, 1.03);
      strokeLoop(ctx, pts);
      ctx.fillStyle = hsla(hue + row.dh - 12, 56, 6, 0.3 * (0.55 + b * 0.5));
      ctx.fill();
      ctx.restore();

      /* ② 花瓣本体：基部暗 → 尖端亮的渐变（体积感） */
      const g = ctx.createLinearGradient(0, 0, wid * 0.5, -len);
      g.addColorStop(0, hsla(hue + row.dh - 6, 60, 14 + row.light * 8, row.alpha));
      g.addColorStop(0.45, hsla(hue + row.dh, 54, 32 + row.light * 12, row.alpha * 0.97));
      g.addColorStop(0.8, hsla(hue + row.dh + 4, 46, 54 + row.light * 14, row.alpha * 0.92));
      g.addColorStop(1, hsla(hue + row.dh + 8, 38, 70 + row.light * 16, row.alpha * 0.86));
      strokeLoop(ctx, pts);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = hsla(hue + row.dh, 46, 90, 0.16 + row.light * 0.26);
      ctx.lineWidth = 0.9;
      ctx.stroke();

      /* ③ 一道竖向高光（往玻璃感靠一点） */
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const hg = ctx.createLinearGradient(0, 0, 0, -len);
      hg.addColorStop(0.4, hsla(warm, 40, 96, 0));
      hg.addColorStop(0.76, hsla(warm, 44, 96, (0.1 + row.light * 0.16) * (0.5 + bright * 0.5)));
      hg.addColorStop(1, hsla(warm, 40, 98, 0));
      strokeLoop(ctx, pts);
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.restore();

      ctx.restore();
    }
  }
}

function ribbonPoints(time: number, params: VisualParams, index: number, radius: number) {
  const count = 64;
  const spin = time * params.ribbonSpeed * [0.28, -0.2, 0.14][index];
  const env = envelope(time * (0.11 + params.approach * 0.07) + index * 0.27, params.retreat, params.approach);
  const rad = radius * (1.05 + params.ribbonRadius * 0.7) * env;
  const tilt = [0.38, 0.7, 0.5][index];
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + spin;
    const curl = Math.sin(a * 2 + time * 0.8 + index) * params.ribbonCurl * radius * 0.16;
    const jitter = (1 - params.stability) * Math.sin(time * 1.6 + i * 0.4) * radius * 0.035;
    pts.push({
      x: Math.cos(a) * rad + curl,
      y: Math.sin(a) * rad * tilt + jitter,
    });
  }
  return pts;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

const STARFIELD = Array.from({ length: 42 }, (_, i) => ({
  x: hash(i + 20),
  y: hash(i + 60),
  s: hash(i + 90) > 0.92 ? 1.7 : 0.55,
  a: 0.12 + hash(i + 30) * 0.4,
  phase: hash(i + 40) * Math.PI * 2,
}));

export function drawLifeform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  params: VisualParams,
  dust: Dust[],
  nodes: MemoryNode[],
  pointer: { x: number; y: number },
) {
  const hue = params.hue;
  const warm = params.hue2;
  const r = Math.min(width, height) * 0.2;
  const cx = width * 0.5 + pointer.x * r * 0.08;
  const cy = height * 0.5 + pointer.y * r * 0.06;
  const breath = 1 + Math.sin((time * Math.PI * 2) / params.rhythmPeriod) * 0.03 * params.amplitude;
  const droop = params.particleLift < 0 ? -params.particleLift * r * 0.08 : 0;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  for (const star of STARFIELD) {
    const tw = 0.65 + 0.35 * Math.sin(time * 0.5 + star.phase);
    ctx.fillStyle = hsla(hue, 20, 86, star.a * tw);
    ctx.beginPath();
    ctx.arc(star.x * width, star.y * height, star.s, 0, Math.PI * 2);
    ctx.fill();
  }

  const bloom = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r * 3.1);
  bloom.addColorStop(0, hsla(hue, 55, 62, 0.28 * params.coreBrightness));
  bloom.addColorStop(0.45, hsla(hue, 45, 40, 0.08));
  bloom.addColorStop(1, hsla(hue, 40, 20, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(cx, cy + droop);
  ctx.scale(breath, breath);

  ctx.globalCompositeOperation = "lighter";
  const petalAngles = [-0.85, -0.32, 0.22, 0.78, 2.55, -2.35];
  petalAngles.forEach((angle, index) => {
    const flutter = Math.sin(time * (1.1 + params.membraneFlutter * 2.4) + index) * params.membraneFlutter * 0.1;
    const open = params.membraneOpen * (index > 3 ? 0.72 : 1);
    ctx.save();
    ctx.rotate(angle + flutter + droop / r * 0.15);
    tracePetal(ctx, r, open);
    const g = ctx.createLinearGradient(0, -r * 1.3, 0, r * 0.4);
    g.addColorStop(0, hsla(hue, 48, 78, 0.02));
    g.addColorStop(0.45, hsla(hue, 52, 70, 0.16 * open));
    g.addColorStop(1, hsla(warm, 45, 72, 0.05));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  });

  const showDust = Math.round(dust.length * params.particleDensity);
  const drawMotes = (front: boolean) => {
    for (let i = 0; i < showDust; i++) {
      const mote = dust[i];
      if (mote.front !== front) continue;
      const dist = r * (0.45 + mote.dist * (0.55 + params.ribbonRadius * 0.5));
      const x = Math.cos(mote.angle) * dist;
      const y = Math.sin(mote.angle) * dist * 0.62 + mote.drift * r + params.particleLift * r * 0.7;
      const alpha = mote.alpha * (0.45 + params.coreBrightness * 0.55);
      ctx.fillStyle = hsla(i % 3 === 0 ? warm : hue, 40, 82, alpha);
      ctx.beginPath();
      ctx.arc(x, y, mote.size * (mote.size > 2 ? 1.15 : 1), 0, Math.PI * 2);
      ctx.fill();
    }
  };
  drawMotes(false);

  [0].forEach((index) => {
    const pts = ribbonPoints(time, params, index, r);
    strokeLoop(ctx, pts);
    ctx.strokeStyle = hsla(hue, 45, 74, 0.08);
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.strokeStyle = hsla(hue, 55, 84, 0.45);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  });

  ctx.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.rotate(Math.sin(time * 0.35) * 0.06 * (1.15 - params.stability));
  if (USE_LOTUS) {
    /* 花心那一圈：原来拿叶子的轮廓当剪裁（里面的扰动线/卷须都裁在它里面），
       换成莲花之后剪裁范围改成"花心"本身 */
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.46, r * 0.42, 0, 0, Math.PI * 2);
  } else {
    traceSeed(ctx, r);
  }
  const glass = ctx.createLinearGradient(-r * 0.2, -r, r * 0.3, r);
  glass.addColorStop(0, hsla(hue, 35, 88, 0.22));
  glass.addColorStop(0.45, hsla(hue, 40, 48, 0.18));
  glass.addColorStop(1, hsla(260, 30, 20, 0.28));
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.clip();

  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i++) {
    const ang = time * (0.15 + params.innerTurbulence * 0.35) + i * 1.25;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * r * 0.08, Math.sin(ang) * r * 0.08 + r * 0.06);
    ctx.lineTo(Math.cos(ang) * r * (0.28 + params.innerTurbulence * 0.22), Math.sin(ang) * r * (0.34 + params.innerTurbulence * 0.2) + r * 0.04);
    ctx.strokeStyle = hsla(i % 2 ? warm : hue, 45, 82, 0.12 + params.innerTurbulence * 0.28);
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }

  const curlPts: { x: number; y: number }[] = [];
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const env = envelope(time * 0.17, params.retreat, params.approach);
    const a = time * 0.4 * (0.45 + params.ribbonSpeed) + t * Math.PI * 1.55;
    const wobble = Math.sin(time * 1.3 + t * Math.PI * 2) * params.innerTurbulence * r * 0.07;
    const rad = r * (0.1 + t * 0.42 * env) + wobble;
    curlPts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.7 });
  }
  ctx.beginPath();
  ctx.moveTo(curlPts[0].x, curlPts[0].y);
  for (let i = 1; i < curlPts.length - 1; i++) {
    const mx = (curlPts[i].x + curlPts[i + 1].x) / 2;
    const my = (curlPts[i].y + curlPts[i + 1].y) / 2;
    ctx.quadraticCurveTo(curlPts[i].x, curlPts[i].y, mx, my);
  }
  ctx.strokeStyle = hsla(warm, 55, 80, 0.22 + params.coreBrightness * 0.35);
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  ctx.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.rotate(Math.sin(time * 0.35) * 0.06 * (1.15 - params.stability));
  if (USE_LOTUS) {
    /**
     * 开合度：`membraneOpen` 为主（它本来就是"膜张开的程度"），
     * 再让「靠近」把它推大一点、「退开」把它收一点、核心亮时略开 ——
     * 于是情绪一变动，花就自己开或者合。
     */
    const bloom =
      params.membraneOpen * 0.72 +
      params.approach * 0.34 -
      params.retreat * 0.22 +
      params.coreBrightness * 0.1;
    drawLotus(ctx, r, hue, warm, bloom, params.coreBrightness);
  } else {
    traceSeed(ctx, r);
    ctx.strokeStyle = hsla(hue, 40, 88, 0.55);
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
  ctx.restore();

  const pulse = 1 + Math.sin(time * params.pulseHz * Math.PI * 2) * 0.06 * params.amplitude * params.coreBrightness;
  const coreR = r * 0.28 * pulse;
  ctx.globalCompositeOperation = "lighter";
  const core = ctx.createRadialGradient(-coreR * 0.3, -coreR * 0.35, coreR * 0.1, 0, 0, coreR * 1.8);
  core.addColorStop(0, hsla(36, 55, 96, 0.95));
  core.addColorStop(0.35, hsla(warm, 60, 74, 0.85 * params.coreBrightness));
  core.addColorStop(0.7, hsla(hue, 50, 62, 0.28));
  core.addColorStop(1, hsla(hue, 40, 50, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, r * 0.08, coreR * 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = "source-over";
  const pearl = ctx.createRadialGradient(-coreR * 0.35, -coreR * 0.4, coreR * 0.05, 0, r * 0.08, coreR);
  pearl.addColorStop(0, "hsla(30 40% 97% / 0.95)");
  pearl.addColorStop(0.55, hsla(warm, 45, 78, 0.9));
  pearl.addColorStop(1, hsla(hue, 35, 58, 0.65));
  ctx.fillStyle = pearl;
  ctx.beginPath();
  ctx.arc(0, r * 0.08, coreR, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = "lighter";
  [1, 2].forEach((index) => {
    const pts = ribbonPoints(time + 0.4, params, index, r);
    strokeLoop(ctx, pts);
    ctx.strokeStyle = hsla(index === 1 ? warm : hue, 50, 80, 0.1);
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = hsla(index === 1 ? warm : hue, 60, 88, 0.55);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  const reach = r * (0.3 + params.filamentReach * 1.45);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.28 + Math.sin(time * 0.4 + i) * 0.06;
    const tip = reach * (params.gather > 0.7 ? 0.62 + 0.2 * Math.sin(time + i) : 1);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.2);
    ctx.quadraticCurveTo(Math.cos(a + 0.35) * tip * 0.7, -r * 0.2 - tip * 0.15, Math.cos(a) * tip * (1 - params.gather * 0.25), -r * 0.15 - tip * 0.45);
    ctx.strokeStyle = hsla(hue, 35, 84, 0.28 * params.filamentReach);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawMotes(true);
  ctx.restore();

  const vig = ctx.createRadialGradient(cx, cy, r * 1.2, cx, cy, Math.max(width, height) * 0.72);
  vig.addColorStop(0, "hsla(260 30% 6% / 0)");
  vig.addColorStop(1, "hsla(260 30% 4% / 0.45)");
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, width, height);

  if (!nodes.length) return;
  const nodeOrbit = Math.min(r * 2.15, width * 0.34, height * 0.34);
  ctx.font = "12px 'Noto Sans SC', 'WenQuanYi Zen Hei', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  nodes.forEach((node, index) => {
    const side = nodes.length === 1 ? 0.2 : index % 2 === 0 ? 1 : -1;
    const band = Math.floor(index / 2);
    const angle = side * (0.42 + band * 0.38);
    const nx = cx + Math.cos(angle) * nodeOrbit;
    const ny = cy + Math.sin(angle) * nodeOrbit * 0.72;
    ctx.save();
    ctx.strokeStyle = hsla(hue, 40, 78, 0.45);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.lineDashOffset = -time * 14;
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.quadraticCurveTo((nx + cx) / 2, (ny + cy) / 2 - r * 0.2, cx, cy + r * 0.1);
    ctx.stroke();
    ctx.setLineDash([]);
    const glow = ctx.createRadialGradient(nx, ny, 1, nx, ny, 16);
    glow.addColorStop(0, hsla(warm, 50, 80, 0.9));
    glow.addColorStop(1, hsla(hue, 40, 60, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(nx, ny, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hsla(36, 40, 96, 0.95);
    ctx.beginPath();
    ctx.arc(nx, ny, 2.4, 0, Math.PI * 2);
    ctx.fill();
    const label = node.title;
    const textW = ctx.measureText(label).width;
    const padX = 8;
    const boxW = textW + padX * 2;
    const boxH = 22;
    const boxX = nx - boxW / 2;
    const boxY = ny + 14;
    roundRect(ctx, boxX, boxY, boxW, boxH, 11);
    ctx.fillStyle = "hsla(260 30% 7% / 0.78)";
    ctx.fill();
    ctx.strokeStyle = hsla(hue, 30, 70, 0.35);
    ctx.stroke();
    ctx.fillStyle = "#f6f1f8";
    ctx.fillText(label, nx, boxY + boxH / 2);
    ctx.restore();
  });
}
