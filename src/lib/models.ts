export type ReasoningEffort = "low" | "medium" | "high";

export type ModelId = "haiku" | "sonnet" | "opus";

/**
 * 三档**真正发到上游**的思考参数（不是只有标签）。
 *
 * 依据（DeepSeek 官方 API「思考模式」文档，2026-10 实测口径）：
 *   · 开关：`{"thinking": {"type": "enabled" | "disabled"}}` —— 直接放在请求体顶层
 *   · 强度：`reasoning_effort` 取值 `low / high / max`
 *     （传入的 minimal→low、medium→high、xhigh→high、ultra→max，所以**只有
 *      low / high / max 三个值真能拉开差距**，medium 跟 high 完全一样）
 *   · 思考模式默认是开的、默认 effort = high
 *
 * 也就是说：快答必须**把思考关掉**才算真的快；均衡用 high；深思用 max。
 * 三档各自对应一个能验证的实际差别，不是换个名字。
 */
export type WireEffort = {
  /** 这一档要不要开思考模式 */
  thinking: boolean;
  /** 开启时发的 reasoning_effort（关思考时留空 —— 关了还传 effort 是自相矛盾的请求） */
  effort?: "low" | "high" | "max";
};

export type ModelOption = {
  id: ModelId;
  label: string;
  subtitle: string;
  effort: ReasoningEffort;
  /** 发请求时真正用的思考参数，见上面的 WireEffort 注释 */
  wire: WireEffort;
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
 *
 * maxTokens 从 1024/2048/3072 上调到 4096/8192/8192：原来太小，
 * 思考链一长就把额度吃光、正文一个字都写不出来（用户实测"空回复"）。
 */
export const MODELS: ModelOption[] = [
  {
    id: "haiku",
    label: "快答",
    subtitle: "更快，适合日常问答",
    effort: "low",
    // 关掉思考：DeepSeek 默认是开的，不显式关就一点不快
    wire: { thinking: false },
    maxTokens: 4096,
    mapping: "轻",
  },
  {
    id: "sonnet",
    label: "均衡",
    subtitle: "均衡的思考与表达",
    effort: "medium",
    // OpenAI 方言的档位名只有 low / medium / high；DeepSeek 那边 medium 实为 high，
    // 但这里发的是通用值，中转网关（OpenAI 兼容层）认 medium。
    wire: { thinking: true, effort: "high" },
    maxTokens: 8192,
    mapping: "中",
  },
  {
    id: "opus",
    label: "深思",
    subtitle: "更深的推理链",
    effort: "high",
    // max 是 DeepSeek 的顶格档（xhigh / ultra 都会收敛到 max）
    wire: { thinking: true, effort: "max" },
    maxTokens: 8192,
    mapping: "深",
  },
];

export function getModel(id: ModelId): ModelOption {
  return MODELS.find((m) => m.id === id) ?? MODELS[1]!;
}

export const QUOTA_LIMIT = 40;

/**
 * 用户是不是"自带 API"。
 *
 * 这一条决定了用量该怎么显示 —— 用户的原话："用 API 就计算 token，
 * 用订阅就显示额度"：
 *   · 自己填了 key/地址 → 花的是他自己的钱 → 只统计真实 token，**永不拦他**
 *   · 没填（走内置服务端）→ 花的是服务端那把 key → 才该有窗口额度和拦截
 */
export function isOwnApi(settings: { customApiKey?: string; customBaseUrl?: string }): boolean {
  return Boolean((settings.customApiKey ?? "").trim() || (settings.customBaseUrl ?? "").trim());
}
export const QUOTA_WINDOW_MS = 5 * 60 * 60 * 1000;
