/**
 * **备份 / 恢复的读写口**（PH4）—— 唯一一处碰"整块存档"的地方。
 *
 * 为什么必须重做（2026-10 查出来的真 bug）：
 *   `lib/backup.ts` 原来直接读写 **localStorage 的 `aster-app`**。可是从换 IndexedDB 那天起，
 *   那份 localStorage 副本在**第一次写入后就被删掉了**（见 `idb-storage.ts` 的 setItem）——
 *   也就是说它平时是空的：
 *     · 备份页显示的"有多少东西"读的是空副本（数字不对）
 *     · **"恢复备份"写进去的东西，会被 IndexedDB 里那份盖掉 → 恢复根本没生效**
 *   （数据没丢，但用户以为自己恢复了 ✗）
 *
 * 现在的口径（§12）：
 *   · **读**：按当前存储模式读真源（新库 → `adapter`；老存储 → `idb-storage`，它读的就是 IndexedDB）
 *   · **写**：先**自动留一份"恢复前"的快照**（`aster-app::pre-restore-<时间>`），再写
 *   · 写入前**必须**通过 `looksLikeSnapshot`（半截 JSON / 空串一律拒绝）
 */
import { looksLikeSnapshot } from "./snapshot";

const MAIN_KEY = "aster-app";
const PRE_RESTORE_PREFIX = "aster-app::pre-restore-";

function isV2(): boolean {
  try {
    return globalThis.localStorage?.getItem("qidao:storage-v2") === "1";
  } catch {
    return false;
  }
}

export type SnapshotRead =
  | { ok: true; json: string | null; from: "new-store" | "legacy" }
  | { ok: false; why: string };

/** 读当前这份完整的存档（导出用）。**绝不把"读失败"当成"没有数据"** */
export async function readSnapshotForBackup(): Promise<SnapshotRead> {
  if (isV2()) {
    const { loadLegacyShaped } = await import("./adapter");
    const r = await loadLegacyShaped();
    if (!r.ok) return { ok: false, why: r.why };
    return { ok: true, json: r.value ?? null, from: "new-store" };
  }
  const { idbStorage } = await import("@/lib/idb-storage");
  try {
    const json = await idbStorage.getItem(MAIN_KEY);
    return { ok: true, json: json ?? null, from: "legacy" };
  } catch (e) {
    return { ok: false, why: String((e as Error)?.message ?? e) };
  }
}

/**
 * 把一份备份写回去（恢复）。
 *
 * 顺序：**先留证再写**（§12.0 铁律 3）：
 *   ① 校验备份是不是能用的存档
 *   ② 把**现状**存成 `aster-app::pre-restore-<时间>`（万一恢复错了还能翻回去）
 *   ③ 按当前存储模式写：新库 → `saveLegacyShaped`；老存储 → `idbStorage.setItem`
 */
export async function writeSnapshotFromBackup(json: string): Promise<{ ok: true; preRestoreKey: string } | { ok: false; why: string }> {
  if (!looksLikeSnapshot(json)) {
    return { ok: false, why: "这份备份不是能用的存档（半截 JSON 或空内容）" };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const preRestoreKey = `${PRE_RESTORE_PREFIX}${stamp}`;

  /** ② 留证：把现状抄一份（读不到就算了，但**不能因此不写**） */
  try {
    const current = await readSnapshotForBackup();
    if (current.ok && current.json) {
      if (current.from === "legacy") {
        const { idbStorage } = await import("@/lib/idb-storage");
        await idbStorage.setItem(preRestoreKey, current.json);
      } else {
        const { writeRecord } = await import("./db");
        const { TABLES } = await import("./schema");
        await writeRecord(TABLES.meta, { key: preRestoreKey, at: Date.now(), json: current.json }, preRestoreKey);
      }
    }
  } catch {
    /* 留证失败不挡恢复 */
  }

  /** ③ 写回 */
  if (isV2()) {
    const { saveLegacyShaped } = await import("./adapter");
    const r = await saveLegacyShaped(json);
    return r.ok ? { ok: true, preRestoreKey } : { ok: false, why: r.why };
  }
  const { idbStorage } = await import("@/lib/idb-storage");
  try {
    await idbStorage.setItem(MAIN_KEY, json);
    return { ok: true, preRestoreKey };
  } catch (e) {
    return { ok: false, why: String((e as Error)?.message ?? e) };
  }
}
