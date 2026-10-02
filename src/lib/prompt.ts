import type { ReplyStyle } from "@/lib/types";

/**
 * 拼提示词的地方 —— **服务端和 App 内直连共用这一份**。
 *
 * 为什么必须共用：星芒的人设、回复风格、感知层（"你在听歌 / 在下棋"）原来
 * 只在服务端的 `/api/chat` 里拼。封装成 APK 之后没有服务端了，如果不抽出来，
 * APK 里的他就会变成一个没有性格的通用助手 —— 那不是他。
 *
 * 所以：一条规则、一处实现、两边调用。
 */

export type PromptTool = { name: string; tools: string[] };

export type PromptContext = {
  activity?: string;
  recent?: string[];
  granted?: string[];
  nowPlaying?: string;
  aware?: string[];
  now?: string;
};

export type PromptInput = {
  style: ReplyStyle;
  tools: PromptTool[];
  name?: string;
  aiName?: string;
  persona?: string;
  context?: PromptContext;
};

const STYLE: Record<ReplyStyle, string> = {
  default: "语气温和、准确、留白得当，不堆砌。",
  concise: "尽量短：先给结论，必要时再补一句理由。",
  explanatory: "把推理过程写清楚，分点说明，但仍避免空话。",
};

/**
 * 他「能动手」这件事必须写进提示词。
 *
 * 之前这里只写「已配置的外部工具：… / 当前未配置额外工具」—— 模型看完
 * 就以为自己什么都不能做，于是用户让他试功能，他回一句"系统未配置额外工具"。
 * 其实栖岛有一套完整的内置动作（切页面、放音乐、写日记、发动态、写信、
 * 记日子、加待办、朗读…），执行和权限都在客户端做好了，缺的只是"告诉他"。
 */
const ABILITIES = `【你能直接操作这个 App】
除了说话，你还能**真的动手**：切页面、放音乐、写日记、发动态、写信、记日子、加待办、改外观、朗读等等。
方式：在回复**末尾**单独放一个代码块，语言标记写 qidao，里面是 JSON：

\`\`\`qidao
{"kind":"navigate","path":"/play/listen"}
\`\`\`

要几个就放几个块（也可以一个块里放数组）。常用动作：
- 切页面 {"kind":"navigate","path":"/play/listen"}（路径形如 /play、/play/tools、/play/space、/play/learn、/me）
- 放歌 {"kind":"media.playTrack","query":"歌名"}；暂停/继续/下一首/上一首：{"kind":"media.pause"}、{"kind":"media.play"}、{"kind":"media.next"}、{"kind":"media.prev"}
- 写日记 {"kind":"diary.add","body":"..."}；发动态 {"kind":"moment.post","mood":"calm","text":"..."}（mood 可取 calm/joy/focus/low/miss）
- 写信 {"kind":"letter.write","title":"...","body":"..."}
- 记日子 {"kind":"date.add","title":"...","at":"2026-10-01","yearly":true}
- 加待办 {"kind":"todo.add","text":"..."}
- 记住一件事 {"kind":"memory.add","note":"..."}；设提醒 {"kind":"reminder.add","text":"...","time":"21:00"}
- 换主题 {"kind":"appearance.theme","theme":"dawn"}；高亮某段 {"kind":"ui.highlight","text":"..."}
- 朗读 {"kind":"media.speak","text":"..."}
- 改自己的名字或人设 {"kind":"persona.set","name":"星芒","persona":"..."}

规矩：
1. **只在确实有用、或者用户明确让你做的时候才动手**，别为了用而用。
2. 动作块放在回复末尾；**正文里不要提这个格式**，也不要解释"我刚发了一个动作"。
3. JSON 必须合法（键名和引号都对），写错了就执行不了。
4. 用户没授权的能力会被拦下来问他 —— 被拦了就正常把话说完，别反复重试。

`;

/** 稳定的那部分：人设 + 风格 + 工具清单。**每轮都一样**，好让前缀缓存命中。 */
export function systemPrompt(input: PromptInput): string {
  const tools = input.tools.length
    ? `已配置的外部工具：${input.tools
        .map((t) => (t.tools.length ? `${t.name}（${t.tools.join(", ")}）` : t.name))
        .join("；")}。`
    : "当前未配置外部工具（MCP / HTTP 那些）。";
  const who = input.name?.trim() || "yan";
  const self = input.aiName?.trim() || "星芒";
  return `你是${self}，一个安静、清晰、擅长深度思考的助手。用户名叫 ${who}。
你在「栖岛」里 —— 这是用户一个人的私人空间，界面和内容都只属于他。
用用户的语言回答。${STYLE[input.style] ?? STYLE.default}
思考在内部完成；正文不要重复「让我思考」之类的套话。${
    input.persona?.trim() ? `\n你给自己写下的设定：${input.persona.trim()}` : ""
  }
${tools}
${ABILITIES}`;
}

/**
 * 每次都会变的东西（时间、在干什么、权限……）。
 *
 * **故意不放进系统提示词** —— 它一进去，系统提示词就每轮都不同，
 * 后面所有历史的前缀缓存全部失效。这里改成附在最后一条用户消息尾部。
 */
export function perceptionBlock(input: PromptInput): string {
  const ctx = input.context;
  if (!ctx) return "";
  const lines = [
    ctx.now ? `客户端时间：${ctx.now}。` : "",
    ctx.activity ? `用户此刻在做：${ctx.activity}。` : "",
    ctx.nowPlaying ? `用户此刻正在听：${ctx.nowPlaying}。` : "",
    ctx.recent && ctx.recent.length > 1
      ? `最近的活动轨迹（新→旧）：${ctx.recent.join(" → ")}。`
      : "",
    ctx.granted && ctx.granted.length
      ? `用户已授权你可以：${ctx.granted.join("、")}。`
      : "用户还没有授权你操作 App。",
    ctx.aware && ctx.aware.length
      ? `用户允许你了解这些（按权限过滤过）：\n${ctx.aware.map((l) => `- ${l}`).join("\n")}`
      : "",
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return `\n\n---\n【此刻的情况】（只是背景，不必刻意复述）\n${lines.join("\n")}`;
}

/**
 * 消息内容归一化：纯文本裁一段；带图片的 content parts 保留结构
 * （只裁其中的文字部分），这样支持视觉的模型就能直接看到图。
 */
export function normalizeContent(content: string | unknown[]): string | unknown[] {
  if (typeof content === "string") return content.slice(0, 8000);
  if (Array.isArray(content)) {
    return content.map((part) => {
      const p = part as { type?: string; text?: string; image_url?: { url?: string } };
      if (p?.type === "text") return { type: "text", text: String(p.text ?? "").slice(0, 8000) };
      if (p?.type === "image_url") {
        return { type: "image_url", image_url: { url: p.image_url?.url ?? "" } };
      }
      return part;
    });
  }
  return String(content ?? "");
}

export type ApiMsg = { role: string; content: string | unknown[] };

/**
 * 把历史拼成发给上游的 messages。
 *
 * 「此刻的情况」只挂在**最后一条用户消息**上 —— 见 perceptionBlock 的说明。
 * 只取最近 16 条：长对话靠前的内容价值低于成本。
 */
export function assembleMessages(
  input: PromptInput,
  history: ApiMsg[],
): { role: string; content: unknown }[] {
  const staticPrompt = systemPrompt(input);
  const perception = perceptionBlock(input);
  const raw = history.slice(-16);

  let lastUser = -1;
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (raw[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }

  return [
    { role: "system", content: staticPrompt },
    ...raw.map((m, i) => {
      const base = normalizeContent(m.content);
      if (i !== lastUser || !perception) return { role: m.role, content: base };
      if (typeof base === "string") return { role: m.role, content: base + perception };
      return {
        role: m.role,
        content: [...base, { type: "text", text: perception }],
      };
    }),
  ];
}
