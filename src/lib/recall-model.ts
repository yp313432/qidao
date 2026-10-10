/**
 * **记忆召回的"精排"这一步 —— 用现有对话模型跑。**
 *
 * 用户原话："记忆升级的话，加一个那个语义检索功能就可以了，我觉得。"
 * 路线：粗筛（本地免费）→ **精排（这个文件）** → 混合排序。
 *
 * ── 两条纪律（改的时候别破坏）
 *
 *   ① **复用现有上游，绝不另写一套 fetch / 鉴权**。
 *      这里跟 `lib/summarizer.ts` 走的是**同一条路**：读用户在
 *      「我的 → 自定义上游」里的配置，用 `makeDirectRound` / `makeServerRound`
 *      （`lib/chat-client.ts`）发出去。手机（直连）和电脑（走服务端）行为一致。
 *
 *   ② **失败 = 这一步没成，不是整个检索失败**。
 *      这里返回 `null` 就是那个信号（`lib/recall.ts` 收到 `null` 会退回粗筛
 *      并**如实说"语义那一步没成"**）。
 *      `[]`（空数组）是另一个意思：**模型说"一条都不相关"** —— 那是个有效结论。
 *
 * ── 发过去的是什么（省钱的关键）
 *
 * **只发 `id + 一小段内容（≤80 字）+ 标签`**，不发全文，也不发系统提示词 /
 * 人设 / 感知层 —— 精排不需要知道他是谁，只需要判断"这两句意思像不像"。
 * 传了人设只会让它发挥，而"编一条不存在的相关"比"想不起来"更糟。
 */

import {
  makeDirectRound,
  makeServerRound,
  type ApiMessage,
  type ChatDelta,
  type ChatRequest,
} from "@/lib/chat-client";
import { RERANK_MAX_PICKS, type RecallReranker, type RerankCandidate, type RerankPick } from "@/lib/recall";
import { useApp } from "@/lib/store";

/** 精排的输出上限（token）—— 只要一小段 JSON，给多了它就容易啰嗦 */
const RERANK_MAX_TOKENS = 400;

/**
 * 拼精排提示词。
 *
 * ⚠️ 里面那句"**宁可少挑，绝不凑数**"不能删：候选里天然有一批是
 * "最近但无关"的（这正是粗筛补位补进来的），没有这条它会礼貌地把它们都选上。
 */
export function buildRerankPrompt(query: string, candidates: readonly RerankCandidate[]): string {
  const lines = candidates.map((c) => {
    const tags = c.tags.length ? c.tags.join(",") : "（无标签）";
    const kind = c.kind ? `[${c.kind}] ` : "";
    return `- ${c.id} | ${tags} | ${kind}${c.content}`;
  });
  return [
    "你是记忆检索里的「精排」环节：判断下面哪些记忆和用户此刻这句话**真的相关**。",
    "",
    "用户此刻这句话：",
    query,
    "",
    `候选记忆（共 ${candidates.length} 条，格式：id | 标签 | 内容）：`,
    ...lines,
    "",
    "规则：",
    "1. 意思像就算相关 —— 不必字面一样（比如「心慌」和「心里一紧」是同一件事）。",
    "2. 只是「同一类话题」不算相关；宁可少挑，绝不凑数。",
    "3. 最多挑 " + String(RERANK_MAX_PICKS) + " 条，也可以一条都不挑。",
    "4. 每条给一句「为什么相关」，20 字以内，说清关联点。",
    "5. 只能挑候选里出现过的 id，不许新造 id。",
    "",
    "只输出 JSON，不要解释、不要代码块：",
    '{"picks":[{"id":"...","why":"..."}]}',
  ].join("\n");
}

/**
 * 解析模型的回复。
 *
 * 返回 `null` = **解析不了**（这一步没成）；返回 `[]` = 它明确说"都不相关"。
 * 这个区分很重要：前者要如实报"没成"，后者是一个可以放心用的结论。
 */
export function parseRerankReply(text: string, allowedIds: readonly string[]): RerankPick[] | null {
  const raw = String(text ?? "");
  // 它偶尔会包代码块 / 前面带一句话 —— 抠出第一个 { 到最后一个 }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const picks = (parsed as { picks?: unknown }).picks;
  // `{"picks":[]}` 是有效结论；`picks` 字段根本不是数组 = 没按格式回 = 没成
  if (!Array.isArray(picks)) return null;

  const allowed = new Set(allowedIds);
  const seen = new Set<string>();
  const out: RerankPick[] = [];
  for (const item of picks) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as { id?: unknown }).id ?? "").trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    const why = String((item as { why?: unknown }).why ?? "")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ id, why });
    if (out.length >= RERANK_MAX_PICKS) break;
  }
  return out;
}

/**
 * **这台设备现在能不能跑精排？** —— 判据只有一条：**用户已有的上游配置**
 * （「我的 → 自定义上游」里的地址 + 密钥，跟 `lib/models.ts` 的 `isOwnApi` 同一套）。
 *
 * ── 为什么要有这道闸（不是偷懒，是被一条红线逼出来的）
 *
 * 走服务端那条路（`/api/chat` + 服务端的 `QIDAO_UPSTREAM_*`）时，**客户端看不出来**
 * 服务端到底配没配：没配时 `/api/chat` 直接回 503，而浏览器会往控制台记一条
 * **同源**的 `Failed to load resource: 503`。那正是 `verify-emotion-memory.mjs`
 * 盯着的红线（"没有 console.error"）—— 而且更重要：**用户没配上游，我们就不该
 * 偷偷去花服务端那把 key**。
 *
 * 所以这里只认"**他已有的上游配置**"（用户原话）：配了就真的跑语义精排，
 * 没配就如实说这一步没成、退回标签那套 —— **绝不发一个注定 503 的请求**。
 */
export function rerankAvailable(): boolean {
  try {
    const s = useApp.getState().settings;
    return Boolean((s.customBaseUrl ?? "").trim() && (s.customApiKey ?? "").trim());
  } catch {
    return false;
  }
}

/**
 * **真精排器**：拿用户现有的上游配置，发一次极小的请求，把候选挑一遍。
 *
 * 不传 `fetchImpl` 是故意的 —— 走的是 `chat-client` 的默认通道，
 * 跟聊天那条路**完全同一份实现**（不然"手机上"和"电脑上"会走散）。
 *
 * @returns `null` = 这一步没成（调用方退回粗筛）；`[]` = 都不相关
 */
export const chatReranker: RecallReranker = async (input, signal) => {
  const ids = input.candidates.map((c) => c.id);
  if (ids.length === 0) return [];
  // 没配上游就别发（见 `rerankAvailable` 的说明）
  if (!rerankAvailable()) return null;

  let req: ChatRequest;
  let send: ReturnType<typeof makeDirectRound>;
  try {
    const st = useApp.getState();
    const settings = st.settings;
    const prompt = buildRerankPrompt(input.query, input.candidates);
    /**
     * 只发这一条 user 消息，**不拼系统提示词**：
     * `chat-client` 那边是 `req.assembled ?? assembleMessages(...)`，
     * 给了 `assembled` 就不会去拼人设那一套；服务端那一跳收到
     * `assembledMessages` 也直接用（见 `routes/api/chat.ts`）。
     */
    const messages: ApiMessage[] = [{ role: "user", content: prompt }];
    req = {
      model: st.model,
      messages,
      style: settings.replyStyle,
      tools: [],
      customBaseUrl: settings.customBaseUrl || undefined,
      customApiKey: settings.customApiKey || undefined,
      upstreamModel: settings.upstreamModel || undefined,
      name: "recall",
      maxTokens: RERANK_MAX_TOKENS,
      assembled: messages,
    };
    const useDirect = Boolean(
      (settings.customBaseUrl ?? "").trim() && (settings.customApiKey ?? "").trim(),
    );
    // 不带 tools（`tools: null`）—— 这不是"动手"，只是"挑一下"
    send = useDirect ? makeDirectRound(req) : makeServerRound(req);
  } catch (err) {
    // 读配置这一步就炸了 = 这一步没成（不是整个检索失败）
    console.debug("[qidao] 记忆精排：读不到上游配置", err);
    return null;
  }

  let text = "";
  let error: string | undefined;
  const onDelta = (d: ChatDelta) => {
    if (d.error) error = error ?? d.error;
    if (d.content) text += d.content;
  };

  try {
    const round = await send({ messages: req.assembled ?? [], tools: null, onDelta, signal });
    if (round.error && !text) {
      console.debug("[qidao] 记忆精排：上游没回内容", round.error);
      return null;
    }
  } catch (err) {
    console.debug("[qidao] 记忆精排：请求失败", err);
    return null;
  }

  const picks = parseRerankReply(text, ids);
  if (picks === null) {
    console.debug("[qidao] 记忆精排：回复解析不了（当成这一步没成）", text.slice(0, 200));
  }
  return picks;
};
