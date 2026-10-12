/**
 * **该用哪一份存档**（纯函数，零依赖）—— 从 `idb-storage.ts` 里分出来单独放这儿。
 *
 * 为什么分出来：这几个函数是"数据丢失"那件事的核心判据，必须能被**单独验收**
 * （`verify-store-recovery.mjs`）。原来它们跟 `idb-storage.ts` 混在一起，
 * 而那个文件会 `import "@/lib/data/switch"` → 纯 node 里要装别名钩子，容易出岔子。
 *
 * 规矩见 `qidao-docs/UI统一规范.md` §12.0 铁律 1：**读失败 ≠ 空数据**。
 */

export type SnapshotSource = "main" | "backup" | "legacy" | "none";

/**
 * 这段文本**像不像一份能用的存档**。
 *
 * zustand 持久化写出来的是 `{"state":{…},"version":n}` —— 判据是：
 * 能 JSON.parse、是个对象、里面有 `state` 对象。
 * （空字符串 / 半截 JSON / `null` 都判为坏。）
 */
export function looksLikeSnapshot(text: string | null | undefined): boolean {
  if (typeof text !== "string" || text.trim().length === 0) return false;
  try {
    const parsed = JSON.parse(text) as { state?: unknown };
    /** ⚠️ `typeof null === "object"` —— 所以必须单独排掉 null，否则 `{"state":null}` 会被当成好档 */
    return Boolean(parsed) && typeof parsed === "object" && typeof parsed.state === "object" && parsed.state !== null;
  } catch {
    return false;
  }
}

/**
 * **该用哪一份存档**（纯函数，验收直接跑它）。
 *
 * 顺序：主存档 → 备份 → localStorage 老数据 → 没有。
 * 主存档"存在但读不出来"时**绝不当成"没有"** —— 那正是数据被空档覆盖的入口。
 */
export function pickSnapshot(input: {
  main?: string | null;
  backup?: string | null;
  legacy?: string | null;
}): { text: string | null; source: SnapshotSource } {
  if (looksLikeSnapshot(input.main)) return { text: input.main ?? null, source: "main" };
  if (looksLikeSnapshot(input.backup)) return { text: input.backup ?? null, source: "backup" };
  if (looksLikeSnapshot(input.legacy)) return { text: input.legacy ?? null, source: "legacy" };
  return { text: null, source: "none" };
}
