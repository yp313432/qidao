/** 相对时间小工具：「此刻的情况」那几行小字要用（「3 分钟前」）。 */

/** 「此刻的情况」那几行小字要用到的相对时间。 */
export function relShort(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
