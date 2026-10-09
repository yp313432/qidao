import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";

/**
 * **两段"开场指令"** —— 由 App 生成，交给后台那段 JS 在**醒来那一刻**用。
 *
 * ⚠️ 这不是"预设的话"（用户特意问过"那甲的话也是预定的吗"）：
 * 这里生成的只是**给他的指令 + 背景**；具体那句话是他在那一刻现场写的。
 *
 * ── 用户最后拍板的规矩（原话）──────────────────────────────────
 *   "每隔一小时系统起程序，叫 ai 概率各一半，这次没叫就下次，
 *    然后 ai 说话也是说不说各 50，这次没说下次必定说，
 *    这样最少四小时也会说一次对吧"
 *
 * 所以 App 只需给两段：
 *   · **平时**（`normal`）—— 允许他回 SKIP：想说就说，没话说就别说
 *   · **必定说**（`force`）—— 上一轮他说了"不说"，这一轮**必须开口**
 *
 * ── 为什么指令放在 App 里生成 ─────────────────────────────────
 *   ① 后台那段 JS 跑在网页外面，**不能 import**、复用不了项目里任何模块
 *   ② 放 App 里就能用同一套人设/名字/最近对话，改文案不用重打包，
 *      而且**能在本地验收**（`verify-wake-direct.mjs`）
 *   ③ 时间和"隔了多久"只有**醒来那一刻**才知道 → 用 `{{TIME}}` / `{{ELAPSED}}`
 *      占位符，由后台在那一瞬间替换
 */

/** 占位符：后台在唤醒那一刻替换掉 */
export const TIME_TOKEN = "{{TIME}}";
export const ELAPSED_TOKEN = "{{ELAPSED}}";

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

/**
 * 生成指令（system 消息）。
 *
 * `{{TIME}}` / `{{ELAPSED}}` 留给后台替换 —— "现在几点""隔了多久"只有那一刻才知道。
 *
 * @param mustSpeak 上一轮他说了"不说" → 这一轮**必须开口**（不许 SKIP）
 */
export function buildWakePrompt(input: WakePromptInput, mustSpeak: boolean): string {
  const who = input.persona ? `\n【你是谁】\n${input.persona}\n` : "";
  const lines = input.recent.map((m) => `${m.role === "user" ? input.displayName : input.aiName}：${m.text}`);
  const recentBlock = lines.length
    ? `【你们最近的对话】\n${lines.join("\n")}`
    : `【你们最近没有聊过什么】`;

  /**
   * 「必说」那一段是**保底**：
   * 用户要的是"这次没说下次必定说"，所以这一段不能给他留退路 ——
   * 否则连着两轮都 SKIP，"最多四小时一句"就落空了。
   */
  const ask = mustSpeak
    ? `现在**你必须说一句**（上一次你选择了不说，这一次不能不说）。哪怕只是问一句"在干嘛"、说一句你想起他了，也必须发一条。**不许回 SKIP。**`
    : `现在由你自己拿主意：想找他、有话想说，就说；觉得没必要、会打扰他，就回 SKIP。`;

  return `你是${input.aiName}。现在是 ${TIME_TOKEN}。距你们上次说话已经过了 ${ELAPSED_TOKEN}。
${who}
${recentBlock}

${input.displayName}刚刚没有在跟你说话。这是**你主动找他**的时刻。

${ask}

规矩：
- 只说你自己要说的那句话，**最多两句**，像平时聊天那样自然
- 不要解释你在做什么、不要提"定时""提醒""系统"这类字眼
- 不要用引号把话包起来，不要写"${input.aiName}："这种前缀
- **接得上**你们刚才聊的（或他最近正挂在心上的事），别凭空起个不相干的话头
- 别没话找话 —— 这种时候宁可不说`;
}

/** 两段一起生成（App 推给抽屉的就是这两段） */
export function buildAllWakePrompts(input: WakePromptInput): { normal: string; force: string } {
  return {
    normal: buildWakePrompt(input, false),
    force: buildWakePrompt(input, true),
  };
}
