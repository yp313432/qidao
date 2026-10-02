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

/**
 * 三档「推理力度」。
 *
 * 注意：这里的 id（haiku / sonnet / opus）只是**本地标识**，历史数据里存的就是它们，
 * 所以别改 id；改动只发生在 label / subtitle —— 那些是给人看的。
 *
 * 真正的模型名**不在这里**：走哪家由用户在「我的 → 自定义上游」里填
 * （或服务端用 QIDAO_UPSTREAM_MODEL 配）。这个文件不该出现任何厂商名。
 */
export const MODELS: ModelOption[] = [
  {
    id: "haiku",
    label: "快答",
    subtitle: "更快，适合日常问答",
    effort: "low",
    maxTokens: 1024,
    mapping: "轻",
  },
  {
    id: "sonnet",
    label: "均衡",
    subtitle: "均衡的思考与表达",
    effort: "medium",
    maxTokens: 2048,
    mapping: "中",
  },
  {
    id: "opus",
    label: "深思",
    subtitle: "更深的推理链",
    effort: "high",
    maxTokens: 3072,
    mapping: "深",
  },
];

export function getModel(id: ModelId): ModelOption {
  return MODELS.find((m) => m.id === id) ?? MODELS[1]!;
}

export const QUOTA_LIMIT = 40;
export const QUOTA_WINDOW_MS = 5 * 60 * 60 * 1000;
