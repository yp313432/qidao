/**
 * P3 的**召回句集** —— "用户会这么说"的样本，用来验"按需注册没漏发动作"。
 *
 * 为什么要有这份文件（它比脚本本身重要）：
 *   P3 的失败方式**不是报错**，而是"他说我做不到" —— 用户会以为功能坏了。
 *   所以判断规则好坏不能靠拍脑袋，得拿真句子逐条对账：
 *     `mustInclude` 里列的 kind，必须出现在这一轮发出去的 tools 里。
 *
 * ⚠️ 加样本的纪律：**先加句子、再看规则哪里漏了**，别反过来照着规则写句子
 * （那样只会证明"规则认得自己写过的词"）。
 *
 * 结构：
 *   { text: 用户这句话,
 *     mustInclude: [必须被选中的 kind…],
 *     label: 这条在验什么 }
 */

/** 常驻的七个（不靠关键词，任何一轮都该有）—— 单独一条样本守住
    ⚠️ 顺序必须跟 `src/lib/tool-select.ts` 的 `ALWAYS_KINDS` 完全一致（有断言盯着）
    · `emotion.report` 是用户要求常驻的："常驻吧，我不能一直提醒他记情绪"
    · `sense.time` / `sense.device` / `sense.place`（2026-10）：主动感知里**便宜那三个**，
      零权限、一次调用就一句话 —— 用户要的正是"他主动去看一眼现在的状态"，
      而"看一眼"多半匹配不到关键词（"你那边下雨了吗"），漏一轮他就会说"我看不到"。
      （另外三个 `sense.notifications` / `sense.foreground` / `sense.screen` 要系统权限，
        **按需注册**，不在这里。）
    · 旧的 `state.report`（11 维花瓣）2026-10 已整条退场，不在这里了 */
export const ALWAYS_ON = [
  "navigate",
  "memory.add",
  "ui.highlight",
  "emotion.report",
  "sense.time",
  "sense.device",
  "sense.place",
  // 发一张表情包（2026-11）：临场能力，靠关键词匹配不到 —— 顺序必须跟
  // `tool-select.ts` 的 ALWAYS_KINDS 一致（verify-tool-recall 盯着）
  "sticker.send",
];

/** 用户还可能这样问 —— 一个字都不提"工具"，但必须给到对应动作 */
export const RECALL_CASES = [
  // ── 媒体 ──────────────────────────────────────────────
  { text: "放个歌听", mustInclude: ["media.playTrack", "media.play"], label: "放歌（口语）" },
  { text: "换一首", mustInclude: ["media.next", "media.prev"], label: "切歌（没有'歌'字）" },
  { text: "声音小一点", mustInclude: ["media.volume"], label: "调音量（没有'音量'二字）" },
  { text: "把周杰伦那首加进来", mustInclude: ["media.import"], label: "导入音乐" },
  { text: "念给我听", mustInclude: ["media.speak"], label: "朗读" },
  { text: "来点雨声", mustInclude: ["ambience.play"], label: "氛围音" },

  // ── 记录 / 日记 / 动态 / 信 ───────────────────────────
  { text: "帮我写今天的日记", mustInclude: ["diary.add"], label: "写日记" },
  { text: "我想发条动态，说今天很开心", mustInclude: ["moment.post"], label: "发动态" },
  { text: "给我写封信吧", mustInclude: ["letter.write"], label: "写信" },
  { text: "记一下我妈生日是 3 月 21", mustInclude: ["date.add"], label: "记日子" },
  { text: "帮我加个待办：买牛奶", mustInclude: ["todo.add"], label: "加待办" },
  { text: "把买牛奶那条待办勾掉", mustInclude: ["todo.done"], label: "勾掉待办" },

  // ── 提醒 / 闹钟 / 定时 ────────────────────────────────
  { text: "七点半叫我起床", mustInclude: ["reminder.add"], label: "闹钟（没有'闹钟'二字）" },
  { text: "明天十点提醒我开会", mustInclude: ["reminder.add"], label: "提醒" },
  { text: "把吃药那个闹钟改到八点", mustInclude: ["reminder.update"], label: "改闹钟" },
  { text: "每天早上跟我说句早安", mustInclude: ["cron.add"], label: "定时任务（没有'任务'二字）" },

  // ── 记忆 ─────────────────────────────────────────────
  { text: "记住我喜欢喝美式", mustInclude: ["memory.add"], label: "记住" },
  { text: "我之前说过什么关于咖啡的？", mustInclude: ["memory.update", "memory.remove"], label: "改/删记忆（提到'之前说过'）" },

  // ── 界面 ─────────────────────────────────────────────
  { text: "把主题换成深色的", mustInclude: ["appearance.theme"], label: "换主题" },
  { text: "字太小了看不清", mustInclude: ["appearance.font"], label: "字体（没有'字体'二字）" },
  { text: "把这段标出来", mustInclude: ["ui.highlight"], label: "高亮" },
  { text: "打开歌词面板", mustInclude: ["ui.panel"], label: "面板" },
  { text: "换个模型试试", mustInclude: ["ui.model"], label: "换模型" },
  { text: "说话简短点", mustInclude: ["ui.style"], label: "风格" },

  // ── 聊天管理 ─────────────────────────────────────────
  { text: "开个新对话", mustInclude: ["chat.new"], label: "新建对话" },
  { text: "把这段存成文档", mustInclude: ["docs.write", "docs.archive"], label: "存文档" },
  { text: "这个对话改名叫'工作'", mustInclude: ["chat.rename"], label: "改名" },

  // ── 学习 ─────────────────────────────────────────────
  { text: "这个词加进生词本：abandon", mustInclude: ["learn.addCard"], label: "加词卡" },
  { text: "读一下这段英文", mustInclude: ["learn.speak", "learn.openReading"], label: "读英文" },

  // ── 玩 ───────────────────────────────────────────────
  { text: "陪我下一局五子棋", mustInclude: ["play.gobang"], label: "五子棋" },
  { text: "抽个真心话", mustInclude: ["play.truth"], label: "真心话" },
  { text: "刚才那局我赢了，记一笔", mustInclude: ["play.recordResult"], label: "记战绩" },

  // ── 自我（情绪）───────────────────────────────────────
  { text: "你现在心情怎么样", mustInclude: ["emotion.report"], label: "问心情（常驻，但这句要命）" },
  { text: "今天好累啊", mustInclude: ["emotion.report", "diary.add"], label: "倾诉（要能记情绪）" },

  // ── 外部工具 ─────────────────────────────────────────
  { text: "帮我查一下杭州天气", mustInclude: ["http.call"], label: "调 HTTP 工具" },
  { text: "用 mcp 那个工具记一下", mustInclude: ["tool.call"], label: "调 MCP 工具" },
  /*
    联网那两个（2026-10 新增）—— **必须真的给到 `web.search` / `web.fetch`**：
    用户要联网时的原话是"帮我搜一下…"，他一辈子不会说"网页搜索"这个词。
    漏了这一组的代价还是那句"我做不到"（而手机版现在明明能做）。
  */
  { text: "帮我搜一下下周末的天气", mustInclude: ["web.search"], label: "联网：搜（口语'搜一下'）" },
  { text: "网上查查最近有什么新手机", mustInclude: ["web.search"], label: "联网：搜（'网上查查'）" },
  {
    text: "读一下这个网页 https://example.com/a",
    mustInclude: ["web.fetch"],
    label: "联网：读正文（他直接给了网址）",
  },

  // ── 主动感知（那三个要系统权限的，靠关键词按需发）────────
  { text: "我刚收到什么通知吗", mustInclude: ["sense.notifications"], label: "感知：看最近的通知" },
  { text: "我现在前台开着哪个应用", mustInclude: ["sense.foreground"], label: "感知：看前台 App" },
  { text: "屏幕还亮着吗", mustInclude: ["sense.screen"], label: "感知：看屏幕状态" },

  // ── 跨轮上下文：这一句单独看没有任何关键词 ──────────────
  {
    text: "好",
    recent: ["帮我写今天的日记"],
    mustInclude: ["diary.add"],
    label: "跨轮：上一句说要写日记，这句只说'好'",
  },
  {
    text: "嗯，就这样",
    recent: ["放个歌听"],
    mustInclude: ["media.playTrack"],
    label: "跨轮：上一句说要放歌",
  },
] as const;

/**
 * **明确不能**误伤的反例：这些话一个动作都不该触发，但也不能把常驻的丢了。
 * （防的是"规则写得太贪心 → 每轮都命中一堆组 → 等于没省"）
 */
export const NO_SIDE_EFFECT_CASES = [
  { text: "今天天气真好", mustKeep: ["emotion.report"], label: "纯闲聊" },
  { text: "谢谢你", mustKeep: ["emotion.report"], label: "道谢" },
  { text: "嗯嗯", mustKeep: ["emotion.report"], label: "敷衍一句" },
] as const;

/**
 * 省 token 的**下限要求**：常见对话至少要把 70 个砍到多少以下。
 * 60% 是个保守值（实测常见句子落到 20~35 个动作）；砍不动就说明规则没生效。
 */
export const MAX_TOOLS_RATIO = 0.6;
