export function greetingFor(name: string, at = new Date()): string {
  const h = at.getHours();
  const who = name.trim() || "there";
  if (h < 5) return `还没睡吗, ${who}`;
  if (h < 11) return `早上好, ${who}`;
  if (h < 14) return `中午好, ${who}`;
  if (h < 18) return `下午好, ${who}`;
  if (h < 22) return `晚上好, ${who}`;
  return `夜深了, ${who}`;
}

export function resetLabel(ts: number): string {
  const d = new Date(ts);
  return `重置于 ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}
