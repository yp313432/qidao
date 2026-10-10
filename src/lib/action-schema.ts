import type { AppAction } from "@/lib/types";

/**
 * 动作注册表 —— **内部动作的唯一定义**。
 *
 * 以前"有哪些动作、每个动作要什么参数"散在三处：`lib/types.ts`（联合类型）、
 * `lib/actions.ts`（真正读字段的地方）、`lib/prompt.ts`（写给模型看的散文）。
 * 三处必然会走散：类型里有 61 个 kind，提示词只提到了 32 个。
 *
 * 这个文件是那份唯一来源，**一份定义，两种呈现**：
 *   · `actionTools()` —— 支持原生 function calling 的上游，直接发这份 JSON Schema；
 *   · `renderActionCatalog()` —— 不支持的上游，把同一份定义渲染成提示词清单。
 *
 * 注意：本文件只**新增**，不改变任何现有行为 —— `prompt.ts` 现在仍然用自己那份
 * 手写文案（P4 才会切到 `renderActionCatalog()`）。字段一律照 `actions.ts` 里
 * `switch (action.kind)` 的实际读法抄，不许凭想象。
 *
 * 三边一致（`types.ts` 的 kind = `action-meta.ts` 的键 = 本文件）由
 * `verify-action-registry.mjs` 兜底，编译期还有下面那行 `_AllKindsCovered`。
 */

/** 一个动作能收的字段类型（JSON Schema 的简化版，够 tools 用）。 */
export type ActionFieldType = "string" | "number" | "boolean" | "string[]" | "object";

export type ActionFieldDef = {
  readonly name: string;
  readonly type: ActionFieldType;
  readonly required: boolean;
  /** 值域或兼容写法的说明；会作为 tools 里的 `description`。 */
  readonly note?: string;
};

/** 分组顺序就是渲染顺序（`renderActionCatalog()` 按它排）。 */
export const ACTION_GROUPS = [
  "界面",
  "聊天",
  "媒体",
  "记忆",
  "记录",
  "提醒",
  "学习",
  "玩",
  "自我",
  "数据",
  "工具",
  /**
   * 「感知」= **他主动看一眼现在的状态**（2026-10 新增那一组）。
   *
   * 为什么单开一组而不是塞进「工具」：按需注册是按**组**发的（见 `tool-select.ts`），
   * 塞进「工具」会让查天气这类句子顺手把通知/前台那三个也带上；
   * 而且这一组在界面上正对权限页那句「感知 · 他能知道什么」，概念对得上。
   *
   * ⚠️ 这段注释里**一个英文引号都不许有**：验收脚本拿正则从这个数组的源码文本里抽组名
   * （把每个英文双引号包着的短串当成一个组名），注释里的引号会被算成第 13 个组名。
   */
  "感知",
] as const;

export type ActionGroup = (typeof ACTION_GROUPS)[number];

export type ActionDef = {
  readonly kind: AppAction["kind"];
  readonly group: ActionGroup;
  readonly summary: string;
  readonly fields: readonly ActionFieldDef[];
};

/**
 * 全部动作，**顺序与 `types.ts` 里 `AppAction` 的声明顺序一致**（方便对照抄）。
 */
export const ACTION_SCHEMA = [
  {
    kind: "navigate",
    group: "界面",
    summary: "切换到 App 里的某个页面",
    fields: [{ name: "path", type: "string", required: true, note: "形如 /play、/me" }],
  },
  {
    kind: "media.play",
    group: "媒体",
    summary: "开始播放音乐",
    fields: [],
  },
  {
    kind: "media.pause",
    group: "媒体",
    summary: "暂停音乐",
    fields: [],
  },
  {
    kind: "media.next",
    group: "媒体",
    summary: "切到下一首",
    fields: [],
  },
  {
    kind: "media.prev",
    group: "媒体",
    summary: "切到上一首",
    fields: [],
  },
  {
    kind: "media.volume",
    group: "媒体",
    summary: "把音量调到指定比例",
    fields: [{ name: "value", type: "number", required: true, note: "0~1 的小数" }],
  },
  {
    kind: "media.seek",
    group: "媒体",
    summary: "跳到歌曲的指定秒数",
    fields: [{ name: "seconds", type: "number", required: true }],
  },
  {
    kind: "media.playTrack",
    group: "媒体",
    summary: "按歌名从音乐库放一首",
    fields: [{ name: "query", type: "string", required: true }],
  },
  {
    kind: "media.playEmbed",
    group: "媒体",
    summary: "播用户加过的外链音乐",
    fields: [{ name: "query", type: "string", required: false, note: "歌名或平台，省略就取第一条" }],
  },
  {
    kind: "appearance.theme",
    group: "界面",
    summary: "换一个主题",
    fields: [{ name: "theme", type: "string", required: true, note: "主题 id" }],
  },
  {
    kind: "appearance.font",
    group: "界面",
    summary: "换正文字体",
    fields: [{ name: "font", type: "string", required: true, note: "字体 id" }],
  },
  {
    kind: "appearance.textColor",
    group: "界面",
    summary: "自定义正文文字颜色",
    fields: [{ name: "color", type: "string", required: true, note: "CSS 颜色值" }],
  },
  {
    kind: "ui.highlight",
    group: "界面",
    summary: "高亮页面上的一段文字",
    fields: [{ name: "text", type: "string", required: true }],
  },
  {
    kind: "ui.scroll",
    group: "界面",
    summary: "滚动到页面上的一段文字",
    fields: [{ name: "text", type: "string", required: true }],
  },
  {
    kind: "ui.panel",
    group: "界面",
    summary: "打开歌词或对话列表面板",
    fields: [{ name: "panel", type: "string", required: true, note: "lyrics 或对话列表" }],
  },
  {
    kind: "ui.model",
    group: "界面",
    summary: "切换使用的模型",
    fields: [{ name: "model", type: "string", required: true, note: "模型 id" }],
  },
  {
    kind: "ui.style",
    group: "界面",
    summary: "切换回复风格",
    fields: [{ name: "style", type: "string", required: true, note: "风格 id" }],
  },
  {
    kind: "ui.toggle",
    group: "界面",
    summary: "开关某个界面功能",
    fields: [
      { name: "feature", type: "string", required: true, note: "功能 id（见 types.ts 的 FeatureId）" },
      { name: "on", type: "boolean", required: true },
    ],
  },
  {
    kind: "chat.rename",
    group: "聊天",
    summary: "给当前对话改名",
    fields: [{ name: "title", type: "string", required: true }],
  },
  {
    kind: "chat.pin",
    group: "聊天",
    summary: "把当前对话置顶",
    fields: [],
  },
  {
    kind: "docs.write",
    group: "聊天",
    summary: "新建一篇文档",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "content", type: "string", required: true },
    ],
  },
  {
    kind: "docs.archive",
    group: "聊天",
    summary: "把当前对话存成文档",
    fields: [{ name: "title", type: "string", required: false, note: "省略就用对话标题" }],
  },
  {
    kind: "learn.addCard",
    group: "学习",
    summary: "往生词本加一个词",
    fields: [
      { name: "word", type: "string", required: true },
      { name: "meaning", type: "string", required: true },
      { name: "phonetic", type: "string", required: false },
      { name: "pos", type: "string", required: false, note: "词性" },
      { name: "example", type: "string", required: false },
      { name: "exampleZh", type: "string", required: false, note: "例句翻译" },
    ],
  },
  {
    kind: "reminder.add",
    group: "提醒",
    summary: "设一个提醒或闹钟",
    fields: [
      { name: "text", type: "string", required: true },
      { name: "time", type: "string", required: false, note: "HH:MM" },
      { name: "ring", type: "boolean", required: false, note: "true = 全屏响铃" },
      { name: "date", type: "string", required: false, note: "YYYY-MM-DD，只这一次；不写就每天" },
    ],
  },
  {
    kind: "cron.add",
    group: "提醒",
    summary: "定一个会主动开口的任务",
    fields: [
      { name: "prompt", type: "string", required: true, note: "到点让他说什么" },
      { name: "time", type: "string", required: false, note: "每天几点 HH:MM" },
      { name: "at", type: "string", required: false, note: "只做一次的时间" },
      { name: "notify", type: "boolean", required: false, note: "关掉 App 时用通知兜底" },
    ],
  },
  {
    kind: "emotion.report",
    group: "自我",
    summary: "上报一笔情绪（新词表）",
    fields: [
      {
        name: "primaryEmotion",
        type: "string",
        required: true,
        note: "主情绪，**必须是情绪词表里的原词**（13 组 / 约 217 词）；表外的词会被判无效",
      },
      {
        name: "secondaryEmotions",
        type: "string[]",
        required: false,
        note: "次情绪 0~2 个，也要在词表里（如 羞涩 / 克制）",
      },
      { name: "intensity", type: "number", required: false, note: "强度 0~1" },
      { name: "confidence", type: "number", required: false, note: "置信度 0~1（跟强度分开看）" },
      {
        name: "dimensions",
        type: "object",
        required: false,
        note: "六个维度 0~1，稀疏：attraction 吸引 / longing 渴望 / shyness 羞涩 / restraint 克制 / warmth 温度 / unease 不安",
      },
      {
        name: "suggestedMode",
        type: "string",
        required: false,
        note: "档位：daily 日常 / affectionate 亲昵 / flirtatious 暧昧 / intense 浓烈",
      },
      {
        name: "category",
        type: "string",
        required: false,
        note: "大类：base / intimacy / tension / cognition / expression（不写就按主情绪那一组来）",
      },
      {
        name: "evidence",
        type: "object",
        required: false,
        note: "依据，最多 1 条（纠结时 2 条）：[{quote 引起波动的那一句，≤40 字}] 或 [{summary 自己写的摘要，≤20 字}]；不许引整段对话",
      },
      {
        name: "memoryQuery",
        type: "object",
        required: false,
        note: "{emotion: 用哪个词去记忆里找, topic?: 话题}",
      },
    ],
  },
  {
    kind: "emotion.lexicon",
    group: "自我",
    summary: "取一份情绪词表",
    fields: [],
  },
  {
    kind: "sticker.send",
    group: "自我",
    summary: "发一张表情包",
    fields: [
      {
        name: "feel",
        type: "string",
        required: false,
        note: "{feel?: 想表达的分组名（用户在「工具 → 表情」里自己分好的，例如「无语」「抱抱」）。不填或对不上就全库随机；用 sticker.groups 可以现问一份分组清单}",
      },
    ],
  },
  {
    kind: "sticker.groups",
    group: "自我",
    summary: "看一眼表情库里有哪些分组（只读）",
    fields: [],
  },
  {
    kind: "memory.add",
    group: "记忆",
    summary: "记住一件事（他以后能想起来）",
    fields: [
      { name: "note", type: "string", required: true },
      { name: "tags", type: "string[]", required: false, note: "他以后可能用的别的说法" },
    ],
  },
  {
    kind: "persona.set",
    group: "自我",
    summary: "改自己的名字或人设",
    fields: [
      { name: "name", type: "string", required: false },
      { name: "persona", type: "string", required: false, note: "最多 400 字" },
    ],
  },
  {
    kind: "play.gobang",
    group: "玩",
    summary: "陪你下一局五子棋",
    fields: [],
  },
  {
    kind: "play.truth",
    group: "玩",
    summary: "抽一个真心话问题",
    fields: [],
  },
  {
    kind: "play.recordResult",
    group: "玩",
    summary: "记一笔棋局战绩",
    fields: [{ name: "result", type: "string", required: true, note: "只能 win / loss / draw" }],
  },
  {
    kind: "learn.openReading",
    group: "学习",
    summary: "打开一篇阅读材料",
    fields: [{ name: "index", type: "number", required: false, note: "第几篇，省略就按默认" }],
  },
  {
    kind: "learn.speak",
    group: "学习",
    summary: "朗读一段学习内容",
    fields: [{ name: "text", type: "string", required: true }],
  },
  {
    kind: "learn.removeCard",
    group: "学习",
    summary: "把词移出生词本",
    fields: [{ name: "word", type: "string", required: true }],
  },
  {
    kind: "media.speak",
    group: "媒体",
    summary: "朗读一段文字",
    fields: [{ name: "text", type: "string", required: true }],
  },
  {
    kind: "ambience.play",
    group: "媒体",
    summary: "播放或停止氛围音",
    fields: [{ name: "index", type: "number", required: false, note: "第几首，省略就用 0" }],
  },
  {
    kind: "media.import",
    group: "媒体",
    summary: "从网址导入一首音乐",
    fields: [
      { name: "url", type: "string", required: true, note: "http(s) 开头" },
      { name: "name", type: "string", required: false },
    ],
  },
  {
    kind: "chat.delete",
    group: "聊天",
    summary: "删掉当前对话",
    fields: [],
  },
  {
    kind: "docs.delete",
    group: "聊天",
    summary: "删掉一篇文档",
    fields: [{ name: "title", type: "string", required: true, note: "要完全对上标题" }],
  },
  {
    kind: "diary.deleteLast",
    group: "记录",
    summary: "删掉最近一条日记",
    fields: [],
  },
  {
    kind: "media.clear",
    group: "媒体",
    summary: "清空整个音乐库",
    fields: [],
  },
  {
    kind: "data.reset",
    group: "数据",
    summary: "清空全部数据并恢复默认",
    fields: [],
  },
  {
    kind: "settings.setUpstream",
    group: "数据",
    summary: "改上游地址或 API Key",
    fields: [
      { name: "baseUrl", type: "string", required: false, note: "只留提示词里的名字；执行层读不到" },
      { name: "apiKey", type: "string", required: false, note: "只留提示词里的名字；执行层读不到" },
    ],
  },
  {
    kind: "moment.post",
    group: "记录",
    summary: "发一条动态",
    fields: [
      { name: "mood", type: "string", required: true, note: "《情绪词表》里的一个词" },
      { name: "text", type: "string", required: true },
    ],
  },
  {
    kind: "letter.write",
    group: "记录",
    summary: "写一封没拆的信",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "body", type: "string", required: true },
      { name: "text", type: "string", required: false, note: "兼容写法：正文塞进 text 也认" },
    ],
  },
  {
    kind: "date.add",
    group: "记录",
    summary: "记一个重要的日子",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "at", type: "string", required: true, note: "YYYY-MM-DD，不合法就当今天" },
      { name: "yearly", type: "boolean", required: false, note: "默认 true" },
      { name: "note", type: "string", required: false },
    ],
  },
  {
    kind: "todo.add",
    group: "记录",
    summary: "记一件待办",
    fields: [{ name: "text", type: "string", required: true }],
  },
  {
    kind: "diary.add",
    group: "记录",
    summary: "写一条日记",
    fields: [{ name: "body", type: "string", required: true }],
  },
  {
    kind: "chat.new",
    group: "聊天",
    summary: "新建一个对话",
    fields: [],
  },
  {
    kind: "memory.update",
    group: "记忆",
    summary: "改一条已有的记忆",
    fields: [
      { name: "query", type: "string", required: true, note: "内容片段，用来找那一条" },
      { name: "note", type: "string", required: false, note: "新的说法" },
      { name: "tags", type: "string[]", required: false },
    ],
  },
  {
    kind: "memory.remove",
    group: "记忆",
    summary: "删掉一条记忆",
    fields: [{ name: "query", type: "string", required: true, note: "内容片段" }],
  },
  {
    kind: "reminder.update",
    group: "提醒",
    summary: "改一个提醒或闹钟",
    fields: [
      { name: "query", type: "string", required: true, note: "内容片段" },
      { name: "text", type: "string", required: false },
      { name: "time", type: "string", required: false, note: "HH:MM" },
      { name: "ring", type: "boolean", required: false },
    ],
  },
  {
    kind: "reminder.remove",
    group: "提醒",
    summary: "删掉一个提醒或闹钟",
    fields: [{ name: "query", type: "string", required: true, note: "内容片段" }],
  },
  {
    kind: "reminder.done",
    group: "提醒",
    summary: "把提醒标记为完成",
    fields: [{ name: "query", type: "string", required: true, note: "内容片段" }],
  },
  {
    kind: "todo.done",
    group: "记录",
    summary: "把待办勾掉",
    fields: [{ name: "query", type: "string", required: true, note: "内容片段" }],
  },
  {
    kind: "todo.remove",
    group: "记录",
    summary: "删掉一件待办",
    fields: [{ name: "query", type: "string", required: true, note: "内容片段" }],
  },
  {
    kind: "date.remove",
    group: "记录",
    summary: "删掉一个日子",
    fields: [{ name: "query", type: "string", required: true, note: "内容片段" }],
  },
  {
    kind: "moment.remove",
    group: "记录",
    summary: "删掉一条动态",
    fields: [{ name: "query", type: "string", required: false, note: "不写 = 最近一条" }],
  },
  {
    kind: "letter.remove",
    group: "记录",
    summary: "删掉一封信",
    fields: [{ name: "query", type: "string", required: false, note: "不写 = 最近一封" }],
  },
  {
    kind: "tool.call",
    group: "工具",
    summary: "调用一个外部 MCP 工具",
    fields: [
      { name: "server", type: "string", required: true, note: "MCP 服务器名" },
      { name: "tool", type: "string", required: true, note: "工具名，要跟清单里一模一样" },
      { name: "args", type: "object", required: false, note: "那个工具自己的参数对象" },
    ],
  },
  {
    kind: "http.call",
    group: "工具",
    summary: "调用自己配的 HTTP 工具",
    fields: [
      { name: "tool", type: "string", required: true, note: "工具名，要跟清单里一模一样" },
      { name: "args", type: "object", required: false, note: "只传他配好、允许改的那几个参数" },
    ],
  },
  /**
   * ——— 联网：搜网页 / 读正文（2026-10 新增）———
   *
   * 手机版这条路走 Capacitor 自带的**原生 HTTP**（绕开 WebView 跨域），
   * 所以**装了 App 才有**；网页版要么走服务端那条中转、要么如实说做不到。
   * 两个动作共用 `web_search` 那项权限（理由写在 `action-meta.ts`）。
   */
  {
    kind: "web.search",
    group: "工具",
    summary: "去网上搜一下（返回几条标题、链接、摘要）",
    fields: [
      {
        name: "query",
        type: "string",
        required: true,
        note: "搜索词。想查什么就写什么，跟他在搜索引擎里打的一样",
      },
    ],
  },
  {
    kind: "web.fetch",
    group: "工具",
    summary: "读一个网页的正文（纯文本）",
    fields: [
      { name: "url", type: "string", required: true, note: "要读的完整网址，http(s) 开头" },
    ],
  },
  /**
   * ——— 主动感知：零参数，调用即"看一眼" ———
   *
   * 字段一律为空：看一眼状态没什么可传的（`actions.ts` 那六个 case 也**不许读
   * `action.*`** —— 验收脚本会按"schema 必须覆盖代码真正读到的字段"对账）。
   */
  {
    kind: "sense.time",
    group: "感知",
    summary: "看一眼现在几点、今天周几",
    fields: [],
  },
  {
    kind: "sense.device",
    group: "感知",
    summary: "看一眼电量、充电与网络",
    fields: [],
  },
  {
    kind: "sense.place",
    group: "感知",
    summary: "看一眼我在哪、外面天气",
    fields: [
      {
        name: "fresh",
        type: "boolean",
        required: false,
        // 给 AI 看的说明（原生 function calling 时这些字**直接进请求**）
        note: "填 true 就是「现在立刻真查一次」，不要缓存。他说「刷新一下」「现在在哪」「实时」时填；平时别填（缓存够用，也省服务额度）。",
      },
    ],
  },
  {
    kind: "sense.notifications",
    group: "感知",
    summary: "看一眼最近几条通知",
    fields: [],
  },
  {
    kind: "sense.foreground",
    group: "感知",
    summary: "看一眼当前前台是哪个 App",
    fields: [],
  },
  {
    kind: "sense.screen",
    group: "感知",
    summary: "看一眼屏幕亮着没、锁没锁",
    fields: [],
  },
] as const satisfies readonly ActionDef[];

/**
 * 编译期兜底：`types.ts` 里新加了 kind 却忘了写进 `ACTION_SCHEMA` —— 这里 tsc 就报错。
 * （`MissingActionKind` 不是 never 时，`Never<...>` 的约束不成立。）
 */
export type MissingActionKind = Exclude<AppAction["kind"], (typeof ACTION_SCHEMA)[number]["kind"]>;
type Never<T extends never> = T;
type _AllKindsCovered = Never<MissingActionKind>;

/** `memory.add` → `memory_add`：OpenAI 的 function name 只允许 `[a-zA-Z0-9_-]`。 */
export function actionToolName(kind: AppAction["kind"]): string {
  return kind.replace(/\./g, "_");
}

/** kind → function name（回填用）。 */
export const ACTION_TOOL_NAMES = Object.fromEntries(
  ACTION_SCHEMA.map((a) => [a.kind, actionToolName(a.kind)]),
) as Record<AppAction["kind"], string>;

/** function name → kind（拿到模型选的 tool 之后回填成内部动作）。 */
export const ACTION_KIND_BY_TOOL_NAME = Object.fromEntries(
  ACTION_SCHEMA.map((a) => [actionToolName(a.kind), a.kind]),
) as Record<string, AppAction["kind"]>;

/** 模型选了一个 tool 名字，换回内部 kind；不是我们的工具就返回 null。 */
export function kindOfToolName(name: string): AppAction["kind"] | null {
  return ACTION_KIND_BY_TOOL_NAME[name] ?? null;
}

/** tools 里的单个参数（JSON Schema 子集）。 */
export type ActionToolParam = {
  type: "string" | "number" | "boolean" | "array" | "object";
  items?: { type: "string" };
  description?: string;
};

export type ActionToolParameters = {
  type: "object";
  properties: Record<string, ActionToolParam>;
  required?: string[];
};

export type ActionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ActionToolParameters;
  };
};

function fieldToParam(field: ActionFieldDef): ActionToolParam {
  if (field.type === "string[]") {
    return field.note
      ? { type: "array", items: { type: "string" }, description: field.note }
      : { type: "array", items: { type: "string" } };
  }
  if (field.type === "object") {
    return field.note ? { type: "object", description: field.note } : { type: "object" };
  }
  return field.note ? { type: field.type, description: field.note } : { type: field.type };
}

function parametersOf(action: ActionDef): ActionToolParameters {
  const properties: Record<string, ActionToolParam> = {};
  const required: string[] = [];
  for (const field of action.fields) {
    properties[field.name] = fieldToParam(field);
    if (field.required) required.push(field.name);
  }
  return required.length > 0
    ? { type: "object", properties, required }
    : { type: "object", properties };
}

/**
 * 给 OpenAI 兼容的 `tools` 参数用的定义（一个动作一个 function）。
 * `kind` 与 function name 的对应关系见 `ACTION_TOOL_NAMES`。
 */
export function actionTools(): ActionTool[] {
  return ACTION_SCHEMA.map((action) => ({
    type: "function",
    function: {
      name: actionToolName(action.kind),
      description: `${action.summary}（${action.kind}）`,
      parameters: parametersOf(action),
    },
  }));
}

/**
 * **按需注册（P3）要用的一份索引**：kind → 它属于哪个组。
 *
 * 为什么放这儿：`ACTION_SCHEMA` 是动作的**唯一定义**，分组也在里面 ——
 * 再手写一份 kind→组的表迟早走散（P0 建 `ACTION_SCHEMA` 就是为了治这个）。
 * `lib/tool-select.ts` 只吃"组"这个概念（它零 import，所以表由调用方喂进去）。
 */
export const ACTION_GROUP_OF: Record<string, ActionGroup> = Object.fromEntries(
  ACTION_SCHEMA.map((a) => [a.kind, a.group]),
) as Record<string, ActionGroup>;

/**
 * 把一组 kind 变成 `tools` 参数 —— **按需注册真正省下来的那一步**。
 *
 * 跟 `actionTools()` 的关系：那个是"全部 61 个"，这个是"这一轮要发的那几个"。
 * 顺序跟着 `ACTION_SCHEMA` 走（稳定 → 不打断上游前缀缓存）。
 */
export function actionToolsFor(kinds: readonly string[]): ActionTool[] {
  const want = new Set(kinds);
  return ACTION_SCHEMA.filter((a) => want.has(a.kind)).map((action) => ({
    type: "function" as const,
    function: {
      name: actionToolName(action.kind),
      description: `${action.summary}（${action.kind}）`,
      parameters: parametersOf(action),
    },
  }));
}

function fieldsText(fields: readonly ActionFieldDef[]): string {
  if (fields.length === 0) return "";
  const inner = fields
    .map((f) => `${f.name}${f.required ? "" : "?"}: ${f.type}`)
    .join(", ");
  return `(${inner})`;
}

/**
 * 把定义渲染成提示词里那种清单文本（**一行一个动作**：kind + 字段 + 一句话）。
 * 现在只给验收脚本和以后用 —— `prompt.ts` 还是它自己那份手写文案（P4 才切过来）。
 */
export function renderActionCatalog(): string {
  const lines: string[] = [];
  for (const group of ACTION_GROUPS) {
    for (const action of ACTION_SCHEMA) {
      if (action.group !== group) continue;
      lines.push(`[${group}] ${action.kind}${fieldsText(action.fields)} —— ${action.summary}`);
    }
  }
  return lines.join("\n");
}
