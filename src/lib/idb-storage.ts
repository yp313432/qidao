import type { StateStorage } from "zustand/middleware";

/**
 * 把 zustand 的持久化从 localStorage 换到 **IndexedDB**。
 *
 * 为什么必须换：localStorage 只有 5~10MB，用户已经用到 8.66MB —— 随时写满，
 * 而写满是**静默失败**（新消息存不进去，界面还不报错）。
 * IndexedDB 的额度是按磁盘算的（用户机器上浏览器给的是 ~131GB），
 * 换算下来大约能装四百万条消息，正常用一辈子也装不满。
 *
 * 顺带一提：这个 App 的音乐本来就存在 IndexedDB 里，所以这不算引入新技术。
 *
 * ── ⚠️ 存档安全网（2026-11 加，起因是一次真实的"数据全没了"）──────────
 *
 * 用户反馈："我的数据包括设置啥的都没了，刚打开就闪退了两次，然后就是全新的界面了。
 * 我又没卸载过，也没有选择清除过数据。"
 *
 * 老实现只有**一份**存档，而且：
 *   · 读不出来就当成"没有存档" → 从空状态开始
 *   · 空状态随后又被写回去 → **原来那份就真没了**
 * 于是"启动时崩一下"这种意外，正好撞在写档的当口，就能吃掉全部数据。
 *
 * 现在三件事：
 *   ① **两份轮换**：覆盖主存档之前，先把"现在这份好的"存进备份格（节流：至少隔 60 秒）
 *   ② **读坏了会自动退到备份**（而不是当没有）
 *   ③ 选哪一份的逻辑抽成**纯函数** `pickSnapshot()`，可以单独验收（见
 *      `verify-store-recovery.mjs`）—— 这种"数据没了"的 bug 不能再靠人肉试
 */

const DB_NAME = "qidao-store";
const STORE_NAME = "kv";

/** 备份格的键名 / 备份时间戳的键名（只对主存档 `aster-app` 做，别的键不动） */
const MAIN_KEY = "aster-app";
const backupKeyOf = (name: string) => `${name}::bak`;
const backupAtOf = (name: string) => `${name}::bak-at`;
/** 备份节流：至少隔这么久才刷新一次备份（避免每次 set 都写两遍大档） */
const BACKUP_MIN_GAP_MS = 60_000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("这个环境没有 IndexedDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("打开 IndexedDB 失败"));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE_NAME, mode);
        const req = fn(t.objectStore(STORE_NAME));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB 操作失败"));
      }),
  );
}

/**
 * 这段文本**像不像一份能用的存档**。
 *
 * zustand 持久化写出来的是 `{"state":{…},"version":n}` —— 所以判据是：
 * 能 JSON.parse、是个对象、而且里面有 `state` 对象。
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

export type SnapshotSource = "main" | "backup" | "legacy" | "none";

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

/** 上一次读档是从哪儿来的（给「开发与纠错/环境自检」显示用） */
export let lastSnapshotSource: SnapshotSource = "none";
/** 主存档坏掉、靠备份救回来的次数（>0 就值得告诉用户） */
export let recoveredFromBackup = false;

/** 备份节流用的内存时间戳（跨启动不记，够用） */
let lastBackupAt = 0;

export const idbStorage: StateStorage = {
  getItem: async (name) => {
    try {
      const main = await tx<string | undefined>("readonly", (s) => s.get(name) as IDBRequest<string | undefined>);
      const backup =
        name === MAIN_KEY
          ? await tx<string | undefined>("readonly", (s) => s.get(backupKeyOf(name)) as IDBRequest<string | undefined>)
          : undefined;
      const legacy = globalThis.localStorage?.getItem(name) ?? null;
      const picked = pickSnapshot({ main, backup, legacy });
      lastSnapshotSource = picked.source;
      /**
       * 主存档"有东西但读不出来"、靠备份救回来 → 记一笔（不静默）。
       * 这也意味着下一步**不能**让空状态覆盖主存档：所以这里立刻把救回来的那份写回主格。
       */
      if (backup !== undefined && !looksLikeSnapshot(main) && picked.source === "backup") {
        recoveredFromBackup = true;
        try {
          await tx("readwrite", (s) => s.put(picked.text ?? "", name) as IDBRequest<IDBValidKey>);
        } catch {
          /* 写不回去也不影响这次能用 */
        }
      }
      return picked.text;
    } catch {
      // 打不开 IndexedDB（隐私模式等）→ 退回 localStorage，至少还能用
      const legacy = globalThis.localStorage?.getItem(name) ?? null;
      const picked = pickSnapshot({ legacy });
      lastSnapshotSource = picked.source;
      return picked.text;
    }
  },

  setItem: async (name, value) => {
    try {
      /** ① 覆盖主存档**之前**，先把"现在这份好的"存进备份格（节流） */
      if (name === MAIN_KEY && looksLikeSnapshot(value)) {
        const now = Date.now();
        if (now - lastBackupAt >= BACKUP_MIN_GAP_MS) {
          const current = await tx<string | undefined>(
            "readonly",
            (s) => s.get(name) as IDBRequest<string | undefined>,
          );
          if (looksLikeSnapshot(current)) {
            await tx("readwrite", (s) => s.put(current as string, backupKeyOf(name)) as IDBRequest<IDBValidKey>);
            await tx("readwrite", (s) => s.put(String(now), backupAtOf(name)) as IDBRequest<IDBValidKey>);
          }
          lastBackupAt = now;
        }
      }
      await tx("readwrite", (s) => s.put(value, name) as IDBRequest<IDBValidKey>);
      // 搬过去之后，把 localStorage 里那份**大块头**删掉，腾出额度
      if (name === MAIN_KEY) globalThis.localStorage?.removeItem(name);
    } catch {
      try {
        globalThis.localStorage?.setItem(name, value);
      } catch {
        /* 两边都写不进去就只能这样了 */
      }
    }
  },

  removeItem: async (name) => {
    try {
      await tx("readwrite", (s) => s.delete(name) as IDBRequest<undefined>);
      if (name === MAIN_KEY) {
        await tx("readwrite", (s) => s.delete(backupKeyOf(name)) as IDBRequest<undefined>);
        await tx("readwrite", (s) => s.delete(backupAtOf(name)) as IDBRequest<undefined>);
      }
    } catch {
      /* ignore */
    }
    globalThis.localStorage?.removeItem(name);
  },
};

/** 备份是什么时候的（「我的 → 数据」上显示"上次自动备份：X 前"用） */
export async function backupAt(): Promise<number> {
  try {
    const v = await tx<string | undefined>(
      "readonly",
      (s) => s.get(backupAtOf(MAIN_KEY)) as IDBRequest<string | undefined>,
    );
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}

/** 现在数据到底占多少（给「我的 → 存储」显示用） */
export async function idbUsage(): Promise<{ bytes: number; quota: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est) return null;
    return { bytes: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}
