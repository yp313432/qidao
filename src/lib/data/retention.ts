/**
 * 运行记录的**保留上限**（D5，用户 2026-10 拍板）。
 *
 * 用户原话："动作记录一天一清，或者两百自动清。"
 * （我原来的文档写"只增不减"是**错的** —— 核实后发现旧代码已经有上限：
 *   动作记录 30 条 / 7 天、请求记录 40 条。所以这里不是"加个上限"，是**按用户口径调整**。）
 *
 * ⚠️ 这两类属于"**可重算运行态**"：丢了不影响用户资产（见 §12.2 三档）。
 * 清理放在**写入时顺手做**，不另起定时器（省电，也不会因为"没打开 App"就永远不清）。
 */

/** 动作记录：最多留这么多条 */
export const ACTION_LOG_MAX = 200;
/** 动作记录：超过一天的就清 */
export const ACTION_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 请求记录：最多留这么多条 */
export const REQUEST_LOG_MAX = 500;

/** 动作记录：先按时间滤，再按条数截（两个条件谁的更严听谁的） */
export function trimActionLog<T extends { at: number }>(list: T[], now = Date.now()): T[] {
  return list.filter((e) => now - e.at < ACTION_LOG_MAX_AGE_MS).slice(0, ACTION_LOG_MAX);
}

/** 请求记录：只按条数截 */
export function trimRequestLog<T>(list: T[], now = Date.now()): T[] {
  void now;
  return list.slice(0, REQUEST_LOG_MAX);
}

/** 追加一条并顺手清理（调用方不用自己记规矩） */
export function pushActionLog<T extends { at: number }>(list: T[], entry: T, now = Date.now()): T[] {
  return trimActionLog([entry, ...list], now);
}
export function pushRequestLog<T extends { at: number }>(list: T[], entry: T, now = Date.now()): T[] {
  return trimRequestLog([entry, ...list], now);
}
