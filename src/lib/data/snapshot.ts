/**
 * **该用哪一份存档**（纯函数，零依赖）—— 从 `idb-storage.ts` 里分出来单独放这儿。
 *
 * 为什么分出来：这几个函数是"数据丢失"那件事的核心判据，必须能被**单独验收**
 * （`verify-store-recovery.mjs`）。原来它们跟 `idb-storage.ts` 混在一起，
 * 而那个文件会 `import "@/lib/data/switch"` → 纯 node 里要装别名钩子，容易出岔子。
 *
 * 规矩见 `qidao-docs/UI统一规范.md` §12.0 铁律 1：**读失败 ≠ 空数据**。
 *
 * 2026-11 性能排查：**一份存档只 parse 一次**。原来"判断像不像"里 parse 完就把
 * 结果扔了，真正要用的时候再 parse 一遍；主档在 IDB 里是几 MB 的 JSON 文本，
 * 手机上一次 parse 是几百毫秒级 —— 启动时白做三四遍。现在判据和结果共用同一次 parse。
 */

export type SnapshotSource = "main" | "backup" | "legacy" | "none";

/** zustand 持久化的形状：`{"state":{…},"version":n}` */
export type SnapshotParsed = { state: Record<string, unknown>; version?: unknown };

/**
 * 把存档文本 parse 成对象；**坏了返回 null**。
 *
 * 判据：能 JSON.parse、是个对象、里面有 `state` 对象。
 * （空字符串 / 半截 JSON / `null` / 数组 都判为坏。）
 */
export function parseSnapshot(text: string | null | undefined): SnapshotParsed | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    /** ⚠️ `typeof null === "object"` —— 所以必须单独排掉 null，否则 `{"state":null}` 会被当成好档 */
    const state = (parsed as { state?: unknown }).state;
    if (typeof state !== "object" || state === null) return null;
    return parsed as SnapshotParsed;
  } catch {
    return null;
  }
}

/**
 * 这段文本**像不像一份能用的存档**（判据见 `parseSnapshot`）。
 */
export function looksLikeSnapshot(text: string | null | undefined): boolean {
  return parseSnapshot(text) !== null;
}

/**
 * **该用哪一份存档**（纯函数，验收直接跑它）。
 *
 * 顺序：主存档 → 备份 → localStorage 老数据 → 没有。
 * 主存档"存在但读不出来"时**绝不当成"没有"** —— 那正是数据被空档覆盖的入口。
 *
 * `parsed` 就是选中的那份 parse 好的对象，调用方直接用，别再 parse 一次。
 */
export function pickSnapshot(input: {
  main?: string | null;
  backup?: string | null;
  legacy?: string | null;
}): { text: string | null; source: SnapshotSource; parsed: SnapshotParsed | null } {
  const mainParsed = parseSnapshot(input.main);
  if (mainParsed) return { text: input.main ?? null, source: "main", parsed: mainParsed };
  const backupParsed = parseSnapshot(input.backup);
  if (backupParsed) return { text: input.backup ?? null, source: "backup", parsed: backupParsed };
  const legacyParsed = parseSnapshot(input.legacy);
  if (legacyParsed) return { text: input.legacy ?? null, source: "legacy", parsed: legacyParsed };
  return { text: null, source: "none", parsed: null };
}
