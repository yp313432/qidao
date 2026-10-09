import type { EmotionEvent, IntimacyMode, Settings, VisualParams } from "./types";

const base = (patch: Partial<VisualParams>): VisualParams => ({
  hue: 274,
  hue2: 330,
  coreBrightness: 0.62,
  pulseHz: 0.42,
  stability: 0.8,
  ribbonSpeed: 0.35,
  ribbonRadius: 0.62,
  ribbonCurl: 0.35,
  approach: 0.35,
  retreat: 0.2,
  membraneOpen: 0.48,
  membraneFlutter: 0.12,
  particleDensity: 0.45,
  particleSpeed: 0.4,
  particleLift: 0.05,
  rhythmPeriod: 6.4,
  amplitude: 0.55,
  innerTurbulence: 0.12,
  filamentReach: 0.28,
  gather: 0.55,
  ...patch,
});

export const FAMILIES: Record<string, VisualParams> = {
  平静: base({
    hue: 268,
    hue2: 250,
    coreBrightness: 0.52,
    pulseHz: 0.32,
    stability: 0.94,
    ribbonSpeed: 0.22,
    ribbonRadius: 0.74,
    ribbonCurl: 0.18,
    approach: 0.18,
    retreat: 0.12,
    membraneOpen: 0.4,
    membraneFlutter: 0.06,
    particleDensity: 0.32,
    particleLift: 0.02,
    rhythmPeriod: 8,
    amplitude: 0.4,
    innerTurbulence: 0.05,
    filamentReach: 0.18,
    gather: 0.8,
  }),
  喜悦: base({
    hue: 36,
    hue2: 330,
    coreBrightness: 0.84,
    pulseHz: 0.55,
    stability: 0.72,
    ribbonSpeed: 0.48,
    ribbonRadius: 0.7,
    ribbonCurl: 0.42,
    approach: 0.3,
    membraneOpen: 0.78,
    membraneFlutter: 0.16,
    particleDensity: 0.72,
    particleSpeed: 0.7,
    particleLift: 0.55,
    amplitude: 0.72,
    filamentReach: 0.4,
  }),
  心动: base({
    hue: 332,
    hue2: 18,
    coreBrightness: 0.8,
    pulseHz: 0.78,
    stability: 0.7,
    ribbonSpeed: 0.4,
    ribbonRadius: 0.56,
    ribbonCurl: 0.48,
    approach: 0.74,
    retreat: 0.22,
    membraneOpen: 0.64,
    membraneFlutter: 0.2,
    particleDensity: 0.58,
    particleLift: 0.32,
    rhythmPeriod: 5.2,
    amplitude: 0.7,
    innerTurbulence: 0.22,
    filamentReach: 0.36,
  }),
  恼怒: base({
    hue: 12,
    hue2: 350,
    coreBrightness: 0.7,
    pulseHz: 0.95,
    stability: 0.48,
    ribbonSpeed: 0.72,
    ribbonRadius: 0.5,
    ribbonCurl: 0.62,
    approach: 0.42,
    retreat: 0.18,
    membraneOpen: 0.28,
    membraneFlutter: 0.1,
    particleDensity: 0.4,
    particleSpeed: 0.85,
    particleLift: -0.15,
    rhythmPeriod: 3.8,
    amplitude: 0.66,
    innerTurbulence: 0.55,
    filamentReach: 0.2,
    gather: 0.4,
  }),
  失落: base({
    hue: 226,
    hue2: 260,
    coreBrightness: 0.38,
    pulseHz: 0.28,
    stability: 0.84,
    ribbonSpeed: 0.16,
    ribbonRadius: 0.8,
    ribbonCurl: 0.16,
    approach: 0.2,
    retreat: 0.1,
    membraneOpen: 0.3,
    membraneFlutter: 0.05,
    particleDensity: 0.36,
    particleSpeed: 0.22,
    particleLift: -0.72,
    rhythmPeriod: 9,
    amplitude: 0.36,
    innerTurbulence: 0.08,
    filamentReach: 0.22,
    gather: 0.66,
  }),
  安心: base({
    hue: 168,
    hue2: 280,
    coreBrightness: 0.66,
    pulseHz: 0.3,
    stability: 0.96,
    ribbonSpeed: 0.2,
    ribbonRadius: 0.6,
    ribbonCurl: 0.14,
    approach: 0.4,
    retreat: 0.05,
    membraneOpen: 0.74,
    membraneFlutter: 0.05,
    particleDensity: 0.4,
    particleLift: 0.12,
    rhythmPeriod: 8.4,
    amplitude: 0.42,
    innerTurbulence: 0.04,
    filamentReach: 0.24,
    gather: 0.84,
  }),
  好奇: base({
    hue: 196,
    hue2: 270,
    coreBrightness: 0.7,
    pulseHz: 0.48,
    stability: 0.74,
    ribbonSpeed: 0.46,
    ribbonRadius: 0.78,
    ribbonCurl: 0.5,
    approach: 0.28,
    membraneOpen: 0.58,
    membraneFlutter: 0.14,
    particleDensity: 0.62,
    particleLift: 0.4,
    amplitude: 0.6,
    innerTurbulence: 0.18,
    filamentReach: 0.92,
    gather: 0.28,
  }),
  渴望: base({
    hue: 342,
    hue2: 24,
    coreBrightness: 0.86,
    pulseHz: 0.62,
    stability: 0.76,
    ribbonSpeed: 0.34,
    ribbonRadius: 0.46,
    ribbonCurl: 0.4,
    approach: 0.86,
    retreat: 0.12,
    membraneOpen: 0.8,
    membraneFlutter: 0.1,
    particleDensity: 0.66,
    particleLift: 0.18,
    rhythmPeriod: 6.8,
    amplitude: 0.64,
    innerTurbulence: 0.2,
    filamentReach: 0.3,
    gather: 0.72,
  }),
  暧昧: base({
    hue: 318,
    hue2: 28,
    coreBrightness: 0.76,
    pulseHz: 0.7,
    stability: 0.68,
    ribbonSpeed: 0.42,
    ribbonRadius: 0.58,
    ribbonCurl: 0.55,
    approach: 0.8,
    retreat: 0.48,
    membraneOpen: 0.56,
    membraneFlutter: 0.26,
    particleDensity: 0.6,
    particleLift: 0.22,
    rhythmPeriod: 5.6,
    amplitude: 0.68,
    innerTurbulence: 0.3,
    filamentReach: 0.42,
  }),
  介意: base({
    hue: 8,
    hue2: 286,
    coreBrightness: 0.64,
    pulseHz: 0.88,
    stability: 0.86,
    ribbonSpeed: 0.24,
    ribbonRadius: 0.66,
    ribbonCurl: 0.22,
    approach: 0.36,
    retreat: 0.2,
    membraneOpen: 0.34,
    membraneFlutter: 0.08,
    particleDensity: 0.38,
    particleLift: -0.05,
    amplitude: 0.5,
    innerTurbulence: 0.78,
    filamentReach: 0.16,
    gather: 0.74,
  }),
  克制: base({
    hue: 262,
    hue2: 340,
    coreBrightness: 0.6,
    pulseHz: 0.55,
    stability: 0.8,
    ribbonSpeed: 0.28,
    ribbonRadius: 0.6,
    ribbonCurl: 0.3,
    approach: 0.7,
    retreat: 0.86,
    membraneOpen: 0.42,
    membraneFlutter: 0.18,
    particleDensity: 0.4,
    particleLift: 0.05,
    rhythmPeriod: 6.2,
    amplitude: 0.52,
    innerTurbulence: 0.34,
    filamentReach: 0.26,
  }),
  不安: base({
    hue: 252,
    hue2: 210,
    coreBrightness: 0.58,
    pulseHz: 0.72,
    stability: 0.42,
    ribbonSpeed: 0.5,
    ribbonRadius: 0.64,
    ribbonCurl: 0.58,
    approach: 0.55,
    retreat: 0.62,
    membraneOpen: 0.36,
    membraneFlutter: 0.32,
    particleDensity: 0.48,
    particleLift: 0.08,
    rhythmPeriod: 4.4,
    amplitude: 0.58,
    innerTurbulence: 0.4,
    filamentReach: 0.34,
    gather: 0.35,
  }),
};

const TERM_FAMILY: Record<string, string> = {
  平静: "平静",
  宁静: "平静",
  放松: "平静",
  从容: "平静",
  喜悦: "喜悦",
  开心: "喜悦",
  愉快: "喜悦",
  兴奋: "喜悦",
  感动: "安心",
  感激: "喜悦",
  心动: "心动",
  怦然: "心动",
  吸引: "心动",
  羞涩: "心动",
  羞赧: "心动",
  恼怒: "恼怒",
  生气: "恼怒",
  委屈: "恼怒",
  失落: "失落",
  难过: "失落",
  悲伤: "失落",
  思念: "失落",
  安心: "安心",
  信任: "安心",
  好奇: "好奇",
  专注: "好奇",
  渴望: "渴望",
  亲密渴望: "渴望",
  依恋: "渴望",
  眷恋: "渴望",
  暧昧: "暧昧",
  试探: "暧昧",
  介意: "介意",
  吃醋: "介意",
  不甘: "介意",
  故作镇定: "介意",
  克制: "克制",
  犹豫: "不安",
  焦虑: "不安",
  忐忑: "不安",
};

export function familyOf(term: string, fallback = "平静"): string {
  if (TERM_FAMILY[term]) return TERM_FAMILY[term];
  if (FAMILIES[term]) return term;
  return fallback;
}

function clamp(n: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, n));
}

function mixHue(from: number, to: number, t: number) {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

function clone(params: VisualParams): VisualParams {
  return { ...params };
}

const MODS: Record<string, (params: VisualParams) => void> = {
  羞涩: (p) => {
    p.membraneFlutter += 0.26;
    p.membraneOpen -= 0.12;
    p.hue = mixHue(p.hue, 348, 0.25);
  },
  羞赧: (p) => MODS["羞涩"](p),
  克制: (p) => {
    p.retreat += 0.46;
    p.approach += 0.1;
    p.ribbonSpeed *= 0.84;
    p.membraneOpen -= 0.06;
  },
  委屈: (p) => {
    p.particleLift -= 0.45;
    p.coreBrightness -= 0.08;
  },
  依恋: (p) => {
    p.ribbonRadius -= 0.08;
    p.membraneOpen += 0.1;
    p.rhythmPeriod += 0.6;
  },
  眷恋: (p) => MODS["依恋"](p),
  故作镇定: (p) => {
    p.innerTurbulence += 0.42;
    p.stability = clamp(p.stability + 0.16);
    p.ribbonCurl = Math.max(0.05, p.ribbonCurl - 0.1);
  },
  不甘: (p) => {
    p.innerTurbulence += 0.2;
    p.ribbonCurl += 0.16;
  },
  思念: (p) => {
    p.particleLift -= 0.2;
    p.filamentReach += 0.08;
  },
  期待: (p) => {
    p.particleLift += 0.28;
    p.filamentReach += 0.16;
  },
  期待回应: (p) => {
    p.approach += 0.08;
    p.retreat += 0.12;
    p.filamentReach += 0.08;
  },
  信任: (p) => {
    p.stability = clamp(p.stability + 0.12);
    p.ribbonCurl = Math.max(0.05, p.ribbonCurl - 0.1);
    p.membraneOpen += 0.08;
  },
  专注: (p) => {
    p.gather = clamp(p.gather + 0.3);
    p.filamentReach += 0.12;
    p.stability = clamp(p.stability + 0.08);
  },
  想靠近: (p) => {
    p.approach += 0.12;
    p.ribbonRadius -= 0.06;
  },
  放松: (p) => {
    p.amplitude *= 0.85;
    p.membraneOpen += 0.06;
  },
  从容: (p) => {
    p.stability = clamp(p.stability + 0.08);
    p.ribbonSpeed *= 0.9;
  },
  吸引: (p) => {
    p.approach += 0.1;
    p.coreBrightness += 0.04;
  },
  试探: (p) => {
    p.retreat += 0.16;
    p.membraneFlutter += 0.08;
  },
  感动: (p) => {
    p.coreBrightness += 0.06;
    p.membraneOpen += 0.08;
  },
};

function applyMode(params: VisualParams, mode: IntimacyMode) {
  if (mode === "daily") {
    params.amplitude *= 0.78;
    params.approach *= 0.82;
    params.coreBrightness *= 0.9;
    params.particleDensity *= 0.88;
    params.membraneFlutter *= 0.85;
  } else if (mode === "affectionate") {
    params.membraneOpen += 0.08;
    params.ribbonRadius -= 0.05;
    params.ribbonSpeed *= 0.92;
    params.amplitude *= 0.92;
    params.hue = mixHue(params.hue, 336, 0.12);
  } else if (mode === "flirtatious") {
    params.approach += 0.12;
    params.retreat += 0.1;
    params.membraneFlutter += 0.1;
    params.pulseHz *= 1.06;
    params.ribbonCurl += 0.06;
  } else {
    params.coreBrightness += 0.1;
    params.amplitude *= 1.14;
    params.particleDensity += 0.12;
    params.ribbonSpeed *= 1.1;
    params.membraneOpen += 0.05;
    params.approach += 0.06;
  }
}

function finalize(params: VisualParams): VisualParams {
  params.coreBrightness = clamp(params.coreBrightness, 0.2, 1);
  params.pulseHz = clamp(params.pulseHz, 0.2, 1.05);
  params.stability = clamp(params.stability);
  params.ribbonSpeed = clamp(params.ribbonSpeed, 0.05, 1.3);
  params.ribbonRadius = clamp(params.ribbonRadius, 0.3, 1);
  params.ribbonCurl = clamp(params.ribbonCurl, 0, 1);
  params.approach = clamp(params.approach);
  params.retreat = clamp(params.retreat);
  params.membraneOpen = clamp(params.membraneOpen, 0.12, 1);
  params.membraneFlutter = clamp(params.membraneFlutter, 0, 0.8);
  params.particleDensity = clamp(params.particleDensity, 0.1, 1);
  params.particleSpeed = clamp(params.particleSpeed, 0.05, 1.2);
  params.particleLift = clamp(params.particleLift, -1, 1);
  params.rhythmPeriod = clamp(params.rhythmPeriod, 3.2, 11);
  params.amplitude = clamp(params.amplitude, 0.15, 1);
  params.innerTurbulence = clamp(params.innerTurbulence);
  params.filamentReach = clamp(params.filamentReach);
  params.gather = clamp(params.gather);
  return params;
}

export function resolveVisual(
  event: Pick<EmotionEvent, "primaryEmotion" | "secondaryEmotions" | "intensity">,
  settings: Pick<Settings, "intimacyMode" | "intimacyEnabled">,
  options?: { masked?: boolean },
): VisualParams {
  if (options?.masked) return finalize(clone(FAMILIES["平静"]));

  const family = FAMILIES[familyOf(event.primaryEmotion)] ?? FAMILIES["平静"];
  const params = clone(family);
  const k = event.intensity / 100;
  params.coreBrightness *= 0.72 + k * 0.45;
  params.amplitude *= 0.62 + k * 0.55;
  params.particleDensity *= 0.55 + k * 0.6;
  params.innerTurbulence *= 0.7 + k * 0.45;

  for (const tag of event.secondaryEmotions) {
    MODS[tag]?.(params);
  }
  applyMode(params, settings.intimacyMode);
  return finalize(params);
}
