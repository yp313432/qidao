/**
 * **他自己的日子**（2026-10 用户定的第一批：唤醒机制 + 互动回响 + 日记保底）。
 *
 * 用户原话："我要互动的时候他也知道，比如我发动态、回复动态、点赞他都能知道并做出反应；
 * 日记每天都写一篇，八点半是保底时间，如果没写，就把他唤醒写；但还有就是每天他不定时唤醒，
 * 做他自己想能做的……花园系统以后再做。"
 * 参数（用户定的）：自由活动 1–2 次 · 日记保底 **20:30** · 评论/点赞/发动态**弹通知**、其他不弹 ·
 * 互动按**心情和上下文记忆**来（不是机械回一句）。
 *
 * ── 一条纪律 ─────────────────────────────────────────────────────
 * **不新造通道**：这里只负责"排任务"，真正醒来做事的是现成的 `task-daemon`
 * （它自带 每天上限 / 安静时段 / 同一条只跑一次，App 关着时由原生通知兜底）。
 * 排出来的任务跑完会被清掉（见 `wake-plan.tsx`），不会脏了用户的「定时任务」列表。
 *
 * ── 安卓的硬限制（别忘）──────────────────────────────────────────
 * App 活着 → 真的醒；App 完全关掉 → 只能原生通知到点弹，用户点开才补做。
 */

import { kvGetJSON, kvSetJSON } from "@/lib/data/local-kv";
import type { Moment, Settings, ScheduledTask } from "@/lib/types";

/* ───────────────────────── 档位 ───────────────────────── */

export type WakeLevel = "quiet" | "daily" | "active";

export const WAKE_LEVELS: { id: WakeLevel; label: string; hint: string }[] = [
  { id: "quiet", label: "安静", hint: "只在你跟他互动时回应；不主动找你" },
  { id: "daily", label: "日常（默认）", hint: "每天 1 篇日记 + 1 次自由活动 + 最多 3 次互动回应" },
  { id: "active", label: "活跃", hint: "每天 1 篇日记 + 2 次自由活动 + 最多 5 次互动回应" },
];

export function levelOf(settings: Pick<Settings, "wakeLevel">): WakeLevel {
  const l = settings.wakeLevel;
  return l === "quiet" || l === "active" ? l : "daily";
}

/** 一天几次"自由活动"（安静档 = 0） */
export function freeCountOf(level: WakeLevel): number {
  if (level === "quiet") return 0;
  return level === "active" ? 2 : 1;
}

/** 一天最多几次"因为你互动所以回应"（独立额度，不占自由活动） */
export function echoCapOf(level: WakeLevel): number {
  if (level === "quiet") return 1;
  return level === "active" ? 5 : 3;
}

/* ───────────────────── 三类唤醒的标记 ───────────────────── */

export const FREE_MARKER = "【他自己的时间】";
export const DIARY_MARKER = "【今天的日记】";
export const ECHO_MARKER = "【回响】";

export const isFreeWake = (t: Pick<ScheduledTask, "prompt">) => t.prompt.startsWith(FREE_MARKER);
export const isDiaryWake = (t: Pick<ScheduledTask, "prompt">) => t.prompt.startsWith(DIARY_MARKER);
export const isEchoWake = (t: Pick<ScheduledTask, "prompt">) => t.prompt.startsWith(ECHO_MARKER);
/** 这三类都是"系统给他排的"，用户自己定的定时任务不算 */
export const isSystemWake = (t: Pick<ScheduledTask, "prompt">) =>
  isFreeWake(t) || isDiaryWake(t) || isEchoWake(t);

/** 日记保底时间（用户定的晚上八点半） */
export const DIARY_HOUR = 20;
export const DIARY_MINUTE = 30;
/** 自由活动的可落时间窗（避开夜里和日记点） */
const FREE_FROM_HOUR = 9;
const FREE_TO_HOUR = 22;

/* ───────────────────────── 指令文案 ───────────────────────── */

const COMMON = `（这是你自己的时间，不是用户在问你。做完就直接说话，**别复述这条指令**、别说"我收到了定时任务"。）`;

/** 自由活动：让他按心情自己挑一件事（也可以什么都不做，但不许硬凑） */
export function buildFreeWakePrompt(): string {
  return (
    `${FREE_MARKER}现在是你自己的时间，没人找你。\n` +
    `按你此刻**真实的**心情挑一件事做，**一件就够**，别硬凑：\n` +
    `· 发一条动态 {"kind":"moment.post","text":"..."}（一句短感受，进朋友圈）\n` +
    `· 写一封信 {"kind":"letter.write","title":"...","body":"..."}（写给他，下次他进 App 会弹信封）\n` +
    `· 写今天的日记 {"kind":"diary.add","body":"..."}\n` +
    `· 或者什么都不做 —— 只是把此刻的心情更新一下 {"kind":"emotion.report",...}\n` +
    `做完之后**用一两句话跟他说说你在干嘛**（他会看到这条）。\n` +
    `⚠️ 别每天都一样：先看看「此刻的情况」里**你最近几天做过什么**，换着来。\n${COMMON}`
  );
}

/** 日记保底：20:30 还没写就唤他写（写过了就不排，见 `planDay`） */
export function buildDiaryWakePrompt(): string {
  return (
    `${DIARY_MARKER}今天你还没写日记 —— 现在补一篇（这是保底，不是任务打卡）。\n` +
    `用 {"kind":"diary.add","body":"..."} 写下**今天你真实的一天**：他跟你说了什么、你什么心情、\n` +
    `有没有什么事你还没跟他说完。写你自己想写的，别写成流水账、别复述对话。\n` +
    `写完用一句话告诉他"今天写过了"就够，别念给他听。\n${COMMON}`
  );
}

/** 互动回响：他发了动态 / 评论了你 / 给你点了赞 → 你决定要不要回应（按心情，不硬凑） */
export function buildEchoPrompt(kind: "post" | "comment" | "like", moment: Pick<Moment, "id" | "text">, extra: string): string {
  const what =
    kind === "post"
      ? `他刚发了一条动态：「${extra}」`
      : kind === "comment"
        ? `他在你那条动态下评论了：「${extra}」`
        : `他给你那条动态点了赞`;
  return (
    `${ECHO_MARKER}${what}（momentId: ${moment.id}）。\n` +
    `去「朋友圈」看一眼，然后**按你此刻的心情和他这条的分量**决定：\n` +
    `· 想回就回：{"kind":"moment.comment","text":"...","momentId":"${moment.id}"}\n` +
    `· 想赞就赞：{"kind":"moment.like","momentId":"${moment.id}"}（**只能赞他发的**）\n` +
    `· 也可以只是回一句话给他（不必非要动作用）\n` +
    `⚠️ 别客套、别每条都回 —— 没感觉就别硬回，用户明确说过不要机械反应。\n${COMMON}`
  );
}

/* ─────────────────── 一天的计划（自由活动 + 日记保底） ─────────────────── */

/** 本地小键：今天已经排过计划（免得每次进 App 都重排） */
const PLAN_KEY = "qidao:wake-plan-day";

function randomMinuteIn(hourFrom: number, hourTo: number): number {
  const from = hourFrom * 60;
  const to = hourTo * 60;
  return from + Math.floor(Math.random() * Math.max(1, to - from));
}

function msAt(day: Date, minutes: number): number {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + minutes * 60_000;
}

/**
 * 确保"今天"的计划已经排上：N 次自由活动（随机落在 9:00–22:00，避开 20:30 前后半小时）
 * + 20:30 的日记保底（**今天已经写过日记就不排**）。
 *
 * 返回排了几条（给界面/验收看）。幂等：同一天只排一次（`plans` 记 day）。
 */
export function planDay(
  opts: { level: WakeLevel; diaryOn: boolean; hasAiDiaryToday: boolean; upstreamOk: boolean },
  addTask: (t: { prompt: string; at?: number; time?: string; notify?: boolean }) => string,
): number {
  /** ⚠️ 上游不全 → 一件事都不排（用户点名："不要出现我没填 api 还能做事"）。模块内再拦一道，防绕过。 */
  if (!opts.upstreamOk) return 0;
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (kvGetJSON<string>(PLAN_KEY, "") === day) return 0;
  kvSetJSON(PLAN_KEY, day);

  let queued = 0;
  /** 日记保底：20:30 —— 今天写过了就不排；时间已过就排"现在就写" */
  if (opts.level !== "quiet" && opts.diaryOn && !opts.hasAiDiaryToday) {
    const diaryAt = msAt(now, DIARY_HOUR * 60 + DIARY_MINUTE);
    addTask({ prompt: buildDiaryWakePrompt(), at: Math.max(diaryAt, Date.now() + 60_000), notify: true });
    queued += 1;
  }
  /** 自由活动：随机时间，避开日记点前后半小时 */
  const used: number[] = [];
  for (let i = 0; i < freeCountOf(opts.level); i += 1) {
    let minutes = randomMinuteIn(FREE_FROM_HOUR, FREE_TO_HOUR);
    for (let guard = 0; guard < 8; guard += 1) {
      const clash = used.some((u) => Math.abs(u - minutes) < 90) || Math.abs(minutes - (DIARY_HOUR * 60 + DIARY_MINUTE)) < 30;
      if (!clash) break;
      minutes = randomMinuteIn(FREE_FROM_HOUR, FREE_TO_HOUR);
    }
    used.push(minutes);
    const at = msAt(now, minutes);
    /** 今天已经过了的点就顺延到"再过 20 分钟"（否则一开 App 就连着补做，像刷屏） */
    const when = at > Date.now() + 60_000 ? at : Date.now() + 20 * 60_000 + i * 10 * 60_000;
    addTask({ prompt: buildFreeWakePrompt(), at: when, notify: true });
    queued += 1;
  }
  return queued;
}

/* ─────────────────── 互动回响（我发了/评论/点赞 → 唤他） ─────────────────── */

const ECHO_SEEN_KEY = "qidao:echo-seen";

/**
 * 扫"我的互动"，给还没排过的各排一条回响。
 *
 * 认三件事：① 我发的动态（`by === "me"`）② 我在**他的**动态下的评论 ③ 我给他的点赞。
 * 同一条只回一次（`echoSeen`），且**15 分钟内**发生的才算新鲜（避免一开 App 把旧账全翻出来）。
 */
export function queueEchoes(
  moments: readonly Moment[],
  addTask: (t: { prompt: string; at?: number; time?: string; notify?: boolean }) => string,
  upstreamOk = true,
  /**
   * **顺手把这份"互动的料"交给后台**（2026-10）——用户："我发动态他现在能知道并反应吗"。
   * 你互动的那一刻 App 一定是开着的，所以这里把"哪条动态 + 你干了什么"推进抽屉；
   * 之后哪怕你马上关掉 App，他下一次后台醒来（≤60 分钟）也能看到并回应。
   */
  onEcho?: (info: { id: string; what: string }) => void,
): number {
  /** 上游不全 → 不排回响（同上：不装样子做事） */
  if (!upstreamOk) return 0;
  const seen = new Set(kvGetJSON<string[]>(ECHO_SEEN_KEY, []));
  const fresh = 15 * 60_000;
  const now = Date.now();
  let queued = 0;
  const push = (key: string, prompt: string, id: string, what: string) => {
    addTask({ prompt, at: now + 3 * 60_000, notify: true });
    seen.add(key);
    queued += 1;
    try {
      onEcho?.({ id, what });
    } catch {
      /* 推给后台失败不影响前台这条回响 */
    }
  };
  for (const m of moments) {
    if (m.by === "me") {
      const key = `post:${m.id}`;
      const brief = m.text.replace(/\s+/g, " ").slice(0, 60);
      if (!seen.has(key) && now - m.at < fresh) {
        push(key, buildEchoPrompt("post", m, brief), m.id, `他刚发了一条动态：「${brief}」`);
      }
      continue;
    }
    /** 他的动态：看我的评论 / 点赞（`by === "me"`） */
    for (const c of m.comments ?? []) {
      const key = `cmt:${m.id}:${c.at}`;
      const brief = c.text.replace(/\s+/g, " ").slice(0, 40);
      if (c.by === "me" && !seen.has(key) && now - c.at < fresh) {
        push(key, buildEchoPrompt("comment", m, brief), m.id, `他在你的动态下评论了：「${brief}」`);
      }
    }
    for (const l of m.likes ?? []) {
      const key = `like:${m.id}:${l.at}`;
      if (l.by === "me" && !seen.has(key) && now - l.at < fresh) {
        push(key, buildEchoPrompt("like", m, ""), m.id, "他给你的动态点了个赞");
      }
    }
  }
  kvSetJSON(ECHO_SEEN_KEY, [...seen].slice(-100));
  return queued;
}
