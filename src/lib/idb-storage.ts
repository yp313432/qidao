import type { PersistStorage, StateStorage, StorageValue } from "zustand/middleware";
import { looksLikeSnapshot, pickSnapshot, type SnapshotSource } from "@/lib/data/snapshot";
import { storageMode } from "@/lib/data/switch";

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
/** 读不出来的那份主存档会被挪到这个键留证（见 getItem） */
const corruptKeyOf = (name: string) => `${name}::corrupt`;
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
 * 判"像不像一份能用的存档" + "该用哪一份" —— 本体搬到了 `lib/data/snapshot.ts`
 * （纯函数、零依赖，好单独验收）；这里**再导出**，别的文件照旧从这儿拿。
 */
export { looksLikeSnapshot, pickSnapshot } from "@/lib/data/snapshot";
export type { SnapshotSource } from "@/lib/data/snapshot";

/** 上一次读档是从哪儿来的（给自检页显示用） */
export let lastSnapshotSource: SnapshotSource = "none";
/** 主存档坏掉、靠备份救回来的次数（>0 就值得告诉用户） */
export let recoveredFromBackup = false;
/**
 * **这次启动没能读到主存档** —— 见 `setItem` 里的保护：读失败就**暂停自动保存**，
 * 免得拿一份（可能空的）状态把老记录盖掉。（2026-11 真机"数据全没了"那件事的根治。）
 */
export let readFailedThisSession = false;
/** 因为上面那条保护而跳过写入的次数（界面可以如实告诉用户） */
export let skippedWrites = 0;

/** 备份节流用的内存时间戳（跨启动不记，够用） */
let lastBackupAt = 0;

export const idbStorage: StateStorage = {
  getItem: async (name) => {
    /**
     * **PH3：开关打开时走新存储**（一个库多张表、单条写）。
     * 默认是关的 —— 没打开时下面那条老路一字未改。
     * 读失败**先记 `readFailedThisSession` 再返回 null**，于是 `setItem` 会拒绝写入
     * （"读不到就别写"，见 §12.4）。
     */
    if (name === MAIN_KEY && storageMode() === "v2") {
      try {
        const { loadLegacyShaped } = await import("@/lib/data/adapter");
        const r = await loadLegacyShaped();
        if (!r.ok) {
          readFailedThisSession = true;
          return null;
        }
        lastSnapshotSource = "main";
        return r.value ?? null;
      } catch {
        readFailedThisSession = true;
        return null;
      }
    }
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
      /**
       * 主存档**存在但读不出来**、而且备份也不顶用 → 先把那份坏档**挪到一边留证**
       * （`aster-app::corrupt`），再让 App 继续跑。这样"写坏"这件事不会静默丢东西，
       * 以后还能拿出来看是坏在哪一步。
       */
      if (typeof main === "string" && main.length > 0 && !looksLikeSnapshot(main) && picked.source !== "main") {
        try {
          const already = await tx<string | undefined>(
            "readonly",
            (s) => s.get(corruptKeyOf(name)) as IDBRequest<string | undefined>,
          );
          if (!already) {
            await tx("readwrite", (s) => s.put(main, corruptKeyOf(name)) as IDBRequest<IDBValidKey>);
          }
        } catch {
          /* 留证失败不影响主流程 */
        }
      }
      return picked.text;
    } catch {
      /**
       * ⚠️ **IndexedDB 这次读不了**（打不开 / 事务失败）—— 关键：**别把这个当成"没有存档"**。
       * 老实现就是把它当成"没有"，于是从空状态开始，空状态随后又被写回主格 → 真没了。
       * 现在：标记一下，`setItem` 会**暂停自动保存**，老记录原样留着。
       */
      readFailedThisSession = true;
      const legacy = globalThis.localStorage?.getItem(name) ?? null;
      const picked = pickSnapshot({ legacy });
      lastSnapshotSource = picked.source;
      return picked.text;
    }
  },

  setItem: async (name, value) => {
    /**
     * **PH3：开关打开时写新存储**（只写变了的行 —— 改一条消息只写一条）。
     * ⚠️ 写在"读失败保护"**之前**：那条保护是针对老路径的覆盖风险；
     * 新存储自己有一套（`guardWrite`）。
     */
    if (name === MAIN_KEY && storageMode() === "v2") {
      try {
        const { saveLegacyShaped } = await import("@/lib/data/adapter");
        await saveLegacyShaped(value);
      } catch {
        /* 新存储写失败：不悄悄落到 localStorage（那会跟新库分叉） */
      }
      return;
    }
    /**
     * 这次启动没读到存档 → **绝不写入**。
     * 宁可让这次会话的新消息只留在内存里，也不能拿一份（可能空的）状态把老记录盖掉。
     */
    if (name === MAIN_KEY && readFailedThisSession) {
      skippedWrites += 1;
      return;
    }
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

/**
 * **给 zustand 用的存储层：对象进、对象出**（2026-10，真机"执行情绪动作卡死 6.8 秒"的修复）。
 *
 * ── 原来那条路为什么慢（真机痕迹为证）─────────────────────────────
 * 用户报"报一下情绪就卡退"，面包屑里是
 *   `long 主线程堵了 6788ms（当时：执行动作 emotion_report）`
 *   `long 主线程堵了 809ms（当时：执行动作 emotion_lexicon）`
 * 而**堆内存只有 10MB** —— 不是内存，是主线程被占住。
 *
 * 根因：**每一次状态变化**（流式吐字、动作结果、随便点一下）都要
 *   ① `createJSONStorage` 把**整份状态序列化**成字符串
 *   ② 我们这边 `JSON.parse` **再解析回来**
 *   ③ 搬家（`planMigration` 走全量）+ 守恒报告（`roundTrip` + 每类校验和）
 *   ④ 逐行算校验和决定写哪些行
 * 数据小的时候 15~35ms；用户那份（背景图 / 表情包都是 base64，几 MB）在手机上就是**秒级**。
 * ③ 里那遍守恒报告已经在 `planMigration` 里按需关掉了（平时保存不需要它）；
 * 这里再省掉 ①②：**zustand 直接把对象交过来**（`PersistStorage` 本来就是对象接口）。
 *
 * ── 顺带：写入合并（1 秒一次）────────────────────────────────────
 * 一次流式回复会触发几十次状态变化 —— 每次都真写库没必要。
 * 现在合并成"1 秒一次 + 关键时机立刻落盘"（退到后台 / 页面卸载 / 手动 `commit`）。
 * 代价就是**最多丢最后 1 秒的改动**，跟原来"崩了丢最后一条"同一量级；
 * 换来的是手机上不再因为写库而卡死（这个代价用户已经付过三次了）。
 */
const PERSIST_COALESCE_MS = 1000;

export function createQidaoPersistStorage<S = unknown>(): PersistStorage<S> {
  let pending: { name: string; value: StorageValue<S> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const writeNow = async (name: string, value: StorageValue<S>): Promise<void> => {
    if (name === MAIN_KEY && storageMode() === "v2") {
      try {
        const { saveLegacyShapedObject } = await import("@/lib/data/adapter");
        await saveLegacyShapedObject(value);
      } catch {
        /* 新存储写失败：不悄悄落到 localStorage（那会跟新库分叉） */
      }
      return;
    }
    /** 老路径（`aster-app` 一整块 JSON）还是要字符串 —— IDB 里那份本来就是 JSON 文本 */
    try {
      await idbStorage.setItem(name, JSON.stringify(value));
    } catch {
      /* 见上面：两边都写不进去就只能这样了 */
    }
  };

  const flush = (): void => {
    timer = null;
    const p = pending;
    pending = null;
    if (p) void writeNow(p.name, p.value);
  };

  /** 立刻落盘（退到后台 / 页面卸载时调；别让最后 1 秒的改动丢了） */
  const commit = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    flush();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") commit();
    });
    window.addEventListener("pagehide", commit);
  }

  return {
    getItem: async (name) => {
      const raw = await idbStorage.getItem(name);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (!timer) timer = setTimeout(flush, PERSIST_COALESCE_MS);
    },
    removeItem: async (name) => {
      pending = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await idbStorage.removeItem(name);
    },
  };
}

/** 备份是什么时候的（「我的 → 数据」上显示"上次自动备份：X 前"用） */
export async function backupAt(): Promise<number> {  try {
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
