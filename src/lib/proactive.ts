import { resolveAiName } from "@/lib/branding";
import { pickWorldEntries, promptToolsFor, systemPrompt, type PromptInput } from "@/lib/prompt";
import { useApp } from "@/lib/store";

/**
 * **主动通道的唯一一份提示词**（用户 m05637："自由活动还有定时啥的反正跟自动唤醒有关的都按着
 * 一套来，我不想看到出现两种人格"）。
 *
 * 为什么要有这个文件：主动说话原来有三套写法各写各的 ——
 *
 *   · 前台「醒着」：`lib/awake.ts` 自己拼一段 guidance
 *   · 定时/自由活动/日记/回响：`lib/wake-prompt.ts` 的 `buildProactiveInstruction()`
 *   · 手机后台那段 JS：用 App 推下去的 `cfg_prompt_normal/force`（`buildWakePrompt()`）
 *
 * 三套的人设、语气、规矩都不一样，用户听到的就是"两个人在说话"。
 * 现在把**能共用的部分**收成两件东西：
 *
 *   ① `proactiveSystem()` —— 直接就是正文那套 `systemPrompt()`（人设/风格/工具/世界书/
 *      权限说明书全在里面），一个字不改。只要两边都调这一个函数，"同一个人格"就是结构性
 *      保证，不是靠人手抄两遍抄得像。
 *   ② `proactiveEvent()` —— **这一轮发生的事**（几点、隔了多久、上一句是谁说的、心情、
 *      他最近说过什么、记得她什么、这次醒来的由头），以及输出规矩（不许写环境、不许提
 *      系统/时间、没话说可以沉默）。
 *
 * ⚠️ 为什么"事件"没有并进 systemPrompt：正文那条路每轮都重新算 system 文本，前缀缓存
 * 会全部失效；而且事件里的时间和"隔了多久"每轮都不一样。所以分工是——
 * **system 稳定、事件每轮变**，这也正是主流 agent 的做法。
 *
 * ⚠️ 手机后台那条路（`public/runners/wake.js`）跑在网页外面，不能 import 任何模块、
 * 也没法发原生 tools —— 所以后台的模板正文 = `proactiveSystem()` 的输出 + 带
 * `{{TIME}}`/`{{ELAPSED}}` 占位符的 `proactiveEvent()`。App 推下去，后台只替换时间。
 */

/** 沉默标记（沿用 `wake-prompt.ts` 里那套：三种写法都算沉默，标记永远不显示给用户） */
export const SILENT_MARK = "<silent>";

export type ProactiveFacts = {
  /**
   * 这一刻的文字。
   *
   * 前台/定时那条路传人话（`"11月7日 18:04"`）；手机后台那条路传占位符
   * `{{TIME}}` —— 因为"现在几点"只有后台醒来那一瞬间才知道。
   */
  timeText: string;
  /** 「距上次说话多久」。后台那条路同理用 `{{ELAPSED}}`；没有就不写这一句 */
  elapsedText?: string;
  /** 她的名字（取不到就"她"） */
  who?: string;
  /** 心情快照（`emotion.report` 写的那条，可能已经过去几小时） */
  mood?: string;
  /** "心情能不能单独当成开口的理由"（用户设置里的开关） */
  emotionSpeak?: boolean;
  /** 她最后说的那句 */
  lastUser?: string;
  /** 他最后说的那句（提醒"这句她还没接"） */
  lastAssistant?: string;
  /** 他最近自己主动说过的句子 —— 防"每条都一个调调" */
  own?: string[];
  /** 他记得关于她的事（主动通道原来完全不读记忆，所以永远说不出具体的事） */
  memories?: string[];
  /** 他最近动过手的回执（`actionFeedback` 的产物） */
  actions?: string;
  /** 这次醒来的由头（`due.prompt`） */
  intent?: string;
  /** 由头里是不是含着动作写法（他自己排的那三类 = true，不能截断） */
  intentKeepFull?: boolean;
  /** 允不允许沉默（"必说"那一轮 = false） */
  allowSilent?: boolean;
  /** 这一轮他能做的动作（只有前台/定时那条路给；后台那条路没有动作能力） */
  actionHints?: string[];
};

/** 引用一句对话的截断长度（再长就成复读了，要的是"接得上"不是抄一遍） */
const QUOTE_MAX = 60;
/** 用户自己定的提醒一般就一句；太长反而像任务书 */
const INTENT_MAX = 120;
/** 动作回执也只留开头 */
const ACTIONS_MAX = 160;

function clip(text: string, max: number): string {
  const oneLine = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/**
 * **跟正文一模一样的系统提示词**。
 *
 * `PromptInput` 里只有 `tools` / `nativeTools` 这两处需要主动通道自己决定：
 * 后台那条路只能走正文文本协议（`nativeTools: false`），前台那条路照旧。
 */
export function proactiveSystem(extra?: Partial<PromptInput>): string {
  const st = useApp.getState();
  const s = st.settings;
  const input: PromptInput = {
    style: s.replyStyle,
    segmentEnabled: s.segmentReply !== false,
    tools: promptToolsFor(st.mcp ?? [], st.httpTools ?? []),
    nativeTools: false,
    userGender: s.userGender ?? "",
    keepRecent: s.keepRecent,
    name: s.displayName,
    aiName: resolveAiName(s.aiName),
    persona: s.persona || undefined,
    worldAlways: pickWorldEntries(st.worldBook ?? [], "").always,
    permissions: s.permissions,
    ...extra,
  };
  return systemPrompt(input);
}

/**
 * **这一轮发生的事** —— 只讲事实 + 定输出规矩，不下命令。
 *
 * ⚠️ 措辞上的两条铁律（都是被用户点过的）：
 *   · **不许写环境**（"天黑得好快""院子静悄悄的""风有点凉"）—— 用户 m05528 说这是
 *     "像人机"的直接来源：这类话信息量为零，连发十条就是同一副嗓子。
 *   · **不许把机制说出来**（定时/唤醒/任务/系统/提示词）和**不许念时间** ——
 *     上一版最刺眼的就是他回"我收到了定时任务"。
 */
export function proactiveEvent(facts: ProactiveFacts): string {
  const who = (facts.who ?? "").trim() || "她";
  const lines: string[] = [];

  const head = [`现在 ${facts.timeText}`];
  if (facts.elapsedText) head.push(`距你们上次说话过了 ${facts.elapsedText}`);
  lines.push(`（${head.join("。")}。）`);

  lines.push(`这一轮没有人在跟你说话 —— 想说就自然说一句：接着刚才的话，或者你心里的事。`);

  const lastUser = clip(facts.lastUser ?? "", QUOTE_MAX);
  if (lastUser) lines.push(`（${who}上一句说的是：「${lastUser}」）`);
  const lastAssistant = clip(facts.lastAssistant ?? "", QUOTE_MAX);
  if (lastAssistant) lines.push(`（你上一句说的是：「${lastAssistant}」（${who}还没接））`);

  const own = (facts.own ?? []).map((t) => clip(t, QUOTE_MAX)).filter(Boolean);
  if (own.length > 0)
    lines.push(
      `（你最近自己说过：${own.map((t) => `「${t}」`).join("、")} —— 别重复同样的意思和开场）`,
    );

  const mems = (facts.memories ?? [])
    .map((t) => clip(t, QUOTE_MAX))
    .filter(Boolean)
    .slice(0, 3);
  if (mems.length > 0)
    lines.push(`（你记得关于${who}的事：${mems.map((t) => `「${t}」`).join("、")}）`);

  const mood = clip(facts.mood ?? "", 80);
  if (mood) {
    const rule =
      facts.emotionSpeak === false
        ? `心情只影响你怎么说；要开口还得有别的由头`
        : `心情本身就可以是开口的理由，不用等"很久没说话"这种由头`;
    lines.push(`（你此刻的心情：${mood} —— ${rule}）`);
  }

  const intent = clip(facts.intent ?? "", INTENT_MAX);
  if (intent) {
    lines.push(
      facts.intentKeepFull === true
        ? `（你本来想：\n${String(facts.intent ?? "").trim()}\n）`
        : `（你本来想：${intent}）`,
    );
  }

  const actions = clip(facts.actions ?? "", ACTIONS_MAX);
  if (actions) lines.push(`（你最近做过的事：${actions}）`);

  lines.push(
    `别写环境（天气、天光、院子安静、风声这类布景）—— 那不是说话；要说话就说心里的事、接${who}上一句、或者问一件具体的事。`,
  );

  const hints = (facts.actionHints ?? []).map((h) => h.trim()).filter(Boolean);
  if (hints.length > 0) {
    lines.push(
      `想做事就把动作写在正文末尾的 \`\`\`qidao 代码块里，**最多一个**；不想说话就只写动作块，正文留空。能做的动作：`,
    );
    for (const h of hints) lines.push(`  ${h}`);
  }

  lines.push(`别提到"定时""唤醒""任务""系统""提示词"这些词，也别把时间念出来。`);

  if (facts.allowSilent !== false) {
    lines.push(
      hints.length > 0
        ? `（上面那件事该做就做完；真没什么可说的，就只输出 ${SILENT_MARK} —— 这一条不会发出去。）`
        : `如果没有什么值得说的，就只输出 ${SILENT_MARK}（这一条不会发出去）。`,
    );
  }

  return lines.join("\n");
}
