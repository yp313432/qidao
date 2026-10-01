import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ACTION_PERMISSION, actionTitle } from "./action-meta";
import { DEFAULT_MCP } from "./mcp";
import { QUOTA_LIMIT, QUOTA_WINDOW_MS, type ModelId } from "./models";
import { defaultPermissions, permissionDef } from "./permissions";
import { kindLabel, parseMusicLink } from "./music-embed";
import { startOfDay } from "@/lib/days";
import type { WordCard } from "./learn-data";
import { thinkingToPrune } from "./tokens";
import type {
  ActionLogEntry,
  ActivityEntry,
  AppAction,
  Attachment,
  ChatMessage,
  Conversation,
  DiaryEntry,
  HttpTool,
  McpServer,
  ImportantDate,
  Todo,
  MusicEmbed,
  Moment,
  MoodId,
  Letter,
  PanelId,
  PendingAction,
  PermissionId,
  PermissionMode,
  QuotaState,
  RequestLogEntry,
  SavedDoc,
  Settings,
  TextTone,
  ThemeId,
} from "./types";
import { uid } from "./utils";

const defaultSettings: Settings = {
  displayName: "yan",
  theme: "dawn",
  showThinking: true,
  saveThinking: true,
  notifications: true,
  quotaAlerts: true,
  diaryReminders: false,
  reminderTime: "21:00",
  contextBudget: 6000,
  keepRecent: 16,
  autoCompact: true,
  compactAt: 80,
  thinkingKeepDays: 0,
  voiceLang: "zh-CN",
  voiceSubtitles: true,
  embedQuote: "雨落在城市的肩上，我们各自听同一首歌。",
  shiganUrl: "",
  musicImage: "",
  diaryImage: "",
  motion: "auto",
  voiceReplies: false,
  replyStyle: "default",
  defaultModel: "sonnet",
  customBaseUrl: "",
  customApiKey: "",
  background: { image: "", blur: 24, dim: 0.15, opacity: 0.9 },
  font: "system",
  textTone: "auto",
  textColor: "#1c1917",
  aiAvatar: "",
  persona: "",
  userAvatar: "",
  aiName: "",
  permissions: defaultPermissions(),
};

/** 默认给一个真能用的示例，证明这个面板是「真的发请求」而不是摆设。 */
const DEFAULT_HTTP_TOOLS: HttpTool[] = [
  {
    id: "tool_demo_weather",
    name: "示例 · 上海天气",
    description: "Open-Meteo 免费接口（无需 key）。点「调用」会真的发一次请求。",
    method: "GET",
    url: "https://api.open-meteo.com/v1/forecast?latitude=31.23&longitude=121.47&current=temperature_2m,wind_speed_10m",
    headersText: "",
    body: "",
    enabled: true,
  },
];

function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.slice(0, 28) || "新对话";
}

function rotateQuota(q: QuotaState, now = Date.now()): QuotaState {
  if (now - q.windowStart >= QUOTA_WINDOW_MS) {
    return { used: 0, windowStart: now };
  }
  return q;
}

export type AppState = {
  hydrated: boolean;
  settings: Settings;
  quota: QuotaState;
  conversations: Conversation[];
  activeId: string | null;
  model: ModelId;
  mcp: McpServer[];
  httpTools: HttpTool[];
  /** 用户当前在干什么（供 AI 感知） */
  activity: ActivityEntry | null;
  recentActivity: ActivityEntry[];
  pendingActions: PendingAction[];
  actionLog: ActionLogEntry[];
  /** 战绩（供「感知」读取） */
  gameStats: { gobang: { win: number; loss: number; draw: number; lastAt: number } };
  /** 学习进度（供「感知」读取） */
  learnStats: { seen: number; recent: string[]; lastAt: number };
  /** 他给你加的生词卡 */
  customWords: WordCard[];
  /** 提醒 / 待办 */
  reminders: { id: string; text: string; time: string; done: boolean; createdAt: number; firedAt: number }[];
  /** 长期记忆（只存本机） */
  memories: { id: string; text: string; createdAt: number }[];
  /** 用户自己传的表情图（dataURL） */
  stickers: string[];
  addSticker: (dataUrl: string) => void;
  removeSticker: (dataUrl: string) => void;
  addCustomWord: (card: Omit<WordCard, "id">) => void;
  removeCustomWord: (id: string) => void;
  addReminder: (r: { text: string; time?: string }) => void;
  toggleReminder: (id: string) => void;
  removeReminder: (id: string) => void;
  fireReminder: (id: string) => void;
  addMemory: (text: string) => void;
  removeMemory: (id: string) => void;
  /** 界面效果（高亮 / 滚动），由 UiEffects 消费 */
  uiEffect: { kind: "highlight" | "scroll"; text: string; at: number } | null;
  /** 请求某个页面打开面板 / 做一步操作，由页面消费后置空 */
  openPanel: { id: PanelId; index?: number } | null;
  /** 当前正在玩的游戏状态（供「感知」读取） */
  gameContext: { game: string; detail: string; at: number } | null;
  setUiEffect: (e: { kind: "highlight" | "scroll"; text: string }) => void;
  setPanel: (p: PanelId | null, index?: number) => void;
  setGameContext: (g: { game: string; detail: string } | null) => void;
  renameChat: (id: string, title: string) => void;
  /** 最近几次请求的用量与提示词指纹（缓存命中可视化用） */
  requestLog: RequestLogEntry[];
  /** 外链歌单：一条条官方外链播放器 */
  musicEmbeds: MusicEmbed[];
  /** 小日子：重要日子与待办 */
  dates: ImportantDate[];
  todos: Todo[];
  addDate: (title: string, at: number, yearly: boolean, note?: string) => string;
  deleteDate: (id: string) => void;
  addTodo: (text: string) => string;
  toggleTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  clearDoneTodos: () => number;
  /** 动态：即时心情（他或我发的） */
  moments: Moment[];
  /** 他写的信 */
  letters: Letter[];
  addMoment: (mood: MoodId, text: string, by: "ai" | "me") => void;
  deleteMoment: (id: string) => void;
  /** 他写一封新信；返回 id */
  writeLetter: (title: string, body: string) => string;
  markLetterSeen: (id: string) => void;
  deleteLetter: (id: string) => void;
  /** 今天写过没有（可以写多篇，但期望至少一天一篇） */
  todayDiary: () => DiaryEntry | null;
  /** 连续写了多少天：今天写了就从今天算，今天没写就从昨天往回算 */
  diaryStreak: () => number;
  /** 当前正在播放的那条外链（null = 本地音乐） */
  currentEmbedId: string | null;
  setCurrentEmbed: (id: string | null) => void;
  /** 解析并加入一条外链，返回给用户看的结果文字 */
  addMusicEmbed: (url: string) => string;
  removeMusicEmbed: (id: string) => void;
  logRequest: (e: Omit<RequestLogEntry, "at"> & { at?: number }) => void;
  clearRequestLog: () => void;
  /** 按保留天数清理思考档案，返回清掉几条 */
  pruneThinking: (keepDays: number) => number;
  docs: SavedDoc[];
  diary: DiaryEntry[];
  thinkingArchive: { id: string; conversationId: string; title: string; thinking: string; createdAt: number }[];
  setHydrated: (v: boolean) => void;
  patchSettings: (p: Partial<Settings>) => void;
  setTheme: (theme: ThemeId) => void;
  setModel: (id: ModelId) => void;
  newChat: (opts?: { incognito?: boolean }) => string;
  /** 退出临时对话：丢掉所有临时会话，回到最近一次正常对话 */
  exitIncognito: () => void;
  setActive: (id: string | null) => void;
  deleteChat: (id: string) => void;
  pinChat: (id: string) => void;
  addUserMessage: (
    text: string,
    attachments?: Attachment[],
  ) => { conversationId: string; user: ChatMessage; assistant: ChatMessage };
  patchMessage: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  finalizeAssistant: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  bumpQuota: () => boolean;
  quotaResetAt: () => number;
  toggleMcp: (id: string) => void;
  addMcp: (server: Omit<McpServer, "id">) => void;
  patchMcp: (id: string, patch: Partial<McpServer>) => void;
  removeMcp: (id: string) => void;
  addHttpTool: (tool: Omit<HttpTool, "id">) => void;
  patchHttpTool: (id: string, patch: Partial<HttpTool>) => void;
  removeHttpTool: (id: string) => void;
  setActivity: (a: { label: string; detail?: string; path?: string }) => void;
  setPermission: (id: PermissionId, mode: PermissionMode) => void;
  requestAction: (action: AppAction, from?: string) => void;
  resolveAction: (id: string, allow: boolean, remember: boolean, message: string) => void;
  clearActionLog: () => void;
  recordGame: (result: "win" | "loss" | "draw") => void;
  recordWord: (word: string) => void;
  saveDoc: (doc: Omit<SavedDoc, "id" | "createdAt">) => void;
  deleteDoc: (id: string) => void;
  addDiary: (mood: DiaryEntry["mood"], body: string) => void;
  deleteDiary: (id: string) => void;
  markSavedToDocs: (conversationId: string, messageId: string) => void;
  enabledTools: () => McpServer[];
};

/**
 * 示例数据用**固定时间戳**。
 *
 * 不能写成 `Date.now() - 8h`：这个默认状态是在**模块加载时**求值的 ——
 * 服务端启动时算一次、客户端水合时又算一次，渲染出来的时间不一样，
 * React 判定水合失败并整棵树重渲染。（日记页曾经就是这样挂的：
 * 服务端渲染 11:21、客户端渲染 11:26，报 hydration mismatch。）
 */
const SEED_AT = Date.parse("2026-10-01T09:00:00+08:00");

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      settings: defaultSettings,
      quota: { used: 0, windowStart: Date.now() },
      conversations: [],
      activeId: null,
      model: "sonnet",
      mcp: DEFAULT_MCP,
      httpTools: DEFAULT_HTTP_TOOLS,
      activity: null,
      recentActivity: [],
      pendingActions: [],
      actionLog: [],
      gameStats: { gobang: { win: 0, loss: 0, draw: 0, lastAt: 0 } },
      learnStats: { seen: 0, recent: [], lastAt: 0 },
      customWords: [],
      reminders: [],
      memories: [],
      stickers: [],
      requestLog: [],
      musicEmbeds: [],
      dates: [],
      todos: [],
      moments: [],
      letters: [],
      currentEmbedId: null,
      setCurrentEmbed: (id) => set({ currentEmbedId: id }),
      uiEffect: null,
      openPanel: null,
      gameContext: null,
      docs: [
        {
          id: "doc_welcome",
          title: "栖岛使用备忘",
          content:
            "底部四个分区：对话、工具、玩乐、我的。思考链会随每条回复永久保存在本地；可在工具区的思考档案里回看。",
          source: "manual",
          createdAt: SEED_AT - 86400000,
        },
      ],
      diary: [
        {
          id: "d1",
          mood: "calm",
          body: "把界面做成清晨纸页的感觉。它应该安静，而不是吵。",
          createdAt: SEED_AT - 3600_000 * 8,
        },
      ],
      thinkingArchive: [],
      setHydrated: (v) => set({ hydrated: v }),
      patchSettings: (p) =>
        set((s) => ({
          settings: { ...s.settings, ...p },
          model: p.defaultModel ?? s.model,
        })),
      setTheme: (theme) => set((s) => ({ settings: { ...s.settings, theme } })),
      setModel: (id) => set({ model: id }),
      addHttpTool: (tool) =>
        set((s) => ({ httpTools: [...s.httpTools, { ...tool, id: uid("tool") }] })),
      patchHttpTool: (id, patch) =>
        set((s) => ({
          httpTools: s.httpTools.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      removeHttpTool: (id) =>
        set((s) => ({ httpTools: s.httpTools.filter((t) => t.id !== id) })),
      setActivity: ({ label, detail = "", path = "" }) =>
        set((s) => {
          const entry: ActivityEntry = { id: uid("act"), label, detail, path, at: Date.now() };
          const last = s.recentActivity[0];
          const same = Boolean(last && last.label === label && last.detail === detail);
          return {
            activity: entry,
            recentActivity: same ? s.recentActivity : [entry, ...s.recentActivity].slice(0, 8),
          };
        }),
      setPermission: (id, mode) =>
        set((s) => ({
          settings: { ...s.settings, permissions: { ...s.settings.permissions, [id]: mode } },
        })),
      requestAction: (action, from = "AI") =>
        set((s) => {
          const permission = ACTION_PERMISSION[action.kind];
          // L4（密钥、数据外传、上传文件）永不入队 —— 从源头就拦掉，
          // 连「问一次」的机会都不给。
          if (permissionDef(permission)?.risk === "L4") {
            return {
              actionLog: [
                {
                  id: uid("log"),
                  title: actionTitle(action),
                  permission,
                  result: "denied" as const,
                  message: "这类操作永远不会交给模型，已直接拒绝",
                  at: Date.now(),
                },
                ...s.actionLog,
              ].slice(0, 30),
            };
          }
          return {
            pendingActions: [
              ...s.pendingActions,
              {
                id: uid("req"),
                action,
                title: actionTitle(action),
                permission,
                from,
                at: Date.now(),
              },
            ],
          };
        }),
      resolveAction: (id, allow, remember, message) =>
        set((s) => {
          const item = s.pendingActions.find((p) => p.id === id);
          if (!item) return {};
          const nextMode: PermissionMode = allow ? "allow" : "deny";
          const entry: ActionLogEntry = {
            id: uid("log"),
            title: item.title,
            permission: item.permission,
            result: allow ? (remember ? "auto" : "allowed") : "denied",
            message,
            at: Date.now(),
          };
          return {
            pendingActions: s.pendingActions.filter((p) => p.id !== id),
            actionLog: [entry, ...s.actionLog].slice(0, 30),
            settings: remember
              ? {
                  ...s.settings,
                  permissions: { ...s.settings.permissions, [item.permission]: nextMode },
                }
              : s.settings,
          };
        }),
      clearActionLog: () => set({ actionLog: [] }),
      logRequest: (e) =>
        set((s) => ({
          requestLog: [{ ...e, at: e.at ?? Date.now() }, ...s.requestLog].slice(0, 40),
        })),
      clearRequestLog: () => set({ requestLog: [] }),
      addMusicEmbed: (url) => {
        const r = parseMusicLink(url);
        if (!r.ok) return r.message;
        // 同一个播放器粘两次很常见（不同格式的同一条链接），别叠两份 iframe
        if (get().musicEmbeds.some((e) => e.embedUrl === r.embed.embedUrl)) {
          return "这条已经在列表里了，没有重复添加。";
        }
        set((s) => ({ musicEmbeds: [r.embed, ...s.musicEmbeds].slice(0, 10) }));
        return `已加入：${r.embed.serviceLabel} · ${kindLabel(r.embed.kind)}`;
      },
      removeMusicEmbed: (id) =>
        set((s) => ({
          musicEmbeds: s.musicEmbeds.filter((e) => e.id !== id),
          currentEmbedId: s.currentEmbedId === id ? null : s.currentEmbedId,
        })),
      pruneThinking: (keepDays) => {
        const ids = new Set(thinkingToPrune(get().thinkingArchive, keepDays));
        if (ids.size === 0) return 0;
        set((s) => ({ thinkingArchive: s.thinkingArchive.filter((t) => !ids.has(t.id)) }));
        return ids.size;
      },
      setUiEffect: (e) => set({ uiEffect: { ...e, at: Date.now() } }),
      setPanel: (p, index) => set({ openPanel: p ? { id: p, index } : null }),
      setGameContext: (g) => set({ gameContext: g ? { ...g, at: Date.now() } : null }),
      renameChat: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title: title.trim().slice(0, 40) || c.title, updatedAt: Date.now() } : c,
          ),
        })),
      recordGame: (result) =>
        set((s) => ({
          gameStats: {
            gobang: {
              ...s.gameStats.gobang,
              [result]: s.gameStats.gobang[result] + 1,
              lastAt: Date.now(),
            },
          },
        })),
      recordWord: (word) =>
        set((s) => ({
          learnStats: {
            seen: s.learnStats.seen + 1,
            recent: [word, ...s.learnStats.recent.filter((w) => w !== word)].slice(0, 20),
            lastAt: Date.now(),
          },
        })),
      addCustomWord: (card) =>
        set((s) => ({
          customWords: [
            { ...card, id: uid("w") },
            ...s.customWords.filter((w) => w.word.toLowerCase() !== card.word.toLowerCase()),
          ].slice(0, 200),
        })),
      removeCustomWord: (id) => set((s) => ({ customWords: s.customWords.filter((w) => w.id !== id) })),
      addReminder: ({ text, time }) =>
        set((s) => ({
          reminders: [
            { id: uid("rem"), text: text.trim(), time: time || "21:00", done: false, createdAt: Date.now(), firedAt: 0 },
            ...s.reminders,
          ].slice(0, 50),
        })),
      toggleReminder: (id) =>
        set((s) => ({ reminders: s.reminders.map((r) => (r.id === id ? { ...r, done: !r.done } : r)) })),
      removeReminder: (id) => set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) })),
      fireReminder: (id) =>
        set((s) => ({ reminders: s.reminders.map((r) => (r.id === id ? { ...r, firedAt: Date.now() } : r)) })),
      addMemory: (text) =>
        set((s) => ({
          memories: [{ id: uid("mem"), text: text.trim(), createdAt: Date.now() }, ...s.memories].slice(0, 100),
        })),
      removeMemory: (id) => set((s) => ({ memories: s.memories.filter((m) => m.id !== id) })),
      addSticker: (dataUrl) => set((s) => ({ stickers: [dataUrl, ...s.stickers].slice(0, 60) })),
      removeSticker: (dataUrl) => set((s) => ({ stickers: s.stickers.filter((x) => x !== dataUrl) })),
      newChat: (opts) => {
        const id = uid("chat");
        const conv: Conversation = {
          id,
          title: opts?.incognito ? "临时对话" : "新对话",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          pinned: false,
          incognito: Boolean(opts?.incognito),
        };
        set((s) => ({ conversations: [conv, ...s.conversations], activeId: id }));
        return id;
      },
      setActive: (id) => set({ activeId: id }),
      exitIncognito: () => {
        const s = get();
        const kept = s.conversations.filter((c) => !c.incognito);
        // 临时对话本来就不进抽屉，所以必须给一条明确的退路
        if (kept.length === 0) {
          set({ conversations: [], activeId: null });
          get().newChat();
          return;
        }
        const back = kept.find((c) => c.id === s.activeId) ?? kept[0]!;
        set({ conversations: kept, activeId: back.id });
      },
      deleteChat: (id) =>
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
          thinkingArchive: s.thinkingArchive.filter((t) => t.conversationId !== id),
        })),
      pinChat: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
        })),
      addUserMessage: (text, attachments) => {
        let { activeId, conversations, model } = get();
        if (!activeId || !conversations.find((c) => c.id === activeId)) {
          activeId = get().newChat();
          conversations = get().conversations;
        }
        const user: ChatMessage = {
          id: uid("m"),
          role: "user",
          content: text,
          attachments: attachments && attachments.length ? attachments : undefined,
          thinking: "",
          thinkingDurationMs: 0,
          createdAt: Date.now(),
        };
        const assistant: ChatMessage = {
          id: uid("m"),
          role: "assistant",
          content: "",
          thinking: "",
          thinkingDurationMs: 0,
          createdAt: Date.now(),
          model,
        };
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== activeId) return c;
            const title =
              c.messages.length === 0 && !c.incognito
                ? titleFrom(
                    text ||
                      (attachments?.some((a) => a.kind === "image")
                        ? "图片"
                        : attachments?.length
                          ? "附件"
                          : ""),
                  )
                : c.title;
            return {
              ...c,
              title,
              updatedAt: Date.now(),
              messages: [...c.messages, user, assistant],
            };
          }),
        }));
        return { conversationId: activeId!, user, assistant };
      },
      patchMessage: (conversationId, messageId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id !== conversationId
              ? c
              : {
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
                },
          ),
        })),
      finalizeAssistant: (conversationId, messageId, patch) => {
        const saveThinking = get().settings.saveThinking;
        set((s) => {
          const conv = s.conversations.find((c) => c.id === conversationId);
          const msg = conv?.messages.find((m) => m.id === messageId);
          const thinking = patch.thinking ?? msg?.thinking ?? "";
          const archive =
            saveThinking && thinking.trim() && conv && !conv.incognito
              ? [
                  {
                    id: uid("th"),
                    conversationId,
                    title: conv.title,
                    thinking,
                    createdAt: Date.now(),
                  },
                  ...s.thinkingArchive,
                ].slice(0, 200)
              : s.thinkingArchive;
          return {
            thinkingArchive: archive,
            conversations: s.conversations.map((c) =>
              c.id !== conversationId
                ? c
                : {
                    ...c,
                    updatedAt: Date.now(),
                    messages: c.messages.map((m) =>
                      m.id === messageId
                        ? {
                            ...m,
                            ...patch,
                            thinking: saveThinking ? (patch.thinking ?? m.thinking) : m.thinking,
                          }
                        : m,
                    ),
                  },
            ),
          };
        });
      },
      bumpQuota: () => {
        const q = rotateQuota(get().quota);
        if (q.used >= QUOTA_LIMIT) {
          set({ quota: q });
          return false;
        }
        set({ quota: { ...q, used: q.used + 1 } });
        return true;
      },
      /**
       * 配额重置时间。
       *
       * ⚠️ 这里**绝对不能**调 rotateQuota：窗口一旦过期，它就用 `Date.now()`
       * 造一个新的 windowStart，于是这个选择器每毫秒返回不同的数字 ——
       * zustand 认为快照一直在变，React 会无限重渲染，直接崩到错误边界。
       * （实测：配额过期时打开「我的」必崩，报 Maximum update depth exceeded。）
       * 真正的轮转交给发送消息时的 bumpQuota 去做。
       */
      quotaResetAt: () => get().quota.windowStart + QUOTA_WINDOW_MS,
      toggleMcp: (id) =>
        set((s) => ({
          mcp: s.mcp.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)),
        })),
      addMcp: (server) => set((s) => ({ mcp: [...s.mcp, { ...server, id: uid("mcp") }] })),
      patchMcp: (id, patch) =>
        set((s) => ({ mcp: s.mcp.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      removeMcp: (id) => set((s) => ({ mcp: s.mcp.filter((m) => m.id !== id) })),
      saveDoc: (doc) =>
        set((s) => ({
          docs: [{ ...doc, id: uid("doc"), createdAt: Date.now() }, ...s.docs],
        })),
      deleteDoc: (id) => set((s) => ({ docs: s.docs.filter((d) => d.id !== id) })),
      addDiary: (mood, body) =>
        set((s) => ({
          diary: [{ id: uid("dy"), mood, body, createdAt: Date.now() }, ...s.diary],
        })),
      deleteDiary: (id) => set((s) => ({ diary: s.diary.filter((d) => d.id !== id) })),

      /* ---------- 动态空间：动态 / 一天一篇日记 / 信 ---------- */

      /* ---------- 小日子：重要日子 / 待办 ---------- */

      addDate: (title, at, yearly, note) => {
        const id = uid("dt");
        set((s) => ({
          dates: [
            ...s.dates,
            {
              id,
              title: title.trim() || "一个日子",
              at: startOfDay(at),
              yearly,
              note: note?.trim() || undefined,
            },
          ],
        }));
        return id;
      },
      deleteDate: (id) => set((s) => ({ dates: s.dates.filter((d) => d.id !== id) })),

      addTodo: (text) => {
        const t = text.trim();
        if (!t) return "";
        const id = uid("td");
        set((s) => ({ todos: [{ id, text: t, done: false, createdAt: Date.now() }, ...s.todos] }));
        return id;
      },
      toggleTodo: (id) =>
        set((s) => ({
          todos: s.todos.map((t) =>
            t.id === id ? { ...t, done: !t.done, doneAt: t.done ? undefined : Date.now() } : t,
          ),
        })),
      deleteTodo: (id) => set((s) => ({ todos: s.todos.filter((t) => t.id !== id) })),
      clearDoneTodos: () => {
        const n = get().todos.filter((t) => t.done).length;
        set((s) => ({ todos: s.todos.filter((t) => !t.done) }));
        return n;
      },

      addMoment: (mood, text, by) =>
        set((s) => ({
          // 只留最近 60 条，免得本地存储被刷爆
          moments: [{ id: uid("mo"), mood, text, at: Date.now(), by }, ...s.moments].slice(0, 60),
        })),
      deleteMoment: (id) => set((s) => ({ moments: s.moments.filter((m) => m.id !== id) })),

      writeLetter: (title, body) => {
        const id = uid("lt");
        set((s) => ({
          letters: [
            { id, title: title.trim() || "给你的信", body: body.trim(), at: Date.now(), seen: false },
            ...s.letters,
          ].slice(0, 40),
        }));
        return id;
      },
      markLetterSeen: (id) =>
        set((s) => ({
          letters: s.letters.map((l) => (l.id === id ? { ...l, seen: true } : l)),
        })),
      deleteLetter: (id) => set((s) => ({ letters: s.letters.filter((l) => l.id !== id) })),

      todayDiary: () => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        return get().diary.find((d) => d.createdAt >= start.getTime()) ?? null;
      },
      /**
       * 连续天数。
       *
       * 日记**不限制一天一篇** —— 想写随时写，一条一个时间戳。
       * 这个只用来提醒「至少一天一篇」：今天写了从今天算，没写就从昨天往回算，
       * 所以今天还没写也不会立刻把连续记录打断。
       */
      diaryStreak: () => {
        const days = new Set(
          get().diary.map((d) => {
            const t = new Date(d.createdAt);
            t.setHours(0, 0, 0, 0);
            return t.getTime();
          }),
        );
        if (days.size === 0) return 0;
        const day = new Date();
        day.setHours(0, 0, 0, 0);
        if (!days.has(day.getTime())) day.setDate(day.getDate() - 1);
        let n = 0;
        while (days.has(day.getTime())) {
          n += 1;
          day.setDate(day.getDate() - 1);
        }
        return n;
      },
      markSavedToDocs: (conversationId, messageId) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id !== conversationId
              ? c
              : {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId ? { ...m, savedToDocs: true } : m,
                  ),
                },
          ),
        })),
      enabledTools: () => get().mcp.filter((m) => m.enabled),
    }),
    {
      name: "aster-app",
      version: 1,
      // 老快照可能缺 font / textTone / textColor / background 等新字段，
      // 用默认值补齐，避免升级后读到 undefined。
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...saved,
          settings: { ...current.settings, ...(saved.settings ?? {}) },
        };
      },
      partialize: (s) => ({
        settings: s.settings,
        quota: s.quota,
        conversations: s.conversations.filter((c) => !c.incognito),
        activeId: s.conversations.find((c) => c.id === s.activeId && !c.incognito)?.id ?? null,
        model: s.model,
        mcp: s.mcp,
        httpTools: s.httpTools,
        actionLog: s.actionLog,
        gameStats: s.gameStats,
        learnStats: s.learnStats,
        customWords: s.customWords,
        reminders: s.reminders,
        memories: s.memories,
        stickers: s.stickers,
        requestLog: s.requestLog,
        musicEmbeds: s.musicEmbeds,
        dates: s.dates,
        todos: s.todos,
        moments: s.moments,
        letters: s.letters,
        currentEmbedId: s.currentEmbedId,
        docs: s.docs,
        diary: s.diary,
        thinkingArchive: s.thinkingArchive,
      }),
    },
  ),
);

export function applyTheme(theme: ThemeId) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  const color = theme === "dawn" ? "#f6f3ee" : theme === "dusk" ? "#1a1613" : "#0e0f12";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", color);
  try {
    localStorage.setItem("aster-theme", theme);
  } catch {
    /* ignore */
  }
}

const TONE_COLORS: Record<"dark" | "light", string> = {
  dark: "#17130f",
  light: "#f7f4ef",
};

/**
 * 弹层底色要**跟着文字颜色走**，不能跟着主题走。
 *
 * 典型翻车现场：深色背景图 + 强制浅色文字 —— 画布色还是浅的，
 * 弹层就成了白底白字，什么都看不见。所以：浅色文字 ⇒ 深色弹层。
 */
function menuFillFor(textColor: string): string {
  const hex = textColor.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6
    ? "color-mix(in oklab, #131010 90%, transparent)"
    : "color-mix(in oklab, #fffcf8 94%, transparent)";
}

/**
 * 应用外观偏好：正文字体族 + 文字颜色。
 *
 * 文字颜色走 `--aster-fg / --aster-muted / --aster-subtle` 三个变量覆盖，
 * 这样深色背景图上小字看不清时，用户可以强制换成浅色或自定义颜色。
 */
export function applyAppearance(settings: Settings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.font = settings.font ?? "system";
  // 动画开关：auto 时由 CSS 里的 prefers-reduced-motion 决定，on/off 由这里强制定
  root.dataset.motion = settings.motion ?? "auto";

  const tone = settings.textTone ?? "auto";
  if (tone === "auto") {
    root.style.removeProperty("--aster-fg");
    root.style.removeProperty("--aster-muted");
    root.style.removeProperty("--aster-subtle");
    // 弹层底色回到主题自带的那份
    root.style.removeProperty("--aster-menu");
    return;
  }

  const color = tone === "custom" ? settings.textColor || TONE_COLORS.dark : TONE_COLORS[tone];
  root.style.setProperty("--aster-fg", color);
  root.style.setProperty("--aster-muted", `color-mix(in oklab, ${color} 76%, transparent)`);
  root.style.setProperty("--aster-subtle", `color-mix(in oklab, ${color} 55%, transparent)`);
  // 文字被强制改色了，弹层底色也得跟着翻，否则白底白字
  root.style.setProperty("--aster-menu", menuFillFor(color));
}
