import type { ImportantDate } from "@/lib/types";

/** 一天的毫秒数。 */
const DAY = 86400000;

/** 把某个时刻抹成「当天 0 点」。 */
export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** b 比 a 晚多少天（只看日期，不看时分秒）。 */
export function dayDiff(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
}

export type Countdown = {
  /** 距下一个「那天」还有几天；0 = 就是今天 */
  days: number;
  /** 已经过去多少天（一次性日子且过了；否则 0） */
  since: number;
  /** 下一个「那天」的时刻 */
  nextAt: number;
  /** 已经过去几年（年复一年的日子才有用） */
  years: number;
  label: string;
};

/**
 * 算倒数。
 *
 * 这里刻意**全部按「当天 0 点」算**，不碰时分秒 —— 否则同一天里
 * 会因为过了几个小时而差出一天，那是这类功能最经典的一个错。
 *
 * yearly = true（生日、纪念日）：算**下一次**是多久后，另外给出「第几年」。
 * yearly = false（就那一天）：还没到就说「还有 N 天」，过了就说「已经 N 天」。
 */
export function countdown(at: number, yearly: boolean, now = Date.now()): Countdown {
  const today = startOfDay(now);
  const target = startOfDay(at);

  if (!yearly) {
    const diff = dayDiff(today, target);
    if (diff === 0) {
      return { days: 0, since: 0, nextAt: target, years: 0, label: "就是今天" };
    }
    if (diff > 0) {
      return { days: diff, since: 0, nextAt: target, years: 0, label: `还有 ${diff} 天` };
    }
    const past = -diff;
    return { days: 0, since: past, nextAt: target, years: 0, label: `已经 ${past} 天` };
  }

  // 每年重复：今年的那一天；已经过了就挪到明年
  const t = new Date(target);
  const nowY = new Date(today).getFullYear();
  let next = new Date(nowY, t.getMonth(), t.getDate());
  next.setHours(0, 0, 0, 0);
  if (next.getTime() < today) {
    next = new Date(nowY + 1, t.getMonth(), t.getDate());
    next.setHours(0, 0, 0, 0);
  }
  const nextAt = next.getTime();
  const days = dayDiff(today, nextAt);

  // 「第几年」：从原始那天算起，满一年算一年
  let years = 0;
  if (target <= today) {
    years = new Date(nextAt).getFullYear() - new Date(target).getFullYear();
    if (years < 0) years = 0;
  }

  const label = days === 0 ? "就是今天" : `还有 ${days} 天`;
  return { days, since: 0, nextAt, years, label };
}

/** 把一个日子排好序的列表变成「最近的排最前」。 */
export function sortDates(dates: ImportantDate[], now = Date.now()): ImportantDate[] {
  return [...dates].sort((a, b) => {
    const ca = countdown(a.at, a.yearly, now);
    const cb = countdown(b.at, b.yearly, now);
    // 一次性的、已经过去的排最后
    const pa = ca.since > 0 ? 1 : 0;
    const pb = cb.since > 0 ? 1 : 0;
    if (pa !== pb) return pa - pb;
    if (pa === 1) return cb.since - ca.since;
    return ca.days - cb.days;
  });
}
