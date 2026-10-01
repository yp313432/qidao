/**
 * 本地音乐库：把用户选的音频文件存进 IndexedDB。
 *
 * 浏览器里 Blob URL 一刷新就失效，所以必须把文件本身存下来，
 * 这样下次打开还在（离线可用）。全部只在这台设备上，不会上传。
 *
 * 另外做了一层内存兜底：IndexedDB 在隐私模式、配额不足、被策略禁用时
 * 会直接抛错。以前这里没兜住，会导致「选完文件什么都不发生」。
 * 现在统一降级为「本次会话内存保存」，并让调用方拿到明确结果。
 */

const DB_NAME = "qidao-music";
const STORE = "tracks";
const VERSION = 1;

export type LyricsSource = "embedded" | "manual" | "none" | "online";

export type MusicTrack = {
  id: string;
  name: string;
  size: number;
  type: string;
  addedAt: number;
  blob: Blob;
  /** LRC 文本或纯文本歌词 */
  lyrics: string;
  lyricsSource: LyricsSource;
};

/** 本次会话的内存副本（也是 IndexedDB 不可用时的唯一存储）。 */
const memory = new Map<string, MusicTrack>();
let dbBroken = false;

function markBroken(err: unknown) {
  if (dbBroken) return;
  dbBroken = true;
  console.warn("[music] IndexedDB 不可用，改为仅本次会话保存在内存：", err);
}

/** 持久化是否可用（UI 可据此提示「本次会话有效」）。 */
export function isPersistent(): boolean {
  return !dbBroken;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB 不可用"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("打开数据库失败"));
    req.onblocked = () => reject(new Error("数据库被占用"));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error("数据库操作失败"));
        t.onabort = () => reject(t.error ?? new Error("数据库事务中断"));
      }),
  );
}

export async function listTracks(): Promise<MusicTrack[]> {
  if (dbBroken) return [...memory.values()];
  try {
    const rows = await run<MusicTrack[]>("readonly", (s) => s.getAll());
    for (const r of rows) memory.set(r.id, r);
    return rows;
  } catch (err) {
    markBroken(err);
    return [...memory.values()];
  }
}

export async function putTrack(track: MusicTrack): Promise<void> {
  memory.set(track.id, track);
  if (dbBroken) return;
  try {
    await run<IDBValidKey>("readwrite", (s) => s.put(track));
  } catch (err) {
    markBroken(err);
  }
}

export async function deleteTrack(id: string): Promise<void> {
  memory.delete(id);
  if (dbBroken) return;
  try {
    await run<undefined>("readwrite", (s) => s.delete(id));
  } catch (err) {
    markBroken(err);
  }
}

/** 只更新歌词字段（避免把整个 Blob 重新写一遍）。 */
export async function saveLyrics(
  id: string,
  lyrics: string,
  source: LyricsSource,
): Promise<MusicTrack | null> {
  const track = memory.get(id);
  if (!track) return null;
  const next: MusicTrack = { ...track, lyrics, lyricsSource: source };
  await putTrack(next);
  return next;
}
