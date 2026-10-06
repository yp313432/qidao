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
  /** 这条是**定时任务**让他主动说的，不是用户问的（聊天里会带一个小标记） */
  scheduled?: boolean;
};

/**
 * 世界书条目（也叫"思考引导"）。
 *
 * 用户的原话："把思考链做一个注入信息，像世界书一样，引导修改他的思考方式"。
 * 于是每条 = 关键词 + 内容 + 注入位置：
 *   · position "system"（或关键词留空）→ **每轮都进系统提示词**，
 *     适合放"别想太久""先给结论""不确定就说不确定"这类**行为准则**
 *   · position "tail"（关键词非空）→ 只有聊到关键词才注入，
 *     而且挂在**最后一条用户消息的尾部**（系统提示词不动 → 前缀缓存不受影响）
 * 默认都关着，用户自己开 —— 不然就是悄悄改他的性格。
 */
export type WorldEntry = {
  id: string;
  /** 给用户看的名字（可空，列表里会拿内容开头当标题） */
  title?: string;
  /** 触发关键词；留空 = 常驻 */
  keywords: string[];
  content: string;
  position: "system" | "tail";
  enabled: boolean;
  createdAt: number;
};

/**
 * 他的"内在状态"采样。
 *
 * 用户选择的做法（方案 A）：**让他每轮回复时自己报一次** ——
 * 所以「内在」页那条波浪线是他真实的起伏，不是我拿数据拼出来的假曲线。
 * 只存本机。
 */
export type StateSample = {
  id: string;
  at: number;
  /** 此刻的心情 */
  mood: MoodId;
  /** 精力 0~1 */
  energy: number;
  /** 想念（有多想跟你说话）0~1 */
  missing: number;
  /** 好奇 0~1 */
  curious: number;
  /** 为什么是这个状态（他写的一句话，可选） */
  note?: string;
};

/**
 * 定时任务：到点让他自己醒过来说一句 / 做一件事。
 *
 * 说清能做到哪一层（安卓的限制）：
 *   · App 活着（或刚打开）→ 真的到点生成一句话，发进对话 ✅
 *   · App 完全关闭 → 由**原生通知**准时响，点开时把那句话补上 ✅
 *     （WebView 里的 JS 被系统停掉后，没人能替它调模型 —— 这是安卓的规矩）
 */
export type ScheduledTask = {
  id: string;
  /** 让他做什么：自由描述，例如「跟我说句早安，顺便提一下今天该干的事」 */
  prompt: string;
  /** 每天几点（HH:MM）。空表示"一次性"，用 at 字段 */
  time?: string;
  /** 一次性任务的时间戳 */
  at?: number;
  enabled: boolean;
  /** 要不要同时推一条系统通知 */
  notify: boolean;
  /** 每天最多跑几次这种护栏由守护进程统一管；这里记最后一次跑的时间 */
  lastRunAt?: number;
  /** 今天已经跑过的日期（YYYY-M-D），避免同一天重复触发 */
  lastRunDay?: string;
  createdAt: number;
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

/**
 * 小宇宙里行星/星环的颜色。
 *
 * 跟**文字色**是两回事 —— 用户："球体颜色和字体颜色做个切割吧，
 * 她两分开，不放一起，不然不好同时兼顾"。
 *
 *   auto   跟随文字色（默认）—— 换深色背景时不会出现"背景黑了、行星还黄"
 *   mist   冷薄荷青（跟视觉 Skill 的"冷薄荷青为主"一致）
 *   violet 雾紫（Skill 里的辅色）
 *   gold   暖金（Skill 里的点缀色）
 *   custom 自定义，用 planetColor
 */
export type PlanetTone = "auto" | "mist" | "violet" | "gold" | "custom";

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
  /**
   * 小宇宙里行星/星环的颜色（跟文字色独立，见 PlanetTone 的说明）
   */
  planetTone: PlanetTone;
  planetColor: string;
  /**
   * 「认识的日子」—— 玩乐区首页那个 `NNN DAYS TOGETHER` 用它算天数。
   *
   * 用户自己填（"用户自己填日子"）。格式 YYYY-MM-DD，空表示没填 ——
   * 那时卡片会显示一句"去我的空间填个日子"，而不是编一个数字出来。
   */
  togetherSince: string;
  showThinking: boolean;
  saveThinking: boolean;
  notifications: boolean;
  /**
   * 定位。默认**关**。
   *
   * 开了之后，地名会进"此刻的情况"给模型看 —— 也就是说会发给你接的那家 AI。
   * 这是隐私相关的事，所以默认关、设置里随时能关，开启时界面会明确说明。
   */
  geoEnabled: boolean;
  /** 最近一次拿到的地名（如「北京市朝阳区」） */
  geoLabel?: string;
  /** 什么时候拿到的 */
  geoAt?: number;
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
  /**
   * 和风天气的 API Key（只存这台设备）。
   *
   * 为什么换成和风：原来「知道你在哪」用 OpenStreetMap 反查地名，
   * 那个服务**国内经常连不上**（用户实测："定位订不了"）——
   * 坐标拿得到，卡在"坐标 → 地名"这一步。
   * 和风是国内服务、免费额度每月 5 万次，而且它的 GeoAPI 顺便把
   * 反查地名也解决了，一次配好两件事都能用。
   */
  qweatherKey: string;
  /**
   * 和风的**专属 API Host**（形如 `xxxxx.re.qweatherapi.com`）。
   *
   * 必须让用户填：和风早就不是统一的 `devapi.qweather.com` 了，
   * 每个账号一个专属域名，填错就直接调不通。
   */
  qweatherHost: string;
  /** 缓存的天气一句话（"晴 22°C"）—— 进"此刻的情况"，首页也用它 */
  weatherText: string;
  /** 上面那条天气的时间戳；超时就不提了，免得说"现在晴"其实是昨天 */
  weatherAt: number;
  /** 手动指定的地点（不想用自动定位时填它，例如"北京市朝阳区"） */
  manualPlace: string;
  /**
   * 当前地点的**和风编号**（例如北京 101010100）。
   *
   * 查天气要用它 —— 比用文字名再搜一次省一次请求，
   * 而且自动定位那条路本来就能从 GeoAPI 顺手拿到。
   */
  geoPlaceId: string;
  /** 音乐播放页自己的背景图（没设就用主页背景） */
  musicImage: string;
  /** 日记动态页自己的背景图（没设就用主页背景） */
  diaryImage: string;
  /**
   * 动画：auto = 跟随系统的「减弱动态效果」；on = 始终开启；off = 关闭。
   * 系统开了「减弱动态效果」时，浏览器会把所有动画压成 0.01ms —— 那就是"看不到动态"。
   */
  motion: "auto" | "on" | "off";
  /**
   * 对话正文字号。
   *
   * 用户反馈："铺满屏幕看着局促，字大一点更大气" —— 所以给四档，
   * 默认「标准」，想要舒展就调大（顺便留白也更好看）。
   */
  chatFontSize: "small" | "normal" | "large" | "xlarge";
  /**
   * 最大输出长度（token）。0 = 跟随所选档位的默认值。
   *
   * 用户报过两次"思考链太长被掐断、只剩空回复"。
   * 有些网关把思考也算进这个额度，所以调大能缓解；
   * 但调太大某些模型会直接报错，所以做成可调、默认跟随档位。
   */
  maxTokens: number;
  voiceReplies: boolean;
  /** 朗读语速（0.5~2，1 = 正常） */
  voiceRate: number;
  /** 朗读音调（0.5~1.8，1 = 原声；调低更沉稳，调高更年轻） */
  voicePitch: number;
  /** 指定的音色（浏览器里 voiceURI；留空 = 自动挑一个） */
  voiceURI?: string;
  /**
   * 独立的**语音服务**（语音转文字 + 文字转语音）。
   *
   * 为什么需要它：安卓 WebView 没有语音识别；而荣耀手机的系统识别就是 YOYO ——
   * 它会自己接话、不把文字还回来，等于堵死。所以改走"自己录音 → 上传转文字"。
   * 一家（比如硅基流动）同时提供 ASR 和 TTS，所以共用一个地址 + key。
   */
  voiceBaseUrl?: string;
  voiceApiKey?: string;
  /** 转文字的模型名，如 FunAudioLLM/SenseVoiceSmall */
  voiceAsrModel?: string;
  /** 合成的模型名，如 FunAudioLLM/CosyVoice2-0.5B */
  voiceTtsModel?: string;
  /** 合成用的音色名（CosyVoice2 的叫 alex / bella 这种） */
  voiceTtsVoice?: string;
  replyStyle: ReplyStyle;
  defaultModel: ModelId;
  customBaseUrl: string;
  customApiKey: string;
  /** 自定义上游的真实模型名（例如 deepseek-v4-pro）；留空则用服务端配的 QIDAO_UPSTREAM_MODEL */
  upstreamModel: string;
  /**
   * 上游可用的模型名列表（从 /models 拉来的）。
   * 对话框那个模型选择器显示的就是它 —— **真实可用的名字**，不是摆设的档位。
   */
  upstreamModels: string[];
  background: BackgroundSettings;
  /** AI 的各项权限：询问 / 允许 / 拒绝（清单见 lib/permissions.ts） */
  permissions: Record<string, PermissionMode>;
};

/* ------------------------------- 记忆库 ------------------------------- */

/**
 * 记忆的类别。照着用户自己的说法定的（他给的样本正好覆盖五类）：
 *   「我叫 yan」          → profile
 *   「你叫小克」          → relationship
 *   「生日 3.21」         → timeline
 *   「INFP 带点 J」       → profile
 *   「喜欢躺平、精力低」   → preference
 *   「最近要忙论文」       → project
 */
export type MemoryKind = "profile" | "preference" | "project" | "relationship" | "timeline";

/**
 * 一条记忆。
 *
 * 这不是"对话片段"——是一句提炼出来的事实。设计目标不是存得多，
 * 而是**像人脑那样**：常提到的越来越牢，无关的慢慢淡出，相关的自动连在一起。
 */
export type Memory = {
  id: string;
  kind: MemoryKind;
  /** 一句话事实，例如「喜欢躺平，精力比较低」 */
  content: string;
  /** 从哪来的：对话 / 手动 / 导入 */
  source?: string;
  /** 置信度 0~1：推断出来的不该当成确定事实 */
  confidence: number;
  /** 记忆强度 —— 被反复确认/唤起会变高，越大越难淡忘 */
  strength: number;
  status: "active" | "archived";
  /** 情绪色彩（来自日记心情或对话语气），用于"心情一致时更容易想起" */
  mood?: MoodId;
  /** timeline 类专用：YYYY-MM-DD，用来做"每年自动浮现" */
  at?: string;
  tags: string[];
  /** 关联的记忆 id —— 这就是"神经元之间的连线" */
  links: string[];
  /** 被唤起的次数（反复提到就加深） */
  recallCount: number;
  createdAt: number;
  updatedAt: number;
  /** 最后一次被确认是"现在仍然成立" */
  lastConfirmedAt?: number;
  /** 最后一次被唤起（塞进提示词）的时间 */
  lastRecalledAt?: number;
};

/**
 * MCP 传输方式。
 *
 * ⚠️ 界面现在**只提供 `http`**（Streamable HTTP）。
 * `sse` 和 `stdio` 是历史值，只为不破坏已存的老记录而留着：
 *   · `stdio` 要起本地进程，网页 / 手机 App 里实现不了
 *   · `sse`（老的 HTTP+SSE）已经去掉 —— 在本机没法实测，
 *     留着一个没验证过的传输方式就是误导
 * 用户原话："假的和实现不了的就不留了，别误导"。
 */
export type McpTransport = "http" | "sse" | "stdio";

/**
 * MCP 的 OAuth 授权结果。
 *
 * ⚠️ 令牌就存在这里，而 `mcp` 是**整体持久化**的（store.ts 的 partialize），
 * 所以令牌会落进 IndexedDB。个人自用可以接受，但这**不是**安全存储 ——
 * 没有用系统钥匙串。将来要收紧，就把令牌单独挪出去。
 */
export type McpOAuth = {
  /** 动态注册拿到的客户端 id（按规范，公开客户端不需要密钥） */
  clientId: string;
  accessToken?: string;
  refreshToken?: string;
  /** 过期时间戳（ms）。没有值 = 对方没说，就先用着 */
  expiresAt?: number;
  /** 授权服务器的 issuer（排查问题时看） */
  issuer?: string;
  /** 换令牌的地址 —— 续期要用它，存下来省得每次重新发现 */
  tokenEndpoint?: string;
  /** 授权时带的 resource 参数（规范要求 MUST 带，见 RFC 8707） */
  resource?: string;
  /** 授权完成时间，只在界面上展示 */
  at?: number;
};

/**
 * 一个 MCP 工具的定义（`tools/list` 的原样结果里我们关心的部分）。
 *
 * 为什么要留 `inputSchema`：光有名字，模型**没法知道该传什么参数** ——
 * 提示词里必须把参数结构告诉它，它才可能一次调对。
 */
export type McpTool = {
  name: string;
  description?: string;
  /** JSON Schema（服务端给的原始结构，按需压缩后再进提示词） */
  inputSchema?: unknown;
};

/**
 * 一条真实的 MCP 服务器配置（用户自己填）。
 *
 * 配置能真实保存，也能真实握手（initialize → initialized → tools/list）；
 * 对方要认证时还能走 OAuth（发现 → 动态注册 → PKCE → 浏览器授权 → 换令牌）；
 * **模型也能真的调用**它的工具（`tool.call` 动作 → `tools/call`）。
 */
export type McpServer = {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  /** http 用（sse 是历史值） */
  url: string;
  /** stdio 历史字段，界面已不再填写 */
  command: string;
  args: string;
  /** 每行一个 "Key: Value" */
  headersText: string;
  enabled: boolean;
  /** 握手成功后回填的工具定义（`tools/list` 的真实结果） */
  tools: McpTool[];
  /** OAuth 授权结果（对方要令牌时才有） */
  oauth?: McpOAuth;
  /** 最近一次握手结果，仅用于界面展示 */
  status?: {
    ok: boolean;
    at: number;
    message: string;
    /** 对方要求认证、而且它是标准 OAuth → 界面给一个「去授权」的入口 */
    needsAuth?: boolean;
  };
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
  /**
   * 播外链音乐（用户自己加过的那些）。
   *
   * 外链是别人网站 iframe 里的播放器，**同源限制下我们控制不了它内部**
   * （不能暂停/切歌/调音量）—— 能做的只是"挑一条开始播"。
   */
  | { kind: "media.playEmbed"; query?: string }
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
  | { kind: "reminder.add"; text: string; time?: string; ring?: boolean; date?: string }
  /** 定时任务：到点让他自己开口（App 活着时真的会说话；关掉时靠通知兜底） */
  | { kind: "cron.add"; prompt: string; time?: string; at?: string; notify?: boolean }
  /** 他自己报一笔状态（L0，静默执行；用来画「内在」那条波浪线） */
  | {
      kind: "state.report";
      mood: MoodId;
      energy: number;
      missing: number;
      curious: number;
      note?: string;
    }
  | { kind: "memory.add"; note: string; tags?: string[] }
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
  | { kind: "moment.post"; mood: MoodId; text: string }
  | { kind: "letter.write"; title: string; body: string }
  | { kind: "date.add"; title: string; at: string; yearly?: boolean; note?: string }
  | { kind: "todo.add"; text: string }
  | { kind: "diary.add"; body: string }
  | { kind: "chat.new" }
  /**
   * ——— 改与删 ———
   *
   * 用户的原话："他没有删除修改权限，你找找其他的功能权限，
   * 写入和删除、更新和删除都同时要有，不然只能记，改不了。"
   *
   * 所以每条都能改、能删。query 是**内容片段**（模型不知道 id），
   * 匹配不到时应该如实告诉他"没找到那条"，而不是装作改了。
   */
  | { kind: "memory.update"; query: string; note?: string; tags?: string[] }
  | { kind: "memory.remove"; query: string }
  | { kind: "reminder.update"; query: string; text?: string; time?: string; ring?: boolean }
  | { kind: "reminder.remove"; query: string }
  | { kind: "reminder.done"; query: string }
  | { kind: "todo.done"; query: string }
  | { kind: "todo.remove"; query: string }
  | { kind: "date.remove"; query: string }
  | { kind: "moment.remove"; query?: string }
  | { kind: "letter.remove"; query?: string }
  /**
   * **调用一个外部 MCP 工具**（这是让 MCP "真能用"的那一环）。
   *
   * 模型不知道内部 id，也用不着知道 —— 按**名字**指定就行：
   * `server` 是服务器名、`tool` 是工具名（都来自提示词里的清单），
   * `args` 是那个工具的参数对象（结构见提示词里给它的参数说明）。
   *
   * 权限落在 `mcp_tools`（L2）：默认要用户点一下确认。
   */
  | { kind: "tool.call"; server: string; tool: string; args?: Record<string, unknown> }
  /**
   * **调用一个自己配的 HTTP 工具**（「工具 → HTTP」里那些）。
   *
   * 为什么跟 MCP 分成两种动作、而不是一个动作里分叉：
   *   · 权限不一样 —— MCP 落 `mcp_tools`、HTTP 落 `http_tools`，
   *     用户可以在权限页里分别放行/拒绝（闸门弹的卡片也才对得上）
   *   · 两者"参数"的含义也不一样：MCP 的参数结构是服务端给的；
   *     HTTP 的参数是**从用户配好的请求里推出来的**（见 lib/http-tools.ts）
   *
   * `args` 可以整个不传 = 「按他配好的原样发一次」，跟手动点「调用」等价。
   */
  | { kind: "http.call"; tool: string; args?: Record<string, unknown> };

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