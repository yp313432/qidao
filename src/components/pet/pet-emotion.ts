/** Body gestures augment the shared emotion lexicon; labels and groups live there. */
export type EmotionPose = { x: number; y: number; angle: number; lx: number; ly: number; la: number; rx: number; ry: number; ra: number; step: number };
export const GESTURE_HINTS: Record<string, string> = {
  bright: '挺起身体、连蹦两下，双钳举高挥动。', calm: '慢慢舒展钳子，坐着轻轻晃腿。',
  low: '身体垂低、钳子放下，低头坐一会儿。', angry: '绷紧身体、跺两下脚，抱钳转头再看回来。',
  uneasy: '左右张望，小步挪动，搓搓钳子再停住。', close: '向前探身、伸出钳子，靠近一点再坐稳。',
  flutter: '轻轻一跳、用钳子遮脸，又偷偷探头。', jealous: '转开一点、偏头偷看，轻敲脚再转回来。',
  restrained: '向前探一步，伸钳又收回，退一点等着。', curious: '歪身探头、举钳提问，左右仔细看看。',
};
export function emotionPose(group: string | undefined, age: number, intensity = 60): EmotionPose {
  const p: EmotionPose = { x: 0, y: 0, angle: 0, lx: 0, ly: 0, la: 0, rx: 0, ry: 0, ra: 0, step: 0 };
  const t = Math.max(0, Math.min(1, age / 3800));
  const envelope = Math.sin(Math.PI * t); // starts and finishes at rest
  const amp = (.45 + Math.max(0, Math.min(100, Number.isFinite(intensity) ? intensity : 60)) / 100) * envelope;
  const wave = Math.sin(t * Math.PI * 4), tap = Math.sin(t * Math.PI * 12);
  switch (group) {
    case 'bright': p.y = -Math.abs(wave) * 4; p.ly = p.ry = -4; p.la = -25 * wave; p.ra = 25 * wave; break;
    case 'calm': p.angle = wave * 2; p.ly = -1; p.ry = -1; p.la = -15; p.ra = 15; p.step = Math.sin(t * Math.PI * 2); break;
    case 'low': p.y = 3; p.angle = -7; p.ly = p.ry = 2; p.step = -.6; break;
    case 'angry': p.x = t < .5 ? tap : 0; p.angle = t < .6 ? wave * 6 : -9; p.ly = p.ry = -2; p.la = 35; p.ra = -35; p.step = t < .5 ? tap * 2 : 0; break;
    case 'uneasy': p.x = wave * 2; p.angle = wave * 6; p.lx = 1; p.rx = -1; p.ly = p.ry = -1 + tap * .6; p.step = wave; break;
    case 'close': p.x = 3; p.angle = 7; p.ry = -3; p.ra = -25; p.ly = -1; break;
    case 'flutter': p.y = -Math.abs(Math.sin(t * Math.PI * 2)) * 2; p.angle = wave * 4; p.lx = 4; p.rx = -4; p.ly = p.ry = -4; p.la = 20; p.ra = -20; break;
    case 'jealous': p.angle = t < .55 ? -12 : 7; p.x = -1; p.ly = 1; p.ry = -1; p.ra = -25; p.step = t > .55 ? tap : 0; break;
    case 'restrained': p.x = Math.sin(t * Math.PI * 2) * 3; p.angle = wave * 3; p.ry = t < .5 ? -3 : 0; p.rx = t < .5 ? -1 : 0; p.ra = t < .5 ? -20 : 0; break;
    case 'curious': p.x = wave * 2; p.angle = wave * 11; p.ry = -4; p.ra = -30; p.ly = -1; break;
  }
  for (const key of Object.keys(p) as (keyof EmotionPose)[]) p[key] *= amp;
  return p;
}
