import type { ModelId } from "./models";

export type ChatRole = "user" | "assistant";

/** 一条消息上的附件：图片、文件、表情。 */
export type Attachment = {
  id: string;
  kind: "image" | "file" | "sticker" | "audio";
  name: string;
  mime: string;
  size: number;
  /** 图片 / 表情：dataURL */
  dataUrl?: string;
  /** 文本类文件：抽出来的正文（截断过） */
  text?: string;
  /** 正文是否因为太长被截断 */
  truncated?: boolean;
  /** 语音消息时长（毫秒） */
  durationMs?: number;
};

/** 心情。日记、动态、信都用这一套，免得三处各写各的。 */
export type MoodId = "calm" | "joy" | "focus" | "low" | "spark" | "miss";

/** 一条「动态」：即时的心情。by 表示是他发的还是我自己发的。 */
export type Moment = {
  id: string;
  mood: MoodId;
  text: string;
  at: number;
  by: "ai" | "me";
};

/** 一封他写给我的信。 */
export type Letter = {
  id: string;
  title: string;
  body: string;
  at: number;
  /** 有没有"拆开"看过 —— 没看过的，一进前端就会跳出信封动画 */
  seen: boolean;
};

/** 一个重要日子：生日、纪念日、约好的那天。 */
export type ImportantDate = {
  id: string;
  title: string;
  /** 那一天的 0 点 */
  at: number;
  /** 每年重复（生日、纪念日）；false = 就那一天 */
  yearly: boolean;
  note?: string;
};

/** 待办：一件要做的事。 */
export type Todo = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  doneAt?: number;
};

/** 外链歌单：一条官方外链播放器。 */
export type MusicEmbed = {
  id: string;
  service: "netease" | "qq" | "spotify";
  serviceLabel: string;
  kind: "song" | "playlist" | "album" | "radio" | "artist";
  sourceId: string;
  /** 官方外链播放器地址（iframe src） */
  embedUrl: string;
  height: number;
  /** 用户粘进来的原始链接，方便回看与重贴 */
  sourceUrl: string;
  addedAt: number;
};

/** 一次请求的用量与提示词指纹。 */
export type RequestLogEntry = {
  at: number;
  promptHash: string;
  systemTokens: number;
  model: string;
  prompt?: number;
  completion?: number;
  cached?: number;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  thinking: string;
  thinkingDurationMs: number;
  createdAt: number;
  model?: ModelId;
  savedToDocs?: boolean;
  /** 用户对这条回复的反馈 */
  feedback?: "up" | "down";
  /** 这条消息带的图片 / 文件 / 表情 */
  attachments?: Attachment[];
  /** 上游返回的用量（输入/输出/缓存命中），用于可视化 */
  usage?: {
    prompt?: number;
    completion?: number;
    cached?: number;
    total?: number;
  };
};

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  incognito: boolean;
};

export type ThemeId = "dawn" | "dusk" | "ink";

/** 正文字体族 */
export type FontId = "system" | "serif" | "kai" | "mono";

/** 文字颜色：auto 跟随主题，dark/light 强制明暗，custom 用 textColor */
export type TextTone = "auto" | "dark" | "light" | "custom";

export type BackgroundSettings = {
  /** 用户上传的自定义背景图（dataURL，空字符串表示未上传） */
  image: string;
  /** 背景模糊程度 px */
  blur: number;
  /** 背景暗化程度 0..0.8（对应 brightness(1 - dim)） */
  dim: number;
  /** 背景不透明度 0..1 */
  opacity: number;
};

export type ReplyStyle = "default" | "concise" | "explanatory";

export type Settings = {
  displayName: string;
  /** AI 的名字（用户自填，空则用默认名） */
  aiName: string;
  /** AI 的头像（dataURL，空表示用默认标识） */
  aiAvatar: string;
  /** 他的人设/自述（他可以自己改，会进系统提示词） */
  persona: string;
  /** 我自己的头像（dataURL，空表示用名字首字） */
  userAvatar: string;
  theme: ThemeId;
  font: FontId;
  textTone: TextTone;
  textColor: string;
  showThinking: boolean;
  saveThinking: boolean;
  notifications: boolean;
  quotaAlerts: boolean;
  diaryReminders: boolean;
  /** 日记提醒时间，形如 "21:00" */
  reminderTime: string;
  /** 上下文预算（估算 token 数） */
  contextBudget: number;
  /** 至少保留最近多少条消息（预算再紧也不裁） */
  keepRecent: number;
  /** 超预算时自动折叠更早的消息 */
  autoCompact: boolean;
  /** 用到预算的百分之多少开始折叠 */
  compactAt: number;
  /** 思考档案保留天数，0 = 永久保留 */
  thinkingKeepDays: number;
  /** 语音语言（zh-CN / en-US / … / auto） */
  voiceLang: string;
  /** 语音页是否显示字幕 */
  voiceSubtitles: boolean;
  /** 外链播放页上那句装饰用的句子（可自己改） */
  embedQuote: string;
  /**
   * 「时感」网页的地址。
   *
   * 留空 = 自动：按你现在访问栖岛用的主机名推到 :8081 ——
   * 电脑上打开就是 localhost:8081，手机上打开就是局域网IP:8081，
   * 免得在两台设备上来回改。
   */
  shiganUrl: string;
  /** 音乐播放页自己的背景图（没设就用主页背景） */
  musicImage: string;
  /** 日记动态页自己的背景图（没设就用主页背景） */
  diaryImage: string;
  /**
   * 动画：auto = 跟随系统的「减弱动态效果」；on = 始终开启；off = 关闭。
   * 系统开了「减弱动态效果」时，浏览器会把所有动画压成 0.01ms —— 那就是"看不到动态"。
   */
  motion: "auto" | "on" | "off";
  voiceReplies: boolean;
  replyStyle: ReplyStyle;
  defaultModel: ModelId;
  customBaseUrl: string;
  customApiKey: string;
  background: BackgroundSettings;
  /** AI 的各项权限：询问 / 允许 / 拒绝（清单见 lib/permissions.ts） */
  permissions: Record<string, PermissionMode>;
};

/** MCP 传输方式：http / sse 走网络，stdio 需要服务端起子进程 */
export type McpTransport = "http" | "sse" | "stdio";

/**
 * 一条真实的 MCP 服务器配置（用户自己填）。
 *
 * 注意：配置本身现在就能真实保存 / 测试握手，但**被模型调用**要等接入 AI。
 */
export type McpServer = {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  /** http / sse 用 */
  url: string;
  /** stdio 用：命令与参数 */
  command: string;
  args: string;
  /** 每行一个 "Key: Value" */
  headersText: string;
  enabled: boolean;
  /** 连接成功后回填的工具名 */
  tools: string[];
  /** 最近一次握手结果，仅用于界面展示 */
  status?: { ok: boolean; at: number; message: string };
  kind: "mcp" | "plugin";
};

export type SavedDoc = {
  id: string;
  title: string;
  content: string;
  source: "chat" | "manual";
  createdAt: number;
  conversationId?: string;
};

export type DiaryEntry = {
  id: string;
  mood: MoodId;
  body: string;
  createdAt: number;
};

export type QuotaState = {
  used: number;
  windowStart: number;
};

/**
 * 用户可以自己添加的 HTTP 工具：填好地址和请求头，点一下真的发一次请求。
 * 这部分不依赖 AI，现在就能用；以后接上 AI 之后，同一个定义可以直接
 * 暴露成模型可调用的工具。
 */
export type HttpTool = {
  id: string;
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  /** 每行一个 "Key: Value" */
  headersText: string;
  body: string;
  enabled: boolean;
};

/* ------------------------- AI 权限 / 感知 / 动作 ------------------------- */

/** 权限 id —— 具体清单见 lib/permissions.ts（那里是唯一真源）。 */
export type PermissionId = string;

/** 询问（每次问） / 允许（直接做） / 拒绝（永远不做） */
export type PermissionMode = "ask" | "allow" | "deny";

/** 他可以让你打开的页面 / 面板，或替你在页面上做的动作。 */
export type PanelId =
  | "lyrics"
  | "chat_drawer"
  | "truth_card"
  | "gobang_new"
  | "learn_reading";

/** 他可以帮你开关的界面功能。 */
export type FeatureId =
  | "thinking"
  | "saveThinking"
  | "voice"
  | "quotaAlert"
  | "notifications"
  | "diaryReminder";

/** AI 能请求 App 做的事。全部由前端执行，所以最终把关在前端。 */
export type AppAction =
  | { kind: "navigate"; path: string }
  | { kind: "media.play" }
  | { kind: "media.pause" }
  | { kind: "media.next" }
  | { kind: "media.prev" }
  | { kind: "media.volume"; value: number }
  | { kind: "media.seek"; seconds: number }
  | { kind: "media.playTrack"; query: string }
  | { kind: "appearance.theme"; theme: ThemeId }
  | { kind: "appearance.font"; font: FontId }
  | { kind: "appearance.textColor"; color: string }
  | { kind: "ui.highlight"; text: string }
  | { kind: "ui.scroll"; text: string }
  | { kind: "ui.panel"; panel: PanelId }
  | { kind: "ui.model"; model: ModelId }
  | { kind: "ui.style"; style: ReplyStyle }
  | { kind: "ui.toggle"; feature: FeatureId; on: boolean }
  | { kind: "chat.rename"; title: string }
  | { kind: "chat.pin" }
  | { kind: "docs.write"; title: string; content: string }
  | { kind: "docs.archive"; title?: string }
  | {
      kind: "learn.addCard";
      word: string;
      meaning: string;
      phonetic?: string;
      pos?: string;
      example?: string;
      exampleZh?: string;
    }
  | { kind: "reminder.add"; text: string; time?: string }
  | { kind: "memory.add"; note: string }
  | { kind: "persona.set"; name?: string; persona?: string }
  | { kind: "play.gobang" }
  | { kind: "play.truth" }
  | { kind: "play.recordResult"; result: "win" | "loss" | "draw" }
  | { kind: "learn.openReading"; index?: number }
  | { kind: "learn.speak"; text: string }
  | { kind: "learn.removeCard"; word: string }
  | { kind: "media.speak"; text: string }
  | { kind: "ambience.play"; index?: number }
  | { kind: "media.import"; url: string; name?: string }
  | { kind: "chat.delete" }
  | { kind: "docs.delete"; title: string }
  | { kind: "diary.deleteLast" }
  | { kind: "media.clear" }
  | { kind: "data.reset" }
  | { kind: "settings.setUpstream"; baseUrl?: string; apiKey?: string }
  | { kind: "workspace.note"; title: string; detail?: string; files?: string[] }
  | { kind: "moment.post"; mood: MoodId; text: string }
  | { kind: "letter.write"; title: string; body: string }
  | { kind: "date.add"; title: string; at: string; yearly?: boolean; note?: string }
  | { kind: "todo.add"; text: string }
  | { kind: "diary.add"; body: string }
  | { kind: "chat.new" };

/** 一条「用户在干什么」的记录。 */
export type ActivityEntry = {
  id: string;
  label: string;
  detail: string;
  path: string;
  at: number;
};

/** 等待用户批准的动议。 */
export type PendingAction = {
  id: string;
  action: AppAction;
  title: string;
  permission: PermissionId;
  from: string;
  at: number;
};

/** 动作执行留痕。 */
export type ActionLogEntry = {
  id: string;
  title: string;
  permission: PermissionId;
  result: "allowed" | "denied" | "auto";
  message: string;
  at: number;
};