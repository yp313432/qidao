/**
 * 玩乐区「照片」：单独一个 IndexedDB，**不塞进状态树**。
 *
 * 为什么单独存（跟 music-db.ts 同一个理由）：
 * zustand 那棵树是**整体序列化**的（里面有日记、对话、记忆……），
 * 每写一次都要把整棵树过一遍。往里塞几张大图，等于每次任何状态变化
 * 都重写一遍图片 —— 越用越卡。音乐文件已经证明单独存是对的。
 *
 * 另外照抄音乐那套**内存兜底**：IndexedDB 在隐私模式 / 配额不足 /
 * 被策略禁用时会直接抛错，以前音乐那里没兜住，表现为"选完文件什么都不发生"。
 * 这里统一降级为「本次会话内存保存」，并让调用方拿到明确结果。
 *
 * 全部只在这台设备上，不上传。
 */

const DB_NAME = "qidao-play-photos";
const STORE = "photos";
const VERSION = 1;

export type PlayPhoto = {
  id: string;
  name: string;
  /** 缩略图用的小图（dataURL），列表里只读它，避免反复解大 Blob */
  thumb: string;
  addedAt: number;
  /** 原图。展示时用 createObjectURL 取 */
  blob: Blob;
};

/** 本次会话的内存副本（也是 IndexedDB 不可用时的唯一存储）。 */
const memory = new Map<string, PlayPhoto>();
let dbBroken = false;

function markBroken(err: unknown) {
  if (dbBroken) return;
  dbBroken = true;
  console.warn("[play-photos] IndexedDB 不可用，改为仅本次会话保存在内存：", err);
}

/** 持久化是否可用（UI 可据此提示「本次会话有效」）。 */
export function isPersistent(): boolean {
  return !dbBroken;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
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

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
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

export async function listPhotos(): Promise<PlayPhoto[]> {
  if (dbBroken) return [...memory.values()].sort((a, b) => b.addedAt - a.addedAt);
  try {
    const rows = await run<PlayPhoto[]>("readonly", (s) => s.getAll());
    for (const r of rows) memory.set(r.id, r);
    return rows.sort((a, b) => b.addedAt - a.addedAt);
  } catch (err) {
    markBroken(err);
    return [...memory.values()].sort((a, b) => b.addedAt - a.addedAt);
  }
}

export async function putPhoto(photo: PlayPhoto): Promise<void> {
  memory.set(photo.id, photo);
  if (dbBroken) return;
  try {
    await run<IDBValidKey>("readwrite", (s) => s.put(photo));
  } catch (err) {
    markBroken(err);
  }
}

export async function deletePhoto(id: string): Promise<void> {
  memory.delete(id);
  if (dbBroken) return;
  try {
    await run<undefined>("readwrite", (s) => s.delete(id));
  } catch (err) {
    markBroken(err);
  }
}

/**
 * 把用户选的文件做成一条照片记录。
 *
 * 顺手生成一张**缩略图**存进记录里：卡片上只显示小图，
 * 原图只在点开看大图时才 createObjectURL —— 否则列表里一堆大图会拖慢滚动。
 */
export async function makePhoto(file: File): Promise<PlayPhoto> {
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const thumb = await makeThumb(file);
  return { id, name: file.name, thumb, addedAt: Date.now(), blob: file };
}

/** 生成缩略图（最长边 480，JPEG 质量 0.72）。失败就退回空串，不阻断保存。 */
async function makeThumb(file: File): Promise<string> {
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("图片解码失败"));
        el.src = url;
      });
      const max = 480;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.72);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return "";
  }
}
