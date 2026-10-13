/**
 * 栖岛数据层的**表定义**（PH2 骨架，2026-10）。
 *
 * ⚠️ 这个文件只是"形状"，**还没接管任何现有数据**（切换在 PH3，用户点头才做）。
 * 规矩见 `qidao-docs/UI统一规范.md` §12（数据统一规范）与 `数据架构-①设计.md`。
 *
 * 为什么要重做（用户原话）："我们不能哪里出问题再补哪一块了，拆东补西，
 * 而是把整体搭建好了，变得统一有条理。"
 *
 * 现在的问题：27 类数据挤在 IndexedDB 的**一条记录**里（`qidao-store/kv/aster-app`），
 * 改一个字就要把几 MB（含 base64 图片）整块重写。这里把它拆成"一个库、多张表"。
 */

/** 库名。跟旧的 `qidao-store` / `qidao-music` / `qidao-play-photos` **并存**，不覆盖 */
export const DATA_DB = "qidao";

/**
 * schema 版本。加表/改字段**必须** +1 并配一个迁移函数（见 `migrate.ts`）。
 * v1 = 第一版（空库直接建；旧的大 JSON 由 `migrate.ts` 搬进来）
 */
export const SCHEMA_VERSION = 1;

/** 表名（对象存储名）。一张表一类数据，见设计文档 §1.2 */
export const TABLES = {
  meta: "meta",
  settings: "settings",
  conversations: "conversations",
  messages: "messages",
  blobs: "blobs",
  memories: "memories",
  writings: "writings",
  emotions: "emotions",
  schedules: "schedules",
  stats: "stats",
  logs: "logs",
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];

/** 索引定义（建库时创建；name 是索引名，keyPath 可以是数组=复合键） */
export const INDEXES: Record<TableName, { name: string; keyPath: string | string[] }[]> = {
  meta: [],
  settings: [],
  conversations: [{ name: "updatedAt", keyPath: "updatedAt" }],
  /** 按"哪个对话 + 什么时候"排 —— 打开一条对话只要它自己的消息 */
  messages: [
    { name: "convAt", keyPath: ["convId", "at"] },
    { name: "at", keyPath: "at" },
  ],
  blobs: [{ name: "kind", keyPath: "kind" }],
  memories: [
    { name: "updatedAt", keyPath: "updatedAt" },
    { name: "tags", keyPath: "tags", },
  ],
  writings: [{ name: "kindAt", keyPath: ["kind", "at"] }],
  emotions: [{ name: "at", keyPath: "at" }],
  schedules: [{ name: "nextAt", keyPath: "nextAt" }],
  stats: [],
  logs: [{ name: "at", keyPath: "at" }],
};

/* ────────────────────────── 记录形状 ────────────────────────── */

/** meta 表：整个库的"户口本"（版本、上次备份、上次写入、坏档记录） */
export type MetaRecord = {
  key: "schema";
  version: number;
  /** 从哪一版迁过来的（给"迁移守恒"报告用） */
  migratedFrom?: string;
  /** 上次成功备份（写完备份格）的时间 */
  lastBackupAt?: number;
  /** 上次成功写入的时间 */
  lastWriteAt?: number;
  /** 读不出来的坏档留证记录（键名 + 时间 + 原因） */
  corruptNotes?: { key: string; at: number; why: string }[];
  /** 这次启动有没有读失败过（界面据此提示"重启试试"） */
  readFailedAt?: number;
};

/** 一条对话（只有元信息，消息在 messages 表） */
export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 摘要（更早的对话压成一份，见 lib/summarizer） */
  summary?: string;
  /** 隐藏对话（"偷偷聊"）不入库 */
  incognito?: boolean;
  /** 消息条数（列表页不用数消息） */
  msgCount?: number;
  /** 最后一条消息的时间（列表排序用） */
  lastAt?: number;
  /**
   * **没建模的字段原样带着**（宁可多带，不可丢 —— 见 §12 设计文档"迁移守恒"）。
   * ⚠️ 2026-10 真跑切换时被守恒断言抓到：真实存档里的字段比这里建模的多，
   * 不给 extra 就会在往返时丢掉 → 校验和对不上。
   */
  extra?: Record<string, unknown>;
};

/**
 * 一条消息。
 *
 * ⚠️ 跟旧形状的差别：附件**只留引用**（`blobId`），base64 正文去 `blobs` 表 —— 见设计文档 F3。
 * 上层要用图时由 `blobs` 取出来临时转 dataURL 发给上游。
 */
export type MessageRecord = {
  id: string;
  convId: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** 思考链（可空；老消息会被清掉，见 `THINKING_KEEP`） */
  thinking?: string;
  /** 思考耗时（毫秒） */
  thinkingMs?: number;
  /** 消息时间 */
  at: number;
  /** 附件引用（不再是 dataUrl） */
  attachments?: {
    id: string;
    kind: "image" | "file" | "sticker" | "audio";
    name: string;
    mime: string;
    size: number;
    /** 二进制在 blobs 表里的主键；没有（比如纯文本附件）则为空 */
    blobId?: string;
    /** 文本类附件的正文（截断过） */
    text?: string;
    truncated?: boolean;
    /** 语音时长（毫秒） */
    durationMs?: number;
  }[];
  /** 分段回复用的分段（见 lib/segment） */
  parts?: string[];
  /** 这条消息是谁来的："user" / "wake"（他主动说的）/ "action"（工具动作落地） */
  origin?: string;
  /** 没建模的字段原样带着（同 ConversationRecord.extra 的理由） */
  extra?: Record<string, unknown>;
  /**
   * **原字段名**：有的消息时间叫 `at`、有的叫 `createdAt`。
   * 搬家时统一成 `at`，拼回旧形状要按原名还原（真机切换时守恒断言抓到过）。
   */
  keys?: RecordKeys;
  /**
   * 这条消息**原本带了哪些键**（`thinking` / `attachments` / `parts` / `origin` …）。
   *
   * ⚠️ 真机切换抓到：真实数据里 `thinking: ""`、`attachments: []`、`parts: []` 到处都有，
   * 只按"值非空"判断就会**把这些键丢掉** → 往返守恒对不上。所以要把"键在不在"记下来。
   */
  present?: string[];
};

/** 二进制资产：图片 / 表情 / 音频 / 照片（**存 Blob，不存 base64**） */
export type BlobRecord = {
  id: string;
  kind: "image" | "sticker" | "audio" | "photo" | "avatar" | "other";
  mime: string;
  size: number;
  at: number;
  /** 原始字节 */
  data: Blob;
};

/** 记忆（含世界书条目：用 kind 区分） */
export type MemoryRecord = {
  id: string;
  kind: "memory" | "worldbook";
  text: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
};

/** 用户写的东西：日记 / 动态 / 信 / 文档 / 待办 / 日子（同一张表 + kind） */
export type WritingRecord = {
  id: string;
  kind: "diary" | "moment" | "letter" | "doc" | "todo" | "date";
  title?: string;
  text: string;
  /** 额外字段（心情、角色、是否完成…）——刻意不做成列，避免为每个功能改表 */
  extra?: Record<string, unknown>;
  at: number;
  /**
   * **原字段名**（`body` / `content` / `createdAt` …）。
   *
   * ⚠️ 2026-10 真跑切换时守恒断言抓到：App 里日记的正文叫 `body`、文档叫 `content`、
   * 时间叫 `createdAt`，搬过来统一成 `text`/`at` 之后**往返拼不回原名字** → 切回去日记/文档会读不出来。
   * 所以把原名记下来，`roundTrip()` 按原名还原（不复制一份正文，只记名字）。
   */
  keys?: { text?: string; time?: string; title?: string };
};

/** 情绪事件 */
export type EmotionRecord = {
  id: string;
  kind: string;
  at: number;
  note?: string;
};

/** 定时类：提醒 / 任务 / 闹钟 / 唤醒（同一张表 + kind） */
export type ScheduleRecord = {
  id: string;
  kind: "reminder" | "task" | "alarm" | "wake";
  title?: string;
  text?: string;
  /** 下次触发时间（排序/查询用） */
  nextAt?: number;
  done?: boolean;
  extra?: Record<string, unknown>;
  /**
   * ⚠️ **原件带了哪些"时间戳类"的键**（`at` / `createdAt` / `ts` / `date`…）。
   * 拼回旧形状时只在"原件确实有"的时候才写 `at` —— 凭空补一个 `at: 0`
   * 会让一次性任务看起来像 1970 年就该响（2026-10 整份往返测试抓到的）。
   * 注意 `time`（"08:00" 这种每天几点）**不算**时间戳，它走 extra 原样带回。
   */
  present?: string[];
};

/** 统计（游戏/学习/动作/请求…） */
export type StatRecord = {
  key: string;
  value: unknown;
  updatedAt: number;
};

/**
 * 运行记录（动作 / 请求）。
 *
 * ⚠️ 这是"可重算运行态"，允许丢 —— 上限见 `retention.ts`（用户口径：
 * 动作记录满 200 条或过一天就清；请求记录留最近 500 条）。
 */
export type LogRecord = {
  id: string;
  kind: "action" | "request";
  at: number;
  payload: Record<string, unknown>;
};

/**
 * **原字段名**：搬家时会把字段统一成 `text`/`at`/`createdAt`，
 * 但拼回旧形状必须用**原来的名字**（日记是 `body`、文档是 `content`、消息时间有的是 `at`…），
 * 否则切回老存储时 App 读不出来。
 *
 * ⚠️ 2026-10 真机切换时守恒断言抓到两次：先是只给 writings 记了名字，
 * 后来发现记忆/消息/情绪的"键在值为空"字段也照样丢。
 */
export type RecordKeys = {
  text?: string;
  time?: string;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
};

/* ────────────────────────── 纯工具 ────────────────────────── */

/** 一个稳定的短 id（不依赖 crypto，网页版/原生都能跑） */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 内容校验和（用来做"迁移守恒"断言：搬过去之后条数和内容都得对得上）。
 *
 * 用 FNV-1a 32 位 —— 够抓"搬丢了/搬重了/内容变了"，而且**纯函数、可复现**。
 *
 * ⚠️ **必须按 key 排序再算**（2026-10 踩过）：`JSON.stringify` 保留**插入顺序**，
 * 于是"同样的内容、字段顺序不同"会算出两个校验和 → 守恒报告假报警。
 * 校验和要回答的是"内容变没变"，不是"字段顺序变没变"。
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

export function checksum(input: unknown): string {
  const s = typeof input === "string" ? input : canonical(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
