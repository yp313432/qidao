import { cancelNative, scheduleNative } from "@/lib/notify";
import type { ScheduledTask } from "@/lib/types";

/**
 * **定时任务的原生通知**（用户 m10397："定了七点半叫醒，但是我不打开 app，
 * 手机也不弹通知，点开后才能反应"）。
 *
 * 真相：`components/task-daemon.tsx` 是**纯前台 JS**（`window.setInterval`）——
 * App 一关，WebView 被系统停掉，定时任务就没人跑了，也不会弹任何东西。
 * 以前只有「提醒 / 闹钟」排了原生通知（`reminder-daemon.tsx`），**任务从来没排过**。
 *
 * 所以这里补上：任务存下来的时候，就往系统闹钟里排一条通知。
 *   · 每天几点（`time = "HH:MM"`）→ 每天重复
 *   · 一次性（`at = 时间戳`）→ 只响一次，过去的不排
 *
 * 点通知 → 打开 App → `TaskDaemon` 的 tick 立刻发现"这个任务到点且今天没跑过"
 * → 才真的去问他一句、把话落进对话。**通知只负责"叫醒 App"，正文仍然由他现说**：
 * 提前把话写好塞在通知里，等于"他还没说你就先替他写了"。
 *
 * 安静时段（23:00–07:00）不排：`TaskDaemon` 在这个时段本来就不说话，
 * 排了只会半夜响一声、点开却什么都没有。
 */

/** 字符串 id → 稳定正整数（原生通知只认数字），跟 `actions.ts` / `reminder-daemon` 同一套 */
function hashId(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 2147483000;
  return h || 1;
}

const MARK_KEY = "qidao:task-notified";
const QUIET_FROM = 23;
const QUIET_TO = 7;

function readMarked(): number[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(MARK_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

function writeMarked(ids: number[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MARK_KEY, JSON.stringify(ids));
  } catch {
    /* 存不下就下次再算子集 */
  }
}

/**
 * 同步一次（幂等）：把"该响的任务"排进系统，把"不再需要的"撤掉。
 *
 * @returns 真的排上了几条（网页版恒为 0）
 */
export async function syncTaskNotifications(tasks: ScheduledTask[]): Promise<number> {
  const now = Date.now();
  const want: { id: number; task: ScheduledTask }[] = [];

  for (const t of tasks) {
    if (!t.enabled) continue;
    if (!t.time && !t.at) continue;
    if (t.at && t.at <= now) continue; // 一次性且已过期：不用排（补发由前台 tick 判断）
    if (t.time) {
      const [h, m] = t.time.split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
      if (h! >= QUIET_FROM || h! < QUIET_TO) continue;
    } else if (t.at) {
      const h = new Date(t.at).getHours();
      if (h >= QUIET_FROM || h < QUIET_TO) continue;
    }
    want.push({ id: hashId(t.id), task: t });
  }

  const wantIds = want.map((w) => w.id);
  const old = readMarked();
  for (const id of old) {
    if (!wantIds.includes(id)) await cancelNative(id);
  }

  let ok = 0;
  for (const w of want) {
    const t = w.task;
    /** 通知上**不摊任务原文**：锁屏上的字是给别人看的，只说到"有事"为止 */
    const body = t.time
      ? "他按时醒了，点开看看他想跟你说什么"
      : "他有件事想跟你说，点开看看";
    if (t.time) {
      const [h, m] = t.time.split(":").map(Number);
      const done = await scheduleNative({
        id: w.id,
        title: "栖岛",
        body,
        daily: { hour: h!, minute: m! },
        sound: true,
      });
      if (done) ok += 1;
    } else if (t.at) {
      const done = await scheduleNative({
        id: w.id,
        title: "栖岛",
        body,
        at: new Date(t.at),
        sound: true,
      });
      if (done) ok += 1;
    }
  }
  writeMarked(wantIds);
  return ok;
}
