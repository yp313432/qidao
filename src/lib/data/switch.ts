/**
 * **存储开关**（PH3）—— "用新存储"这件事的**唯一开关**，默认关。
 *
 * 为什么开关不放在 App 的存档里：存档本身就要靠这个开关决定"从哪儿读"，
 * 写进去就成了先有鸡还是先有蛋。所以它**单独放一个小键**（`localStorage`），
 * 在建立 store 之前就能读到。
 *
 * 纪律（§12）：
 *   · 默认**关** → 老路（`qidao-store/kv/aster-app`）照旧，现有数据一个字节不动
 *   · 打开时**先把老档搬进新库**（只读老档 + 守恒校验），再切
 *   · **切回去随时可以**：老档还在；切换期间在新库写的东西不会丢（切回来还在）
 */
import { migrateOldArchiveToNewStore, peekOldArchive } from "./adapter";

/** 开关存哪儿（故意跟 App 存档分开） */
const FLAG_KEY = "qidao:storage-v2";
/** 搬用结果留个记号，界面能显示"上次搬了多少" */
const MIGRATED_KEY = "qidao:storage-v2-migrated";

export type StorageMode = "legacy" | "v2";

/** 现在用的是哪套（在建立 store 之前就能问） */
export function storageMode(): StorageMode {
  try {
    return globalThis.localStorage?.getItem(FLAG_KEY) === "1" ? "v2" : "legacy";
  } catch {
    return "legacy";
  }
}

export function isV2(): boolean {
  return storageMode() === "v2";
}

/** 记一下"上次搬家"的结果（给界面看） */
export type MigratedNote = { at: number; ok: boolean; why?: string; moved?: Record<string, number> };

export function readMigratedNote(): MigratedNote | null {
  try {
    const raw = globalThis.localStorage?.getItem(MIGRATED_KEY);
    return raw ? (JSON.parse(raw) as MigratedNote) : null;
  } catch {
    return null;
  }
}

function writeMigratedNote(note: MigratedNote) {
  try {
    globalThis.localStorage?.setItem(MIGRATED_KEY, JSON.stringify(note));
  } catch {
    /* ignore */
  }
}

/**
 * 打开新存储：**先搬家，搬成功了再切**。
 *
 * ⚠️ 顺序很重要：
 *   1. 新库已经有东西（比如之前用过）→ 不重复搬，直接切
 *   2. 新库是空的 → 搬老档；**搬失败就不切**（宁可继续用老路，也不进一个空库）
 */
export async function enableV2(): Promise<{ ok: boolean; why?: string; moved?: Record<string, number> }> {
  const { newStoreIsEmpty } = await import("./adapter");
  const empty = await newStoreIsEmpty();
  if (!empty) {
    try {
      globalThis.localStorage?.setItem(FLAG_KEY, "1");
    } catch {
      return { ok: false, why: "写不进开关（浏览器存储被禁？）" };
    }
    return { ok: true, why: "新库已经有数据，直接切（没有重复搬家）" };
  }
  const res = await migrateOldArchiveToNewStore();
  if (!res.ok) {
    writeMigratedNote({ at: Date.now(), ok: false, why: res.why });
    return { ok: false, why: res.why };
  }
  try {
    globalThis.localStorage?.setItem(FLAG_KEY, "1");
  } catch {
    return { ok: false, why: "写不进开关（浏览器存储被禁？）" };
  }
  const moved: Record<string, number> = {};
  for (const [k, v] of Object.entries(res.report?.counts ?? {})) moved[k] = v.after;
  writeMigratedNote({ at: Date.now(), ok: true, moved });
  return { ok: true, moved };
}

/** 切回老路（**不删任何东西**：新库里写的还在，下次再打开就回来了） */
export function disableV2(): void {
  try {
    globalThis.localStorage?.removeItem(FLAG_KEY);
  } catch {
    /* ignore */
  }
}

/** 切之前给用户看的"将要搬多少" */
export async function previewMigration(): Promise<Record<string, number> | null> {
  const report = await peekOldArchive();
  if (!report) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(report.counts)) out[k] = v.before;
  return out;
}
