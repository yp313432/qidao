export type ReasoningEffort = "low" | "medium" | "high";

export type ModelId = "haiku" | "sonnet" | "opus";

export type ModelOption = {
  id: ModelId;
  label: string;
  subtitle: string;
  effort: ReasoningEffort;
  maxTokens: number;
  mapping: string;
};

export const MODELS: ModelOption[] = [
  {
    id: "haiku",
    label: "Haiku 4.5 Fast",
    subtitle: "更快，适合日常问答",
    effort: "low",
    maxTokens: 1024,
    mapping: "grok-4.5 · low",
  },
  {
    id: "sonnet",
    label: "Sonnet 5.5 Medium",
    subtitle: "均衡的思考与表达",
    effort: "medium",
    maxTokens: 2048,
    mapping: "grok-4.5 · medium",
  },
  {
    id: "opus",
    label: "Opus 4.5 High",
    subtitle: "更深的推理链",
    effort: "high",
    maxTokens: 3072,
    mapping: "grok-4.5 · high",
  },
];

export function getModel(id: ModelId): ModelOption {
  return MODELS.find((m) => m.id === id) ?? MODELS[1]!;
}

export const QUOTA_LIMIT = 40;
export const QUOTA_WINDOW_MS = 5 * 60 * 60 * 1000;
