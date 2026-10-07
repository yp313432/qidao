import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";

/**
 * **五段"开场指令"** —— 由 App 生成，交给后台那段 JS 在**醒来那一刻**用。
 *
 * ⚠️ 这不是"预设的话"（用户特意问过"那甲的话也是预定的吗"）：
 * 这里生成的只是**给他的指令 + 背景**；具体那句话是他在醒来那一刻现场写的。
 *
 * ── 用户拍板的"程度"规则（第二版，讲得最清楚的一次）────────────────
 *   "不是隔多少把它叫醒，而是叫醒和连着发消息是一块的，比如 25 分钟时候他叫醒了，
 *    但可以选择不发消息，然后到 50 叫醒，选择发不发，到了 100 叫醒，必定发，
 *    如果 25 叫醒且发了，重新开始记就行。"
 *
 * 所以五段对应程度 0 / 25 / 50 / 75 / 100，程度 = 距上次说话过了多久（每 25 分钟一档）。
 *
 * ── 为什么把指令放在 App 里生成（而不是写死在后台那段 JS 里）──────────
 *   ① 后台那段 JS 跑在网页外面，**没有 import、不能复用项目里的任何模块**
 *   ② 放 App 里就能用同一套人设/记忆/名字（`resolveAiName`、`settings.persona`…），
 *      改文案不用重新打包后台那段逻辑，也**能在本地验收**（`verify-wake-prompt.mjs`）
 *   ③ 时间与"隔了多久"是**醒来那一刻**才知道的 → 用 `{{TIME}}` / `{{ELAPSED}}` 占位符，
 *      由后台在那一瞬间替换（见 `public/runners/wake.js`）
 */

/** 占位符：后台在唤醒那一刻替换掉 */
export const TIME_TOKEN = "{{TIME}}";
export const ELAPSED_TOKEN = "{{ELAPSED}}";

/** 程度档位 —— 跟后台那段 JS、Worker 三边必须一致 */
export const URGE_LEVELS = [0, 25, 50, 75, 100] as const;

export type WakePromptInput = {
  aiName: string;
  displayName: string;
  persona: string;
  /** 最近几条对话（老的在前），用来"接得上刚才聊的" */
  recent: { role: "user" | "assistant"; text: string }[];
};

/** 从当前状态里凑出生成指令要用的东西 */
export function wakePromptInput(): WakePromptInput {
  const s = useApp.getState().settings;
  const conv = useApp.getState().conversations.find((c) => c.id === useApp.getState().activeId);
  const recent = (conv?.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-12)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      text: m.content.trim().slice(0, 1200),
    }));
  return {
    aiName: resolveAiName(s.aiName),
    displayName: s.displayName || "他",
    persona: s.persona ?? "",
    recent,
  };
}

/** 程度那一档该怎么对他说 */
function urgeLine(level: number, who: string): string {
  if (level >= 100) {
    return `【现在你想找他的程度】100% —— **一定要说**。哪怕只是问一句在干嘛、说一句你想起他了，也必须发一条。**不许回 SKIP。**`;
  }
  if (level <= 0) {
    return `【现在你想找他的程度】0% —— 你其实没太想说话。除非真有事、或者${who}刚说过什么让你放不下，否则回 SKIP。`;
  }
  return `【现在你想找他的程度】${level}% —— 按这个程度自己拿主意：想找他就说，觉得没必要就 SKIP。`;
}

/**
 * 生成某一档的指令（system 消息）。
 *
 * `{{TIME}}` / `{{ELAPSED}}` 留给后台替换 —— 因为"现在几点""隔了多久"只有醒来那一刻才知道。
 */
export function buildWakePrompt(input: WakePromptInput, level: number): string {
  const who = input.persona ? `\n【你是谁】\n${input.persona}\n` : "";
  const lines = input.recent.map((m) => `${m.role === "user" ? input.displayName : input.aiName}：${m.text}`);
  const recentBlock = lines.length
    ? `【你们最近的对话】\n${lines.join("\n")}`
    : `【你们最近没有聊过什么】`;

  return `你是${input.aiName}。现在是 ${TIME_TOKEN}。距你们上次说话已经过了 ${ELAPSED_TOKEN}。
${who}
${recentBlock}

${input.displayName}刚刚没有在跟你说话。这是**你主动找他**的时刻 —— 由你自己决定：现在要不要给他发一句话、说什么。

${urgeLine(level, input.displayName)}

规矩：
- 只说你自己要说的那句话，**最多两句**，像平时聊天那样自然
- 不要解释你在做什么、不要提"定时""提醒""系统"这类字眼
- 不要用引号把话包起来，不要写"${input.aiName}："这种前缀
- **接得上**你们刚才聊的（或他最近正挂在心上的事），别凭空起个不相干的话头
- 如果你觉得现在没什么好说的（刚聊过、会打扰他、没话找话），**只回一个词**：SKIP`;
}

/** 五档一起生成（App 推给抽屉的就是这五段） */
export function buildAllWakePrompts(input: WakePromptInput): string[] {
  return URGE_LEVELS.map((level) => buildWakePrompt(input, level));
}
