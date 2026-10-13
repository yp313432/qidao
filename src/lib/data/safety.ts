/**
 * **数据安全带**（2026-10 加，起因是一次真机上"搬家后设的东西全没了"）。
 *
 * 用户原话（2026-10-13）：
 *   "我刚才点进去，它又恢复到初始页面了。就是设置啥全没了。我拉取的模型、填的 API 也没了。"
 *   "嗯，先做数据安全吧，我这里面没有什么重要的数据，都是测试的。"
 *
 * ── 事故复盘（如实）────────────────────────────────────────────
 *   用户 10-12 23:33 切到**新存储**并成功；**搬家之后**又设了背景、模型、密钥 ——
 *   这些**只存在新存储那一份里**。次日打开时新存储那份读出来是空的，
 *   而"老档"里只有搬家前的东西 → **搬家后设的全没了**（老档回滚也救不回）。
 *
 * ── 这个文件干什么（"小而关键"的东西必须有多份）──────────────────
 *   ① `mirrorSettings()`：**每次设置变化**都把设置抄两份 ——
 *        · `localStorage[qidao:settings-mirror]`（**去掉大字段**：背景图/头像，避免撑爆 5MB）
 *        · 独立库 `qidao-safety`（**整份**，含背景图 —— 跟主库不同库名，同一个故障不会一起带走）
 *   ② `readSettingsMirror()`：启动时如果发现"设置是空的（没密钥/没背景/没模型），
 *        但镜子里有" → **自动用镜子恢复**，并如实告诉用户（不静默）
 *   ③ `pushSnapshot()`：每次启动把当前存档压一份**滚动快照**（最近 3 份）进 `qidao-safety`
 *   ④ `safetyReport()`：给「存储自检」面板用（镜子里有没有、快照哪几份、都多大）
 *
 * ⚠️ 纪律：这一层**只读**别人的数据（不改主库），写只写自己那个独立库和 localStorage 小键；
 *    任何失败都**不抛**（数据安全带不该把 App 搞崩）。
 */

const MIRROR_KEY = "qidao:settings-mirror";
const SAFETY_DB = "qidao-safety";
const SAFETY_STORE = "kv";
/** 滚动快照保留几份（多了占地方，少了不够翻） */
export const SNAPSHOT_KEEP = 3;
/** localStorage 镜子里**不放大字段**（背景图/头像可能是几 MB 的 dataURL） */
const BIG_FIELDS = ["background", "aiAvatar", "userAvatar", "shiganUrl"] as const;

type Loose = Record<string, unknown>;

function openSafetyDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(SAFETY_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SAFETY_STORE)) db.createObjectStore(SAFETY_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function safetyPut(key: string, value: string): Promise<boolean> {
  return openSafetyDb().then(
    (db) =>
      new Promise<boolean>((resolve) => {
        if (!db) return resolve(false);
        try {
          const t = db.transaction(SAFETY_STORE, "readwrite");
          t.objectStore(SAFETY_STORE).put(value, key);
          t.oncomplete = () => resolve(true);
          t.onerror = t.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      }),
  );
}

function safetyGet(key: string): Promise<string | null> {
  return openSafetyDb().then(
    (db) =>
      new Promise<string | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const g = db.transaction(SAFETY_STORE, "readonly").objectStore(SAFETY_STORE).get(key);
          g.onsuccess = () => resolve(typeof g.result === "string" ? g.result : null);
          g.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

function safetyKeys(): Promise<string[]> {
  return openSafetyDb().then(
    (db) =>
      new Promise<string[]>((resolve) => {
        if (!db) return resolve([]);
        try {
          const g = db.transaction(SAFETY_STORE, "readonly").objectStore(SAFETY_STORE).getAllKeys();
          g.onsuccess = () => resolve((g.result ?? []).map(String));
          g.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      }),
  );
}

/** 去掉大字段（localStorage 只有 5~10MB，背景图能一下占满） */
export function slimSettings(settings: Loose): Loose {
  const out: Loose = { ...settings };
  for (const k of BIG_FIELDS) delete out[k];
  return out;
}

/** 这份设置"像不像被重置了"（判断要不要用镜子救） */
export function looksReset(settings: Loose | undefined | null): boolean {
  if (!settings || typeof settings !== "object") return true;
  const hasKey = typeof settings.customApiKey === "string" && settings.customApiKey.trim().length > 0;
  const hasUrl = typeof settings.customBaseUrl === "string" && settings.customBaseUrl.trim().length > 0;
  const hasModel = typeof settings.upstreamModel === "string" && settings.upstreamModel.trim().length > 0;
  const bg = settings.background as { image?: string } | undefined;
  const hasBg = typeof bg?.image === "string" && bg.image.length > 0;
  const customName = typeof settings.aiName === "string" && settings.aiName.trim().length > 0;
  return !hasKey && !hasUrl && !hasModel && !hasBg && !customName;
}

/** 镜子里的这份设置，比现在这份"更有料"吗（有料才值得拿来覆盖） */
export function mirrorIsBetter(mirror: Loose | null, current: Loose | undefined | null): boolean {
  if (!mirror) return false;
  if (!looksReset(current)) return false; // 现在这份好好的 → 绝不动它
  return !looksReset(mirror);
}

/** 每次设置变化都调它：抄两份（小份进 localStorage、整份进独立库） */
export async function mirrorSettings(settings: Loose | undefined | null): Promise<void> {
  if (!settings || typeof settings !== "object") return;
  /**
   * ⚠️ **不许拿"像被重置的设置"盖掉一面有料的镜子**（2026-10 补）。
   *
   * 现场：App 一启动、hydration 还没完成时，各种守护进程/界面就会动一下 store，
   * 于是这个订阅带着**默认设置**跑了一次、把镜子改成了默认值 ——
   * 安全网在最需要它的那一刻（启动）反而是空的。
   * 用户那次"背景全没了、密钥却还在"，就是这种半好的状态：
   * 镜子被覆盖过，只剩下不够全的那份。
   *
   * 规矩跟主库那道写保护同一条：**宁可这次不更新镜子，也不许把好的覆盖成默认的**。
   */
  const existing = await readSettingsMirror();
  if (existing && looksReset(settings) && !looksReset(existing)) return;
  const full = JSON.stringify(settings);
  const slim = JSON.stringify(slimSettings(settings));
  try {
    globalThis.localStorage?.setItem(MIRROR_KEY, slim);
  } catch {
    /* 配额满就算了：下面还有独立库那一份 */
  }
  await safetyPut("settings", full);
}

/** 读镜子（先看完整那份，再退回 localStorage 的小份） */
export async function readSettingsMirror(): Promise<Loose | null> {
  const full = await safetyGet("settings");
  const raw = full ?? (() => {
    try {
      return globalThis.localStorage?.getItem(MIRROR_KEY) ?? null;
    } catch {
      return null;
    }
  })();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Loose;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** 滚动快照：每次启动压一份，只留最近 `SNAPSHOT_KEEP` 份 */
export async function pushSnapshot(json: string | null, at = Date.now()): Promise<void> {
  if (!json) return;
  await safetyPut(`snap:${at}`, json);
  const keys = (await safetyKeys()).filter((k) => k.startsWith("snap:")).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - SNAPSHOT_KEEP))) {
    await safetyPut(old, ""); // 精简：把老的清空（不删键，省得动 delete 逻辑）
  }
}

/** 给「存储自检」面板用 */
export async function safetyReport(): Promise<{
  hasMirror: boolean;
  mirrorBytes: number;
  snapshots: string[];
}> {
  const full = await safetyGet("settings");
  const keys = (await safetyKeys()).filter((k) => k.startsWith("snap:")).sort().reverse();
  return {
    hasMirror: Boolean(full),
    mirrorBytes: full ? full.length : 0,
    snapshots: keys.slice(0, SNAPSHOT_KEEP),
  };
}

/* ────────────────────────── 恢复（用户点按钮才走这条路） ────────────────────────── */

export type SnapshotInfo = { key: string; at: number; bytes: number };

/** 列出滚动快照（新的在前，带时间和大小）——自检面板显示用 */
export async function listSnapshots(): Promise<SnapshotInfo[]> {
  const keys = (await safetyKeys()).filter((k) => k.startsWith("snap:")).sort().reverse();
  const out: SnapshotInfo[] = [];
  for (const k of keys.slice(0, SNAPSHOT_KEEP)) {
    const v = await safetyGet(k);
    if (v && v.length > 0) out.push({ key: k, at: Number(k.slice(5)) || 0, bytes: v.length });
  }
  return out;
}

/**
 * **从某份快照恢复**（用户明确点的，不是自动）。
 *
 * 纪律（§12.0 铁律 3）：恢复**之前**会自动把"现状"再留一份（走 `backup-io` 的 `pre-restore`），
 * 且要经过"像不像存档"的校验；失败**如实返回原因**，不静默。
 */
export async function restoreFromSnapshot(key: string): Promise<{ ok: boolean; why?: string }> {
  const json = await safetyGet(key);
  if (!json) return { ok: false, why: "这份快照读不出来（可能已经被清理）" };
  const { writeSnapshotFromBackup } = await import("./backup-io");
  const r = await writeSnapshotFromBackup(json);
  return r.ok ? { ok: true } : { ok: false, why: r.why };
}

/** **只用镜子里的设置**恢复（对话等其它数据不动）——最保守的一种救法 */
export async function restoreSettingsMirror(): Promise<{ ok: boolean; why?: string }> {
  const mirror = await readSettingsMirror();
  if (!mirror) return { ok: false, why: "安全带里还没有设置镜子" };
  try {
    const st = await import("@/lib/store");
    const cur = st.useApp.getState().settings as unknown as Record<string, unknown>;
    st.useApp.setState({ settings: { ...(cur ?? {}), ...mirror } } as never);
    return { ok: true };
  } catch (e) {
    return { ok: false, why: String((e as Error)?.message ?? e) };
  }
}