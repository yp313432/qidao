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
  /**
   * **他此刻的心情**（从最近一笔情绪上报里取的快照，可能已经过去几小时）——
   * 用户 2026-11 要的："根据他现在情绪，不只是上下 5 条信息内容来判断说话内容"。
   * 取不到就是空字符串（那就照旧只看对话）。
   */
  mood?: string;
  /**
   * **情绪能不能单独构成"想说话"的理由**（用户要的那个单独开关，默认开）。
   * 关掉时：只有真有由头（隔了很久 / 深夜 / 他正挂在心上的事）才开口。
   */
  emotionSpeak?: boolean;
};

/** 从当前状态里凑出生成指令要用的东西 */
export function wakePromptInput(): WakePromptInput {
  const st = useApp.getState();
  const s = st.settings;
  const conv = st.conversations.find((c) => c.id === st.activeId);
  const recent = (conv?.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-12)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      text: m.content.trim().slice(0, 1200),
    }));
  /**
   * 心情快照：取**最近一笔情绪上报**（`emotion.report` 写的）。
   * ⚠️ 只说"主情绪 + 强度"，不把整条记录塞进去 —— 后台那条 prompt 越长越贵，
   * 而且他需要的是"什么心情"，不是"当时的证据链"。
   */
  const last = st.emotionEvents?.[0];
  const mood = last
    ? `${last.primaryEmotion}${last.intensity ? `（强度 ${Math.round(Number(last.intensity) * 5)}/5）` : ""}`
    : "";
  return {
    aiName: resolveAiName(s.aiName),
    displayName: s.displayName || "他",
    persona: s.persona ?? "",
    recent,
    mood,
    emotionSpeak: s.emotionSpeak !== false,
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

  /**
   * 【你此刻的心情】+ 情绪那条规矩（2026-11 用户要的）。
   *
   * 用户原话："他醒来之后可以根据我目前的状态……然后说开口说话，根据他现在情绪，
   * 不只是上下 5 条信息内容来判断说话内容。" 以及："他自己情绪到了，也可以发吧，
   * 应该不至于骚扰，或者你给情绪那个加个按钮。"
   * → 所以：心情进 prompt；"情绪能不能单独算理由"由那个开关决定。
   */
  const moodBlock = input.mood
    ? `\n【你此刻的心情】\n${input.mood}（这是你上一次上报的情绪快照，可能已经过去一阵了）\n`
    : "";
  const moodRule = input.mood
    ? input.emotionSpeak === false
      ? "- 你的心情**只影响你怎么说**，不能单独当成找他的理由（要有别的由头才开口）"
      : "- 如果此刻的心情让你**真的很想跟他说点什么**，那本身就可以是理由，不用等「很久没说话」这种由头"
    : "";

  return `你是${input.aiName}。现在是 ${TIME_TOKEN}。距你们上次说话已经过了 ${ELAPSED_TOKEN}。
${who}${moodBlock}
${recentBlock}

这一轮是你的，${input.displayName}没有说话。

${ask}

规矩：
- 只说你自己要说的那句话，**最多两句**，像平时聊天那样自然
- 不要解释你在做什么、不要提"定时""提醒""系统"这类字眼
- 不要用引号把话包起来，不要写"${input.aiName}："这种前缀
- **接得上**你们刚才聊的（或他最近正挂在心上的事），别凭空起个不相干的话头
${moodRule ? `${moodRule}\n` : ""}- 别没话找话 —— 这种时候宁可不说`;
}

/** 两段一起生成（App 推给抽屉的就是这两段） */
export function buildAllWakePrompts(input: WakePromptInput): { normal: string; force: string } {
  return {
    normal: buildWakePrompt(input, false),
    force: buildWakePrompt(input, true),
  };
}

/* ─────────── 「他主动发消息」这条路：环境事实 + 允许沉默 ─────────── */

/**
 * **允许他沉默**的标记。
 *
 * 2026-11 用户点的问题：定时唤醒里他总进"执行任务"模式（"我收到了定时任务"），很割裂。
 * 光换措辞不够 —— 还要给他**一个体面的退路**：真没什么可说的，就只说这个标记，
 * 这一条**不会发出去**（`task-daemon` 认出它就把占位消息撤掉，见 `readSilent`）。
 */
export const SILENT_MARK = "<silent>";

/**
 * 三种写法都算"沉默"（模型偶尔会自己换花样：自闭合、方括号、带空格）。
 * `/i` 是因为它有时写成 `<Silent>`；`g` 让同一句里出现两次也能洗净。
 */
const SILENT_RE = /<\s*silent\s*\/?\s*>|\[\s*silent\s*\]/gi;

/**
 * 读正文里的"沉默"。
 *
 * 返回的 `text` **已经把标记洗掉**（标记永远不该显示给用户）：
 *   · 只剩标记 / 本来就是空 → `silent: true` —— 这一轮不说，占位消息撤掉
 *   · 标记之外还有正文（他先说了一句、又顺手补个标记）→ `silent: false`，正文照发
 */
export function readSilent(raw: string): { silent: boolean; text: string } {
  const text = String(raw ?? "").replace(SILENT_RE, "").trim();
  return { silent: !text, text };
}

/** 环境事实里引用对话那一句的截断长度（再长就成复读了，她要的是"接得上"，不是抄一遍） */
const QUOTE_MAX = 60;
/** 用户自己定的提醒一般就一句；太长反而像任务书，取前 120 字 */
const INTENT_MAX = 120;
/** "你最近做过的事"的回执也只留开头 */
const ACTIONS_MAX = 160;

function clip(text: string, max: number): string {
  const oneLine = String(text ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** 「42 分钟」这种给人看的时间差（不把毫秒数丢给模型） */
function gapText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

/**
 * 「这次醒来的由头」写得很轻 —— 一句"你本来想…"，不是一条命令。
 *
 * ⚠️ **他自己排的那三类**（自由活动 / 日记保底 / 回响）的 prompt 里写着**动作 JSON 的写法**，
 * 一截断就等于把"他真会写日记"这件事弄丢了 —— 所以那类 `keepFull`，原样给。
 * 用户自己定的提醒（"问问她吃饭了没"）本来就很短，太长反而像任务书，取前 120 字。
 */
function intentLine(prompt: string, keepFull: boolean): string {
  const p = String(prompt ?? "").trim();
  if (!p) return "";
  if (keepFull) return `（你本来想：\n${p}\n）`;
  return `（你本来想：${clip(p, INTENT_MAX)}）`;
}

export type ProactiveEnv = {
  /** 此刻（环境事实里的"现在 18:04"） */
  now: Date;
  /** 上一条消息距今多少毫秒（一个消息都没有 = null，那就不写这一句） */
  msSinceLast: number | null;
  /** 她最后说的那句（调用方不要把占位消息算进来） */
  lastUser?: string;
  /** 他最后说的那句 —— 用来提醒"这句她还没接" */
  lastAssistant?: string;
  /** 他最近动过手的回执（`actionFeedback` 的产物），可能为空 */
  actions?: string;
  /** 这次醒来的由头（`due.prompt`） */
  intent?: string;
  /** 由头里是不是含着动作写法（他自己排的那三类 = true，不能截断） */
  intentKeepFull?: boolean;
  /** 她的名字（取不到就叫"她"） */
  displayName?: string;
};

/**
 * **这一轮的注入内容**：只讲事实 + 允许沉默，不下命令。
 *
 * 跟以前那条指令的区别（用户原话："模型进执行任务模式，很割裂"）：
 *   · 以前："【定时任务 · 用户此刻不在场】…请你主动说一句话：…（这是你自己按时醒来的）"
 *     → 这是在**交代一个任务**，他于是回"我收到了定时任务"
 *   · 现在：几点、隔了多久、上一句谁说的、"这一轮是你的" —— 这是**在场**，
 *     他接的是话，不是指令
 *
 * ⚠️ 末尾那两句禁词/禁时间是给**输出**定的：不许把机制（定时/唤醒/系统）和钟点
 * 讲给她听 —— 那是上一版最刺眼的地方。
 */
export function buildProactiveInstruction(env: ProactiveEnv): string {
  const who = (env.displayName ?? "").trim() || "她";
  const hh = String(env.now.getHours()).padStart(2, "0");
  const mm = String(env.now.getMinutes()).padStart(2, "0");
  const facts = [`现在 ${hh}:${mm}`];
  if (env.msSinceLast != null) facts.push(`上一条消息是 ${gapText(env.msSinceLast)}前`);

  const lines: string[] = [
    `（${facts.join("。")}。）`,
    `这一轮没有人在跟你说话 —— 想说就自然说一句：接着刚才的话，或者你心里的事。`,
  ];

  const lastUser = clip(env.lastUser ?? "", QUOTE_MAX);
  if (lastUser) lines.push(`（${who}上一句说的是：「${lastUser}」）`);
  const lastAssistant = clip(env.lastAssistant ?? "", QUOTE_MAX);
  if (lastAssistant) lines.push(`（你上一句说的是：「${lastAssistant}」（${who}还没接））`);

  const intent = intentLine(env.intent ?? "", env.intentKeepFull === true);
  if (intent) lines.push(intent);

  const actions = clip(env.actions ?? "", ACTIONS_MAX);
  if (actions) lines.push(`（你最近做过的事：${actions}）`);

  /**
   * ⚠️ 他自己排的那三类（自由活动 / 日记保底 / 回响）**不能因为"没话说"就把事也省了**：
   * 日记那条 prompt 明写着"今天该有一篇"，这句要是替他开了后门，那天的日记就真没了。
   * 所以那类的沉默只关"嘴上说不说"，不关"该做的事做没做"。
   */
  if (env.intentKeepFull === true) {
    lines.push(
      `（上面那件事该做就做完；真没什么可说的，就只输出 ${SILENT_MARK} —— 这一条不会发出去。）`,
    );
  } else {
    lines.push(`如果没有什么值得说的，就只输出 ${SILENT_MARK}（这一条不会发出去）。`);
  }
  lines.push(`别提到"定时""唤醒""任务""系统""提示"这些词，也别把时间念出来。`);
  return lines.join("\n");
}
