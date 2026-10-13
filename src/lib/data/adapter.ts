/**
 * **新存储适配层**（PH3）—— 让 zustand 用新库，而 App 代码一行不改。
 *
 * 为什么这么做：App 现在的状态是一整块（`conversations` / `settings` / …），
 * 要"一个库多张表 + 单条写"有两条路：
 *   A. 把 App 的所有读写都改成按表调用（大改，PH4 才做）
 *   B. **只换存储这一层**：读的时候把各表拼回那个整块形状，写的时候**拆表 + 增量**写
 * 选 B：App 看不出差别，但"改一条消息只写一条"已经生效 —— 这就是这次要的收益。
 *
 * 规矩见 `qidao-docs/UI统一规范.md` §12；施工图见 `数据架构-①设计.md`（PH3）。
 *
 * ⚠️ **默认关**：`lib/data/switch.ts` 里的开关没打开时，走的还是老路
 * （`lib/idb-storage.ts` 的 `qidao-store`），现有数据一个字节不动。
 */
import {
  readAll,
  readRecord,
  writeMany,
  deleteRecord,
  writeMeta,
  readMeta,
  dataFlags,
  type ReadResult,
  type WriteResult,
} from "./db";
import { planMigration, roundTrip, type LegacyState, type MigrationPlan } from "./migrate";
import { looksReset } from "./safety";
import { TABLES, checksum, type TableName } from "./schema";

/** 每张表"上次写进去的样子"：id → 内容校验和（用来算增量） */
export type RowDigests = Map<TableName, Map<string, string>>;

export function emptyDigests(): RowDigests {
  return new Map(Object.values(TABLES).map((t) => [t, new Map<string, string>()]));
}

/** 一行记录的主键：`settings` / `stats` / `meta` 是带 key 的单条，别的用 id */
export function rowIdOf(table: TableName, row: Record<string, unknown>): string {
  if (table === TABLES.settings || table === TABLES.stats || table === TABLES.meta) {
    return String(row.key ?? (table === TABLES.settings ? "settings" : ""));
  }
  return String(row.id ?? "");
}

/**
 * **增量**：拿"现在要写进来的行"跟"上次写进去的样子"比，只挑出变了的。
 *
 * ⚠️ 这是纯函数（`verify-data-layer.mjs` 直接断言"改一条消息只写一条"）。
 */
export function changedRows(
  table: TableName,
  rows: Record<string, unknown>[],
  digest: Map<string, string>,
): { put: Record<string, unknown>[]; del: string[]; unchanged: number } {
  const put: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  for (const row of rows) {
    const id = rowIdOf(table, row);
    if (!id) continue;
    seen.add(id);
    const sum = checksum(row);
    if (digest.get(id) === sum) {
      unchanged += 1;
      continue;
    }
    put.push(row);
    digest.set(id, sum);
  }
  const del: string[] = [];
  for (const id of [...digest.keys()]) {
    if (!seen.has(id)) {
      del.push(id);
      digest.delete(id);
    }
  }
  return { put, del, unchanged };
}

/** 把"整块状态"的文本拆成各表行（复用迁移映射 —— 一套映射，不写两遍） */
export function parseToPlan(json: string): MigrationPlan | null {
  try {
    const parsed = JSON.parse(json) as { state?: LegacyState };
    const state = parsed?.state ?? (parsed as LegacyState);
    if (!state || typeof state !== "object") return null;
    return planMigration(state);
  } catch {
    return null;
  }
}

/** 各表的行数组（写库用）；settings/meta 是单条，单独处理 */
export function planToTables(plan: MigrationPlan): { table: TableName; rows: Record<string, unknown>[] }[] {
  return [
    { table: TABLES.conversations, rows: plan.conversations as unknown as Record<string, unknown>[] },
    { table: TABLES.messages, rows: plan.messages as unknown as Record<string, unknown>[] },
    { table: TABLES.blobs, rows: plan.blobs as unknown as Record<string, unknown>[] },
    { table: TABLES.memories, rows: plan.memories as unknown as Record<string, unknown>[] },
    { table: TABLES.writings, rows: plan.writings as unknown as Record<string, unknown>[] },
    { table: TABLES.emotions, rows: plan.emotions as unknown as Record<string, unknown>[] },
    { table: TABLES.schedules, rows: plan.schedules as unknown as Record<string, unknown>[] },
    { table: TABLES.stats, rows: plan.stats as unknown as Record<string, unknown>[] },
    { table: TABLES.logs, rows: plan.logs as unknown as Record<string, unknown>[] },
    { table: TABLES.settings, rows: [{ key: "settings", value: plan.settings }] },
  ];
}

/* ────────────────────────── 读：新库 → 整块形状 ────────────────────────── */

/**
 * 把各表读出来拼回 App 认识的那个整块形状（zustand 直接用）。
 *
 * 读失败**绝不返回空** —— 返回 `{ok:false}`，由上层决定"这次不覆盖"（见 db.ts 的 guardWrite）。
 */
export async function loadLegacyShaped(): Promise<ReadResult<string>> {
  const tables: TableName[] = [
    TABLES.conversations,
    TABLES.messages,
    TABLES.blobs,
    TABLES.memories,
    TABLES.writings,
    TABLES.emotions,
    TABLES.schedules,
    TABLES.stats,
    TABLES.logs,
    TABLES.settings,
  ];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const r = await readAll<Record<string, unknown>>(t);
    if (!r.ok) return { ok: false, why: `读 ${t} 失败：${r.why}` };
    out[t] = r.value ?? [];
  }
  const settingsRow = (out[TABLES.settings] ?? [])[0] as { value?: LegacyState } | undefined;
  const state: LegacyState = {
    settings: (settingsRow?.value as LegacyState["settings"]) ?? {},
    conversations: [] as LegacyState["conversations"],
    memories: [],
    worldBook: [],
    diary: [],
    moments: [],
    letters: [],
    docs: [],
    todos: [],
    dates: [],
    emotionEvents: [],
    reminders: [],
    tasks: [],
    actionLog: [],
    requestLog: [],
  };
  /** 用迁移映射的逆函数拼回来（`roundTrip` 只认 plan，所以先搭一个 plan 壳） */
  const fakePlan = {
    settings: (settingsRow?.value as Record<string, unknown>) ?? {},
    conversations: out[TABLES.conversations],
    messages: out[TABLES.messages],
    blobs: out[TABLES.blobs],
    memories: out[TABLES.memories],
    writings: out[TABLES.writings],
    emotions: out[TABLES.emotions],
    schedules: out[TABLES.schedules],
    stats: out[TABLES.stats],
    logs: out[TABLES.logs],
    report: { from: "db", counts: {}, checksums: {}, anyMismatch: false, notes: [] },
  } as unknown as MigrationPlan;
  const legacy = roundTrip(fakePlan);
  /**
   * ⚠️ **每个集合都必须给出来（空就空数组）** —— 2026-10 真机红屏抓到的：
   * `roundTrip` 对**空集合会省掉键**（`worldBook: []` → 键不存在），
   * 而页面里有 `worldBook.length` 这种读法 → `Cannot read properties of undefined (reading 'length')`
   * （用户截图：AI 概览 →「怎么和你相处」点进去直接是报错页）。
   * 所以这里**显式把每个集合都兜成数组**，一个都不漏。
   */
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const logs = out[TABLES.logs] as { kind?: string; payload?: unknown }[];
  const settingsBag = (fakePlan.settings ?? {}) as Record<string, unknown>;
  const merged: LegacyState = {
    ...legacy,
    /**
     * ⚠️ **这里以前是 `...settingsBag`（把整袋设置摊到顶层）** —— 那是"读档漏 settings"
     * 那场事故的现场（用户："为啥每次更新背景和设置全没了"）：
     * 摊开只能把 `model/mcp/…` 这些小键放回顶层，**`settings` 本身谁也没补**，
     * 于是 App 用默认值顶上、又把默认值写回库 → 真设置被覆盖。
     * 现在 `roundTrip()` 自己就产出 `settings` + 那些小键（一份名单、进出对称），
     * 这里只负责"每个集合都兜成数组"。
     */
    conversations: arr(legacy.conversations),
    memories: arr(legacy.memories),
    worldBook: arr(legacy.worldBook),
    diary: arr(legacy.diary),
    moments: arr(legacy.moments),
    letters: arr(legacy.letters),
    docs: arr(legacy.docs),
    todos: arr(legacy.todos),
    dates: arr(legacy.dates),
    emotionEvents: arr(legacy.emotionEvents),
    reminders: arr(legacy.reminders),
    tasks: arr(legacy.tasks),
    customWords: arr(settingsBag.customWords),
    stickerLib: arr(settingsBag.stickerLib),
    stickerGroups: (Array.isArray(settingsBag.stickerGroups) ? (settingsBag.stickerGroups as string[]) : []) as string[],
    /** 推理档案（2026-10 补：以前它连搬都没搬 → 换新存储就静默变空） */
    thinkingArchive: arr(legacy.thinkingArchive),
    requestLog: arr(logs.filter((l) => l.kind === "request").map((l) => l.payload ?? {})),
    actionLog: arr(logs.filter((l) => l.kind === "action").map((l) => l.payload ?? {})),
  };
  hydrated = true;
  return { ok: true, value: JSON.stringify({ state: merged, version: 1 }) };
}

/* ────────────────────────── 写：整块形状 → 各表（增量） ────────────────────────── */

let digests: RowDigests | null = null;
/**
 * **这次会话成功读过一次**才允许写。
 *
 * ⚠️ 2026-10 真跑切换时抓到的**最凶的一个 bug**：App 里有一堆守护进程
 * （提醒 / 唤醒 / 界面效果）会在 hydration 完成**之前**先写一次状态。
 * 那次写带着**默认（空）状态**，而增量写看到"库里有、内存里没有" →
 * 就把刚搬过去的行**全删了**（读回来是 0 条）。
 *
 * 所以规矩是"**没读过就不许写**"（§12.4 那条的延伸）：
 * 第一次成功读之前，任何写操作一律拒绝，并记一笔给自检页看。
 */
let hydrated = false;
/** 因为"还没读过"而拒绝的写入次数（界面可显示） */
export const writeStats = {
  rowsWritten: 0,
  rowsSkipped: 0,
  saves: 0,
  refusedBeforeHydration: 0,
  /** 因为"这份设置像被重置了、库里那份有料"而**拒绝覆盖设置行**的次数（自检面板显示） */
  settingsKeptBack: 0,
};

/** 第一次保存前，把库里现有的行摘要读进来（否则第一写会把所有行重写一遍） */
export async function primeDigests(): Promise<void> {
  if (digests) return;
  digests = emptyDigests();
  for (const table of Object.values(TABLES) as TableName[]) {
    const r = await readAll<Record<string, unknown>>(table);
    if (!r.ok) continue; // 读失败：留空摘要即可（guardWrite 会拦住写入）
    const map = digests.get(table)!;
    for (const row of r.value ?? []) map.set(rowIdOf(table, row), checksum(row));
  }
}

/**
 * 把整块状态存进新库（**只写变了的行**）。
 *
 * ⚠️ 两种入口，**同一套写逻辑**：
 *   · `saveLegacyShaped(json)` —— 手上是**字符串**时用（老路径 / 搬家 / 验收脚本）
 *   · `saveLegacyShapedObject(value)` —— 手上已经是**对象**时用（zustand 直接给对象）
 *
 * 为什么要第二个入口（2026-10，真机"执行情绪动作卡死 6.8 秒"的修复）：
 *   原来 zustand 那条路是 `createJSONStorage` → **先把整份状态序列化成字符串** →
 *   我们这边 `JSON.parse` **再解析回来** → 才交给搬家函数。
 *   数据一大（用户背景图/表情都是 base64，几 MB），这一来一回就是**两次全量搬运**，
 *   手机上是秒级卡顿。现在 zustand 直接把对象交过来，**序列化和解析全省掉**。
 */
export async function saveLegacyShaped(json: string): Promise<WriteResult> {
  const plan = parseToPlan(json);
  if (!plan) return { ok: false, why: "状态不是合法 JSON" };
  return writePlan(plan);
}

/** 手上已经是对象时走这条（避开"序列化 + 再解析"两次全量搬运） */
export async function saveLegacyShapedObject(value: { state?: unknown; version?: number } | unknown): Promise<WriteResult> {
  const state = (value as { state?: unknown })?.state ?? value;
  if (!state || typeof state !== "object") return { ok: false, why: "状态不是对象" };
  return writePlan(planMigration(state as LegacyState, Date.now(), { report: false }));
}

/** 真正写库那一段（两个入口共用，见上面的说明） */
async function writePlan(plan: MigrationPlan): Promise<WriteResult> {
  /**
   * ⚠️ **没读过就不许写**（放在最前面）。
   * 2026-10 真跑切换抓到：App 的守护进程在 hydration 之前先写了一次，
   * 带着默认（空）状态 → 增量写把刚搬过去的行**全删了**。
   */
  if (!hydrated) {
    writeStats.refusedBeforeHydration += 1;
    return { ok: false, why: "还没完成首次读取 —— 已拒绝写入，免得拿默认状态删掉真实数据" };
  }
  if (dataFlags.readFailedThisSession) {
    return { ok: false, why: "这次启动没读到存档 —— 已暂停自动保存（见 §12.4）" };
  }
  await primeDigests();
  const d = digests!;
  writeStats.saves += 1;

  for (const { table, rows } of planToTables(plan)) {
    /**
     * ⚠️ **设置写保护**（2026-10，用户"更新完背景和设置全没了"的第二道保险）。
     *
     * 如果这次要写的设置"像被重置了"（密钥 / 地址 / 模型 / 背景 / 自定义名字**全空**），
     * 而库里那一行**有料** → **拒绝写这一行**。
     *
     * 为什么：那正是"读档出岔子 → App 拿默认值回写 → 真设置被覆盖"的现场
     * （这次根因已经修了，见 `migrate.ts` 的 `splitSettingsBag`；但数据不该只有一层保护）。
     * 宁可这次不保存设置，也不能把库里那份唯一真设置盖掉 —— §12.0 铁律 3 的精神。
     * 反过来：用户**真的**把这几样全清空（很少见）时，库里会留着旧值，重启会"回来"，
     * 所以自检面板里会如实记一笔（`writeStats.settingsKeptBack`）。
     */
    if (table === TABLES.settings) {
      const stored = await readRecord<{ value?: Record<string, unknown> }>(TABLES.settings, "settings");
      const storedValue = stored.ok ? stored.value?.value : undefined;
      if (storedValue && looksReset(plan.settings) && !looksReset(storedValue)) {
        writeStats.settingsKeptBack += 1;
        continue;
      }
    }
    const map = d.get(table)!;
    const { put, del, unchanged } = changedRows(table, rows, map);
    writeStats.rowsSkipped += unchanged;
    if (put.length > 0) {
      const r = await writeMany(table, put);
      if (!r.ok) return r;
      writeStats.rowsWritten += put.length;
    }
    for (const id of del) {
      const r = await deleteRecord(table, id);
      if (!r.ok) return r;
    }
  }
  await writeMeta({ lastWriteAt: Date.now() });
  return { ok: true };
}

/** 库里有没有东西（判断"要不要先把老档搬过来"） */
export async function newStoreIsEmpty(): Promise<boolean> {
  const r = await readAll<Record<string, unknown>>(TABLES.conversations);
  const m = await readAll<Record<string, unknown>>(TABLES.messages);
  if (!r.ok || !m.ok) return false;
  return (r.value?.length ?? 0) === 0 && (m.value?.length ?? 0) === 0;
}

/**
 * **把老档搬进新库**（PH3 打开开关时跑一次）。
 *
 * 纪律（§12）：① 老档**只读不改** ② 搬完**逐类校验**（条数 + 校验和）③ 校验不过就报错，
 * 并且**不写 meta 的完成标记**（下次还能重试）。
 */
export async function migrateOldArchiveToNewStore(): Promise<{
  ok: boolean;
  report?: MigrationPlan["report"];
  why?: string;
}> {
  /** ⚠️ 这里刻意用**动态 import**：只在真的切换时才碰老存储的代码 */
  const { idbStorage } = await import("@/lib/idb-storage");
  let raw: string | null = null;
  try {
    raw = (await idbStorage.getItem("aster-app")) ?? null;
  } catch (e) {
    return { ok: false, why: `读老档失败：${String((e as Error)?.message ?? e)}` };
  }
  if (!raw) return { ok: true, why: "老档是空的，不需要搬" };

  const plan = parseToPlan(raw);
  if (!plan) return { ok: false, why: "老档不是合法 JSON（已保留原文件，没动它）" };
  if (plan.report.anyMismatch) {
    return {
      ok: false,
      why: `守恒校验没过：${plan.report.notes.join("；") || JSON.stringify(plan.report.counts)} —— 已停止，老档没动`,
    };
  }
  /** 搬家本身就是"先读老档再写新库"，属于合法路径 → 先放开闸门 */
  hydrated = true;
  const saved = await saveLegacyShaped(raw);
  if (!saved.ok) return { ok: false, why: saved.why };
  await writeMeta({
    version: 1,
    migratedFrom: plan.report.from,
    lastWriteAt: Date.now(),
  });
  return { ok: true, report: plan.report };
}

/** 老档里到底有多少东西（给界面显示"将搬多少条"） */
export async function peekOldArchive(): Promise<MigrationPlan["report"] | null> {
  const { idbStorage } = await import("@/lib/idb-storage");
  try {
    const raw = (await idbStorage.getItem("aster-app")) ?? null;
    if (!raw) return null;
    return parseToPlan(raw)?.report ?? null;
  } catch {
    return null;
  }
}

/** meta 里记的"是不是已经搬过了" */
export async function migrationState(): Promise<{ migratedFrom?: string; lastWriteAt?: number }> {
  const meta = await readMeta();
  return { migratedFrom: meta?.migratedFrom, lastWriteAt: meta?.lastWriteAt };
}
