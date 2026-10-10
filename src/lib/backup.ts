/**
 * 备份：把整个 App 的状态导出成一个文件，也能导回来。
 *
 * 直接用 localStorage 里 zustand 持久化的那一份 —— **不手写字段清单**。
 * 手写清单的话，以后每加一个新功能都要记得往清单里补一笔，早晚漏。
 *
 * 两件必须说清楚的事：
 *   1. **导出时会清掉密钥**（递归扫字段名，不管是现在的 customApiKey、
 *      还是以后新加的别的 key）—— 备份文件可能被你发给自己、存到云盘，
 *      里面带着 API key 是最危险的一种"顺手"。
 *   2. **音乐文件不在里面**。歌存在 IndexedDB 里（可能有几百 MB），
 *      塞进 JSON 会变成一个打不开的巨型文件。导出的是"歌单信息"，
 *      换设备后要重新导入音乐文件。
 */

const STORE_KEY = "aster-app";

/** 只要字段名撞上这些，值又是非空字符串，就在导出时清空。 */
const SECRET_KEYS = [
  "customapikey",
  "apikey",
  "api_key",
  "headerstext",
  "authorization",
  "token",
  "password",
  "secret",
  "cookie",
];

export type Backup = {
  kind: "qidao-backup";
  version: 1;
  exportedAt: number;
  /** 被清掉的密钥字段个数（导出时记账，导入时展示） */
  redacted: number;
  app: Record<string, unknown>;
};

export type Counts = {
  conversations: number;
  messages: number;
  diary: number;
  moments: number;
  letters: number;
  todos: number;
  dates: number;
  memories: number;
  musicEmbeds: number;
  reminders: number;
  /** 表情库（带分组那版）的张数 */
  stickerLib: number;
  /** 表情分组数 */
  stickerGroups: number;
};

/** 递归清掉密钥字段，顺便数一下清了几处。 */
function scrub(node: unknown, hits: string[]): unknown {
  if (Array.isArray(node)) return node.map((v) => scrub(v, hits));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (SECRET_KEYS.includes(k.toLowerCase()) && typeof v === "string" && v.trim()) {
        hits.push(k);
        out[k] = "";
        continue;
      }
      out[k] = scrub(v, hits);
    }
    return out;
  }
  return node;
}

/** 数一数现在有什么 —— 界面和备份说明都用它。 */
export function countData(app: Record<string, unknown>): Counts {
  const arr = (k: string) => (Array.isArray(app[k]) ? (app[k] as unknown[]).length : 0);
  const convs = Array.isArray(app.conversations) ? (app.conversations as { messages?: unknown[] }[]) : [];
  return {
    conversations: convs.length,
    messages: convs.reduce((n, c) => n + (Array.isArray(c.messages) ? c.messages.length : 0), 0),
    diary: arr("diary"),
    moments: arr("moments"),
    letters: arr("letters"),
    todos: arr("todos"),
    dates: arr("dates"),
    memories: arr("memories"),
    musicEmbeds: arr("musicEmbeds"),
    reminders: arr("reminders"),
    stickerLib: arr("stickerLib"),
    stickerGroups: arr("stickerGroups"),
  };
}

/** 现在这份数据（不含密钥）。界面上显示"有多少东西"用它。 */
export function currentData(): Record<string, unknown> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as { state?: Record<string, unknown> };
    return raw.state ?? {};
  } catch {
    return {};
  }
}

export function countOf(items: Record<string, unknown>, ...keys: string[]): number {
  return keys.reduce((n, k) => n + (Array.isArray(items[k]) ? (items[k] as unknown[]).length : 0), 0);
}

/** 生成备份文件内容。 */
export function buildBackup(): { json: string; filename: string; bytes: number; redacted: number; counts: Counts } {
  const state = currentData();
  const hits: string[] = [];
  const clean = scrub(state, hits) as Record<string, unknown>;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

  const backup: Backup = {
    kind: "qidao-backup",
    version: 1,
    exportedAt: Date.now(),
    redacted: hits.length,
    app: clean,
  };
  const json = JSON.stringify(backup, null, 2);
  return {
    json,
    filename: `栖岛备份-${stamp}.json`,
    bytes: new Blob([json]).size,
    redacted: hits.length,
    counts: countData(clean),
  };
}

/** 触发浏览器下载。 */
export function downloadBackup() {
  const r = buildBackup();
  const url = URL.createObjectURL(new Blob([r.json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = r.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  return r;
}

export type Parsed = {
  ok: boolean;
  error?: string;
  backup?: Backup;
  counts?: Counts;
};

/** 读一个备份文件的内容（先解析、给用户看，再决定要不要覆盖）。 */
export function parseBackup(text: string): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "这不是一个 JSON 文件（可能选错文件了）" };
  }
  const b = data as Partial<Backup>;
  if (!b || typeof b !== "object" || b.kind !== "qidao-backup" || !b.app) {
    return { ok: false, error: "这不是栖岛的备份文件（缺少 qidao-backup 标记）" };
  }
  return { ok: true, backup: b as Backup, counts: countData(b.app) };
}

/** 真写进去。写完要刷新页面，store 才会读到新数据。 */
export function applyBackup(backup: Backup): void {
  localStorage.setItem(STORE_KEY, JSON.stringify({ state: backup.app, version: 1 }));
  window.location.reload();
}

/** 把字节数说成人话。 */
export function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
