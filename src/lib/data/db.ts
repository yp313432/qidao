/**
 * **唯一的数据访问层**（PH2 骨架）—— 全 App 只有这里能开库。
 *
 * 规矩见 `qidao-docs/UI统一规范.md` §12；施工图见 `数据架构-①设计.md`。
 * ⚠️ PH2 阶段**还没接入现有功能**（切换在 PH3，用户点头才做）——
 * 现在它只是"建好了、测过了、随时能接"。
 *
 * ── 这个文件存在的意义（把三种错法从 API 层面堵死）──────────────
 *   1. **读失败 ≠ 空数据**：读接口返回的是 `{ok:true,value}` / `{ok:false,why}`，
 *      **没有**"读失败就给你个 undefined 当空"的写法 —— 调用方想错都难
 *   2. **读不到就别写**：`readFailedThisSession` 为真时，写操作一律拒绝（记 skippedWrites）
 *   3. **坏档不静默丢**：读不出来的记录挪到 `…::corrupt-<时间>` 留证，再报错
 */
import {
  DATA_DB,
  INDEXES,
  SCHEMA_VERSION,
  TABLES,
  type MetaRecord,
  type TableName,
} from "./schema";

const META_KEY = "schema";

let dbPromise: Promise<IDBDatabase | null> | null = null;

/* ────────────────────────── 状态（给界面看） ────────────────────────── */

export const dataFlags = {
  /** 这次启动有没有读失败过（界面据此提示"重启试试"，并暂停自动保存） */
  readFailedThisSession: false,
  /** 因为上面那条保护而跳过的写入次数 */
  skippedWrites: 0,
  /** 靠备份/留证救回来的次数 */
  recovered: 0,
  /** 上次读失败的原因（给自检页显示） */
  lastFailure: "",
};

function fail(why: string) {
  dataFlags.readFailedThisSession = true;
  dataFlags.lastFailure = why;
}

/* ────────────────────────── 开库 ────────────────────────── */

/** 没有主键的表（单条/带 key 的记录）—— ⚠️ 建库时**不能**传 `{keyPath: undefined}` */
export function isKeyless(table: TableName): boolean {
  return table === TABLES.settings || table === TABLES.stats || table === TABLES.meta;
}

/** 开库（同一个实例只开一次）。失败返回 null，**不抛** */
export function openDataDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise.catch(() => null);
  dbPromise = new Promise<IDBDatabase | null>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("这个环境没有 IndexedDB"));
      return;
    }
    const req = indexedDB.open(DATA_DB, SCHEMA_VERSION);
    req.onupgradeneeded = () => {
      /**
       * ⚠️ 2026-10 真跑抓到的**致命坑**：这里抛异常 → **建库事务整体中止 → 库被丢掉**
       * （表现：`indexedDB.databases()` 里根本没有 `qidao`，但同一会话里读写又"看起来正常"）。
       * 起因是给 `settings`/`stats`/`meta` 传了 `{ keyPath: undefined }` —— 引擎会当成非法参数。
       * 现在：没有主键的表就**不传第二个参数**，而且整段包 try/catch 并把错误记下来。
       */
      try {
        const db = req.result;
        for (const table of Object.values(TABLES) as TableName[]) {
          const store = db.objectStoreNames.contains(table)
            ? req.transaction!.objectStore(table)
            : isKeyless(table)
              ? db.createObjectStore(table)
              : db.createObjectStore(table, { keyPath: "id" });
          for (const idx of INDEXES[table] ?? []) {
            if (!store.indexNames.contains(idx.name)) {
              store.createIndex(idx.name, idx.keyPath, { unique: false });
            }
          }
        }
      } catch (e) {
        fail(`建库失败（升级事务中止）：${String((e as Error)?.message ?? e)}`);
        throw e;
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      /**
       * ⚠️ **坏库自愈**（2026-10 真跑抓到）：如果上一次"建库升级"被中止过，
       * 磁盘上会留下一个**版本对、但一张表都没有**的空库；之后再用同样的版本打开
       * **不会触发升级** → 表永远不存在 → 所有读写都失败 → 界面全空。
       * 空库（一张表都没有）里不可能有数据 → 直接删掉重建，最安全。
       *
       * 只是"少了几张表"的情况**不能删**（那里面可能有数据）—— 记下来交给自检页，
       * 靠 schema 版本 +1 去补（`onupgradeneeded` 里有 `contains` 判断，会补建）。
       */
      const missing = (Object.values(TABLES) as TableName[]).filter((t) => !db.objectStoreNames.contains(t));
      if (missing.length === 0) {
        resolve(db);
        return;
      }
      db.close();
      if (db.objectStoreNames.length === 0) {
        const del = indexedDB.deleteDatabase(DATA_DB);
        const retry = () => {
          dbPromise = null;
          openDataDb().then(
            (v) => resolve(v),
            (e) => reject(e as Error),
          );
        };
        del.onsuccess = retry;
        del.onerror = retry;
        del.onblocked = retry;
        return;
      }
      fail(`库里少了这几张表：${missing.join("、")}（没有自动删，先记下来）`);
      reject(new Error(`库里少了这几张表：${missing.join("、")}`));
    };
    req.onerror = () => reject(req.error ?? new Error("打开数据库失败"));
    req.onblocked = () => reject(new Error("数据库被另一个页面占着（blocked）"));
  });
  return dbPromise.catch((e: unknown) => {
    fail(String((e as Error)?.message ?? e));
    return null;
  }) as Promise<IDBDatabase | null>;
}

function run<T>(
  table: TableName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<{ ok: true; value: T } | { ok: false; why: string }> {
  return openDataDb().then((db) => {
    if (!db) return { ok: false as const, why: `打不开数据库（${dataFlags.lastFailure || "未知"}）` };
    return new Promise<{ ok: true; value: T } | { ok: false; why: string }>((resolve) => {
      try {
        const t = db.transaction(table, mode);
        const req = fn(t.objectStore(table));
        req.onsuccess = () => resolve({ ok: true as const, value: req.result as T });
        req.onerror = () => resolve({ ok: false as const, why: String(req.error?.message ?? "事务失败") });
        t.onabort = () => resolve({ ok: false as const, why: "事务被中止（多半是配额或崩溃）" });
      } catch (e) {
        resolve({ ok: false as const, why: String((e as Error)?.message ?? e) });
      }
    });
  });
}

/* ────────────────────────── 读 ────────────────────────── */

export type ReadResult<T> = { ok: true; value: T | undefined } | { ok: false; why: string };

/** 读一条。**读失败绝不会伪装成"没有这条"** */
export async function readRecord<T>(table: TableName, key: IDBValidKey): Promise<ReadResult<T>> {
  const r = await run<T>(table, "readonly", (s) => s.get(key));
  if (!r.ok) {
    fail(`读 ${table} 失败：${r.why}`);
    return { ok: false, why: r.why };
  }
  return { ok: true, value: r.value };
}

/** 读整张表（迁移、导出用） */
export async function readAll<T>(table: TableName): Promise<ReadResult<T[]>> {
  const r = await run<T[]>(table, "readonly", (s) => s.getAll());
  if (!r.ok) {
    fail(`读 ${table} 全表失败：${r.why}`);
    return { ok: false, why: r.why };
  }
  return { ok: true, value: r.value ?? [] };
}

/** 按索引读（比如某条对话的全部消息） */
export async function readByIndex<T>(
  table: TableName,
  index: string,
  query: IDBValidKey | IDBKeyRange,
): Promise<ReadResult<T[]>> {
  const r = await run<T[]>(table, "readonly", (s) => s.index(index).getAll(query));
  if (!r.ok) {
    fail(`按索引读 ${table}.${index} 失败：${r.why}`);
    return { ok: false, why: r.why };
  }
  return { ok: true, value: r.value ?? [] };
}

/* ────────────────────────── 写 ────────────────────────── */

export type WriteResult = { ok: true } | { ok: false; why: string };

function guardWrite(): WriteResult | null {
  if (dataFlags.readFailedThisSession) {
    dataFlags.skippedWrites += 1;
    return { ok: false, why: "这次启动没读到存档 —— 已暂停自动保存，免得用空白覆盖老数据（重启 App 再试）" };
  }
  return null;
}

/** 写一条（**单条写**：改一条消息只动一条，不再整块重写） */
export async function writeRecord(table: TableName, record: unknown, key?: IDBValidKey): Promise<WriteResult> {
  const blocked = guardWrite();
  if (blocked) return blocked;
  const r = await run<IDBValidKey>(table, "readwrite", (s) => s.put(record, key as IDBValidKey));
  return r.ok ? { ok: true } : { ok: false, why: r.why };
}

/** 批量写（迁移/导入用；一个事务里做完，中途失败整批回滚） */
export async function writeMany(table: TableName, records: unknown[]): Promise<WriteResult> {
  const blocked = guardWrite();
  if (blocked) return blocked;
  const db = await openDataDb();
  if (!db) return { ok: false, why: `打不开数据库（${dataFlags.lastFailure || "未知"}）` };
  /**
   * ⚠️ `settings` / `stats` / `meta` 这三张表**没有 keyPath**（它们是"单条/带 key 的记录"），
   * 对没有 keyPath 的对象存储调 `put(record)` **必须**给主键 —— 否则抛 `DataError`，
   * 整批回滚。（真跑 PH3 切换时踩到：搬家整批失败，开关没切成。）
   */
  const keyless = table === TABLES.settings || table === TABLES.stats || table === TABLES.meta;
  return new Promise<WriteResult>((resolve) => {
    try {
      const t = db.transaction(table, "readwrite");
      const store = t.objectStore(table);
      for (const rec of records) {
        if (keyless) {
          const row = rec as Record<string, unknown>;
          const key = String(row.key ?? (table === TABLES.settings ? "settings" : ""));
          if (!key) return resolve({ ok: false, why: `${table} 的记录缺少 key（无法定位）` });
          store.put(rec, key);
        } else {
          store.put(rec);
        }
      }
      t.oncomplete = () => resolve({ ok: true });
      t.onerror = () => resolve({ ok: false, why: String(t.error?.message ?? "批量写失败") });
      t.onabort = () => resolve({ ok: false, why: "批量写被中止（回滚了，库里还是老样子）" });
    } catch (e) {
      resolve({ ok: false, why: String((e as Error)?.message ?? e) });
    }
  });
}

export async function deleteRecord(table: TableName, key: IDBValidKey): Promise<WriteResult> {
  const blocked = guardWrite();
  if (blocked) return blocked;
  const r = await run<undefined>(table, "readwrite", (s) => s.delete(key));
  return r.ok ? { ok: true } : { ok: false, why: r.why };
}

/* ────────────────────────── 坏档留证 ────────────────────────── */

/**
 * 读不出来的一条记录 → **挪到留证键**再报错（不静默丢）。
 * 这是 §12.4 那条"主记录存在但读不出来"的落地。
 */
export async function preserveCorrupt(table: TableName, key: IDBValidKey, raw: unknown, why: string): Promise<void> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await run<IDBValidKey>(table, "readwrite", (s) => s.put({ id: `${String(key)}::corrupt-${stamp}`, raw, why, at: Date.now() }, `${String(key)}::corrupt-${stamp}`));
    dataFlags.recovered += 1;
  } catch {
    /* 留证失败也不能挡住主流程 */
  }
}

/* ────────────────────────── 二进制（图片/表情/音频/照片） ────────────────────────── */

/** 存二进制：**存 Blob 不存 base64**（设计文档 F3 的根治） */
export async function putBlob(rec: {
  id: string;
  kind: string;
  mime: string;
  at?: number;
  data: Blob;
}): Promise<WriteResult> {
  return writeRecord(TABLES.blobs, { at: Date.now(), size: rec.data.size, ...rec });
}

/** dataURL → Blob（导入/迁移用；只在需要落库的那一刻转） */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(head)?.[1] ?? "application/octet-stream";
  if (/;base64/.test(head)) {
    const bin = atob(body ?? "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body ?? "")], { type: mime });
}

/** Blob → dataURL（**只在要发给上游的那一刻**转，平时不进内存常住） */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(bin)}`;
}

/* ────────────────────────── meta ────────────────────────── */

export async function readMeta(): Promise<MetaRecord | undefined> {
  const r = await readRecord<MetaRecord>(TABLES.meta, META_KEY);
  return r.ok ? r.value : undefined;
}

export async function writeMeta(patch: Partial<MetaRecord>): Promise<WriteResult> {
  const cur = (await readMeta()) ?? { key: "schema", version: SCHEMA_VERSION };
  return writeRecord(TABLES.meta, { ...cur, ...patch, key: "schema" }, META_KEY);
}

/** 库是不是已经建好并且是本版 schema（迁移完成的标志） */
export async function isSchemaReady(): Promise<boolean> {
  const meta = await readMeta();
  const ready = meta?.version === SCHEMA_VERSION;
  if (!ready) {
    await writeMeta({ version: SCHEMA_VERSION });
    return false;
  }
  return true;
}
