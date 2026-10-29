/**
 * 「他动了什么手」—— 一句朴实的话。
 *
 * 用户 m12472 原话：
 *   "以后这个动手不要吧动作参数都写上，就简单一句话，ai名字加结果，
 *    例如 memoryadd 小克新加了一条记忆，就这样朴实无华，
 *    前面一个动作后面描述加结果，所有的都改"
 *
 * 所以这里不再显示上游的原始工具名、也不显示 JSON —— 只有
 * `谁 + 一句完成态的话`，需要的时候再补一行「细节」（内容是正文摘出来的，
 * 比如记忆里记住了什么、走到了哪个地点）。
 *
 * 和 `action-meta.ts` 的 `actionTitle()` 的分工：
 *   · `actionTitle` 是**审批弹窗/日志**用的（"切换到页面 /play/learn"），要精确、要带参数；
 *   · 这里是**气泡下方的事后回看**用的，要像人说的话，参数只做"细节"那一行。
 */
import type { AppAction, ToolCallRecord } from "@/lib/types";

type AnyAction = Record<string, unknown>;

const str = (v: unknown, max = 24): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** 页面路径 → 人话（找不到就照原样，别硬编） */
const PAGES: Record<string, string> = {
  "/": "对话",
  "/play": "玩乐",
  "/play/garden": "花园",
  "/play/garden/fiori": "花圃",
  "/play/garden/stagno": "池塘",
  "/play/garden/tavolo": "棋桌",
  "/play/garden/tarot": "塔罗",
  "/play/garden/vestigia": "踪迹",
  "/play/learn": "学习",
  "/play/todo": "计划",
  "/play/diary": "日记",
  "/play/space": "我的空间",
  "/me": "我的",
  "/system": "系统",
  "/usage": "模型与用量",
  "/space": "我的空间",
  "/tools": "工具",
  "/capture": "记录",
};

const pageName = (path: unknown): string => {
  const p = str(path, 60);
  if (!p) return "一个页面";
  if (PAGES[p]) return PAGES[p];
  const hit = Object.keys(PAGES).find((k) => k !== "/" && p.startsWith(k));
  return hit ? PAGES[hit] : p;
};

/**
 * 每个动作的**完成态短语**（不含主语，主语由调用方拼）。
 * 覆盖率要求：95 个 kind 一个都不能落到兜底 —— 兜底只留给"模型瞎编的名字"。
 */
const PHRASE: Record<string, (a: AnyAction) => string> = {
  /* ── 界面 ── */
  navigate: (a) => `切到了「${pageName(a.path)}」`,
  "ui.highlight": (a) => `在页面上标出了「${str(a.text, 14)}」`,
  "ui.scroll": (a) => `滚到了「${str(a.text, 14)}」`,
  "ui.panel": (a) => (a.panel === "lyrics" ? "打开了歌词面板" : "打开了对话列表"),
  "ui.model": (a) => `把模型换成了「${str(a.model, 20)}」`,
  "ui.style": (a) => `把回复风格改成了「${str(a.style, 10)}」`,
  "ui.toggle": (a) => `${a.on ? "打开" : "关掉"}了「${str(a.feature, 12)}」`,
  "chat.rename": () => "给这个对话改了个名字",
  "chat.pin": () => "把这个对话置顶了",
  "chat.new": () => "开了个新对话",
  "chat.delete": () => "删掉了一个对话",

  /* ── 外观 ── */
  "appearance.theme": () => "换了个主题",
  "appearance.font": (a) => `把正文换成了「${str(a.font, 12)}」`,
  "appearance.textColor": () => "调了文字颜色",

  /* ── 音乐 / 环境音 ── */
  "media.play": () => "把音乐放起来了",
  "media.pause": () => "把音乐按了暂停",
  "media.next": () => "切到了下一首",
  "media.prev": () => "切回了上一首",
  "media.volume": (a) => `把音量调到了 ${Math.round(num(a.value, 0.5) * 100)}%`,
  "media.seek": (a) => {
    const s = Math.max(0, Math.floor(num(a.seconds)));
    return `把进度拖到了 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  },
  "media.playTrack": (a) => `放起了「${str(a.query, 18)}」`,
  "media.playEmbed": (a) => (str(a.query) ? `放起了外链里的「${str(a.query, 16)}」` : "放起了外链音乐"),
  "media.import": () => "往曲库里导了几首",
  "media.clear": () => "清空了播放列表",
  "media.speak": (a) => (a.asBubble ? "发了条语音给你" : "开口念了一段"),
  "ambience.play": () => "放了点环境音",

  /* ── 文档 / 学习 / 计划 ── */
  "docs.write": (a) => `新建了文档「${str(a.title, 14)}」`,
  "docs.archive": () => "把这段对话存成了文档",
  "docs.delete": () => "删掉了一个文档",
  "learn.addCard": (a) => `把「${str(a.word, 16)}」收进了生词本`,
  "learn.removeCard": (a) => `从生词本里移掉了「${str(a.word, 16)}」`,
  "learn.openReading": () => "开了篇阅读",
  "learn.speak": () => "念了一段给你听",
  "reminder.add": (a) => `设了个提醒${a.time ? `（${str(a.time, 10)}）` : ""}`,
  "reminder.update": () => "改了个提醒",
  "reminder.remove": () => "删了个提醒",
  "reminder.done": () => "把一个提醒划掉了",
  "cron.add": (a) => `设了个定时任务${a.time ? `（每天 ${str(a.time, 10)}）` : ""}`,
  "cron.update": () => "改了个定时任务",
  "cron.remove": () => "删了个定时任务",
  "todo.add": (a) => `加了件事要办：${str(a.text, 16)}`,
  "todo.done": () => "把一件事划掉了",
  "todo.remove": () => "删掉了一件事",
  "date.add": (a) => `记了一个日子${a.date ? `（${str(a.date, 12)}）` : ""}`,
  "date.remove": () => "删掉了一个日子",

  /* ── 记忆 / 情绪 / 设定 ── */
  "memory.add": () => "新加了一条记忆",
  "memory.update": () => "改了一条记忆",
  "memory.remove": () => "删了一条记忆",
  "emotion.report": (a) => `记下了一笔情绪：${str(a.primaryEmotion, 10)}`,
  "persona.set": (a) => (str(a.name) ? `把名字改成了「${str(a.name, 12)}」` : "调整了自己的设定"),
  "settings.setUpstream": () => "换了一次上游设置",
  "data.reset": () => "清空过一次数据",
  "view.list": (a) => `列了一下${str(a.what, 10)}`,
  "sticker.send": () => "发了张表情包",
  "sticker.groups": () => "翻了翻表情分组",

  /* ── 朋友圈 / 日记 / 信 ── */
  "moment.post": () => "发了一条动态",
  "moment.comment": () => "在一条动态下面说了句话",
  "moment.like": () => "点了个赞",
  "moment.read": () => "翻了翻动态",
  "moment.remove": () => "删了一条动态",
  "diary.add": () => "写了一篇日记",
  "diary.update": () => "改了一篇日记",
  "diary.read": () => "翻了翻日记",
  "diary.remove": () => "删了一篇日记",
  "diary.deleteLast": () => "撤掉了最后一篇日记",
  "letter.write": () => "写了一封信",
  "letter.update": () => "改了一封信",
  "letter.read": () => "看了看信",
  "letter.remove": () => "删了一封信",

  /* ── 花园 ── */
  "garden.walk": (a) => `走到了「${str(a.place ?? a.where, 10) || "花园里"}」`,
  "garden.cesta.look": () => "翻了翻竹篮",
  "garden.fish.cast": (a) => `在${str(a.spot, 8) || "池塘边"}抛了竿`,
  "garden.fish.reel": () => "把竿收了",
  "garden.tarot.draw": () => "摆了一组塔罗",
  "garden.gomoku.play": () => "在棋盘上落了一子",
  "garden.gomoku.pass": () => "让了一手",
  "garden.gomoku.new": () => "新开了一局棋",
  "garden.flower.plant": (a) => `在花圃里种下了「${str(a.species, 10) || "一朵花"}」`,
  "garden.flower.water": () => "给花浇了水",
  "garden.flower.feed": () => "给花施了肥",
  "garden.flower.pick": () => "剪下了一枝花",
  "garden.flower.gift": () => "塞给你一枝花",
  "play.truth": () => "抽了个真心话",
  "play.recordResult": () => "记了一笔战绩",

  /* ── 联网 / 感知 / 工具 ── */
  "web.search": (a) => `上网查了「${str(a.query, 16)}」`,
  "web.fetch": () => "打开了一个网页读",
  "tool.call": (a) => `调了一下插件工具「${str(a.tool ?? a.name, 14)}」`,
  "http.call": (a) => `调了一次自己配的接口「${str(a.tool, 14)}」`,
  "sense.time": () => "看了眼时间",
  "sense.device": () => "看了眼设备状态",
  "sense.place": () => "看了眼自己在哪里",
  "sense.notifications": () => "看了眼手机上的通知",
  "sense.foreground": () => "看了眼前台开着什么",
  "sense.usage": () => "看了眼手机用时",
  "sense.screen": () => "看了眼屏幕",
};

/** 细节那一行从哪取（内容类字段，优先级从高到低） */
const DETAIL_KEYS = ["note", "text", "body", "content", "title", "place", "query", "word", "species", "spot"];

export type CallSentence = {
  /** 「小克 新加了一条记忆」—— 主语已经有了 */
  line: string;
  /** 第二行：具体内容（没有就不显示） */
  detail?: string;
  /** 失败时给原因（有才给） */
  why?: string;
  /** 认不出的工具名（模型瞎编时用来排查） */
  raw?: string;
};

/**
 * 把一次工具调用说成一句人话。
 *
 * @param call  存档里那条调用记录
 * @param who   他的称呼（`resolveAiName` 给的名字）
 */
export function callSentence(
  call: Pick<ToolCallRecord, "name" | "kind" | "args" | "ok" | "result" | "category">,
  who: string,
): CallSentence {
  const name = who || "他";
  /** 名字压根不是我们的动作 —— 只在这种时候才把原始名字露出来（排查用） */
  if (!call.kind) {
    return {
      line: `${name} 想叫一个不存在的动作`,
      raw: call.name,
      why: call.result ? str(call.result, 40) : undefined,
    };
  }

  let parsed: AnyAction = {};
  try {
    const raw = call.args ? JSON.parse(call.args) : {};
    parsed = (raw && typeof raw === "object" ? raw : {}) as AnyAction;
  } catch {
    parsed = {};
  }

  const build = PHRASE[call.kind];
  const phrase = build ? build(parsed) : `做了件「${call.kind}」的事`;

  if (!call.ok) {
    /**
     * 失败就说"没成"，别写成"想设了个提醒"那种半截话（中文里完成态套在"想"后面很别扭）。
     */
    return {
      line: `${name} ${phrase} · 没成`,
      why: call.result ? str(call.result, 40) : undefined,
    };
  }

  /**
   * 细节只补"句子里没说到的内容"：`走到了「池塘」` 后面再挂一行「池塘」就是重复。
   * 长度也压到 24 字 —— 用户要的是"朴实无华一句话"，不是第二段正文。
   */
  const detailKey = DETAIL_KEYS.find((k) => {
    const v = str(parsed[k], 40);
    return v.length >= 2 && !phrase.includes(v);
  });
  const detail = detailKey ? str(parsed[detailKey], 24) : undefined;
  return { line: `${name} ${phrase}`, detail };
}

/** 兜底：动作种类里没写到的（新增 kind 忘了补表时，至少别显示 JSON） */
export function fallbackPhrase(kind: AppAction["kind"]): string {
  return `做了件「${kind}」的事`;
}
