export type IntimacyMode = "daily" | "affectionate" | "flirtatious" | "intense";

export type SourceType =
  | "explicit_user"
  | "conversation_inference"
  | "memory_assisted"
  | "demo";

export type SceneCategory = "base" | "intimacy" | "tension" | "cognition" | "expression";

export type EvidenceRef = {
  id: string;
  quote: string;
  note: string;
};

export type EmotionDimensions = {
  attraction: number;
  longing: number;
  shyness: number;
  restraint: number;
  warmth: number;
  unease: number;
};

export type EmotionEvent = {
  eventId: string;
  timestamp: string;
  title: string;
  primaryEmotion: string;
  secondaryEmotions: string[];
  intensity: number;
  confidence: number;
  sourceType: SourceType;
  expressionTendencies: string[];
  suggestedMode: IntimacyMode;
  evidenceRefs: EvidenceRef[];
  memoryQuery: { emotion: string; topic?: string };
  summary: string;
  motion: string;
  category: SceneCategory;
  dimensions: EmotionDimensions;
  coach: string;
  /**
   * 这条是**插件自带的模拟场景**（true）还是**栖岛真上报的情绪事件**（false）。
   *
   * 原来写死成字面量 `true` —— 真数据一接进来就没法表达"这是真的"了
   * （类型上过不去）。所以放宽成 boolean：界面靠它决定标不标"模拟"。
   * 美术 / 动画 / 配色一个字节都没动。
   */
  isDemoData: boolean;
};

export type VisualParams = {
  hue: number;
  hue2: number;
  coreBrightness: number;
  pulseHz: number;
  stability: number;
  ribbonSpeed: number;
  ribbonRadius: number;
  ribbonCurl: number;
  approach: number;
  retreat: number;
  membraneOpen: number;
  membraneFlutter: number;
  particleDensity: number;
  particleSpeed: number;
  particleLift: number;
  rhythmPeriod: number;
  amplitude: number;
  innerTurbulence: number;
  filamentReach: number;
  gather: number;
};

export type UserCorrection = {
  eventId: string;
  primaryEmotion?: string;
  hiddenPrimary?: boolean;
  note: string;
};

export type Settings = {
  intimacyMode: IntimacyMode;
  showLifeform: boolean;
  intimacyEnabled: boolean;
  showCopy: boolean;
  showConfidence: boolean;
  reducedMotion: boolean;
  hiddenLabels: string[];
};

export const MODE_LABEL: Record<IntimacyMode, string> = {
  daily: "日常",
  affectionate: "亲昵",
  flirtatious: "暧昧",
  intense: "浓烈",
};

export const SOURCE_LABEL: Record<SourceType, string> = {
  explicit_user: "用户明确表达",
  conversation_inference: "当前文本推断",
  memory_assisted: "历史记忆辅助",
  demo: "演示标注",
};

export const CATEGORY_LABEL: Record<SceneCategory, string> = {
  base: "基础情绪",
  intimacy: "亲密",
  tension: "关系张力",
  cognition: "认知",
  expression: "表达倾向",
};

export const DIMENSIONS = [
  ["attraction", "吸引感"],
  ["longing", "亲密渴望"],
  ["shyness", "羞涩"],
  ["restraint", "克制"],
  ["warmth", "温度"],
  ["unease", "不安"],
] as const;

export const MODES: IntimacyMode[] = ["daily", "affectionate", "flirtatious", "intense"];
