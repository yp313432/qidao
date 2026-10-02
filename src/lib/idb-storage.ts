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
 */

const DB_NAME = "qidao-store";
const STORE_NAME = "kv";

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

export const idbStorage: StateStorage = {
  getItem: async (name) => {
    try {
      const v = await tx<string | undefined>("readonly", (s) => s.get(name) as IDBRequest<string | undefined>);
      if (v != null) return v;
      /**
       * IndexedDB 里还没有 → 看看 localStorage 那份老数据。
       *
       * 必须做这一步：换存储之后，老用户的记录还躺在 localStorage 里，
       * 不搬的话更新完 App 会显示"全空了"（用户以为记录没了）。
       * 读到就返回，之后的第一次保存会自动把它写进 IndexedDB，
       * 并顺手删掉 localStorage 那份（见下面的 setItem）。
       */
      return globalThis.localStorage?.getItem(name) ?? null;
    } catch {
      // 打不开 IndexedDB（隐私模式等）→ 退回 localStorage，至少还能用
      return globalThis.localStorage?.getItem(name) ?? null;
    }
  },
  setItem: async (name, value) => {
    try {
      await tx("readwrite", (s) => s.put(value, name) as IDBRequest<IDBValidKey>);
      // 搬过去之后，把 localStorage 里那份**大块头**删掉，腾出额度
      if (name === "aster-app") globalThis.localStorage?.removeItem(name);
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
    } catch {
      /* ignore */
    }
    globalThis.localStorage?.removeItem(name);
  },
};

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
