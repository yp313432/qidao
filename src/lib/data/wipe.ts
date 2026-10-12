/**
 * **把数据真的清干净**（D7，2026-10 用户拍板"修"）。
 *
 * 为什么单独一个文件：老的 `data.reset` 只删了 localStorage 那份小存档，
 * IndexedDB 里真正的大档**没动** → 用户点了"清空"，重启数据又回来了
 * （用户原话见 `qidao-docs/数据架构-①设计.md` F7/D7）。
 *
 * 现在的口径：**两套存储都清**（老档 + 新库），并且**逐项报告清了什么**，
 * 让上层（危险动作）能把结果如实念给用户听。
 *
 * ⚠️ 这是**破坏性操作**，规矩（§12.0 铁律 3）：
 *   · 调用方必须先让用户确认（二级确认）
 *   · 清之前不自动导出（导出会带走密钥，默认不做；要留证据请用「导出」按钮）
 */
import { openDataDb } from "./db";
import { TABLES, type TableName } from "./schema";

export type WipeReport = {
  newTables: { table: string; rows: number }[];
  oldArchiveCleared: boolean;
  localKeysCleared: string[];
  errors: string[];
};

/** 清空新库的所有表（**真的清**，不是只删 memory 里那份） */
async function wipeNewStore(): Promise<WipeReport["newTables"]> {
  const out: WipeReport["newTables"] = [];
  const db = await openDataDb();
  if (!db) return out;
  for (const table of Object.values(TABLES) as TableName[]) {
    await new Promise<void>((resolve) => {
      try {
        const t = db.transaction(table, "readwrite");
        const store = t.objectStore(table);
        const count = store.count();
        let n = 0;
        count.onsuccess = () => {
          n = count.result;
        };
        store.clear();
        t.oncomplete = () => {
          out.push({ table, rows: n });
          resolve();
        };
        t.onerror = t.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  return out;
}

/**
 * 清空栖岛自己的全部数据（**别动别的站点/别的库**）：
 *   ① 新库所有表
 *   ② 老存档那条记录（`qidao-store/kv/aster-app`）+ 它的备份/留证键
 *   ③ localStorage 里 `qidao:` 开头的键 + `aster-app`
 */
export async function wipeAll(): Promise<WipeReport> {
  const report: WipeReport = { newTables: [], oldArchiveCleared: false, localKeysCleared: [], errors: [] };

  try {
    report.newTables = await wipeNewStore();
  } catch (e) {
    report.errors.push(`清新库失败：${String((e as Error)?.message ?? e)}`);
  }

  /** 老档：走老存储自己的 removeItem（它会连备份/留证键一起删） */
  try {
    const { idbStorage } = await import("@/lib/idb-storage");
    await idbStorage.removeItem("aster-app");
    report.oldArchiveCleared = true;
  } catch (e) {
    report.errors.push(`清老档失败：${String((e as Error)?.message ?? e)}`);
  }

  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const keys: string[] = [];
      for (let i = 0; i < ls.length; i += 1) {
        const k = ls.key(i);
        if (k && (k.startsWith("qidao:") || k === "aster-app")) keys.push(k);
      }
      for (const k of keys) ls.removeItem(k);
      report.localKeysCleared = keys;
    }
  } catch (e) {
    report.errors.push(`清 localStorage 失败：${String((e as Error)?.message ?? e)}`);
  }

  return report;
}

/** 给用户念的一句人话 */
export function describeWipe(report: WipeReport): string {
  const rows = report.newTables.reduce((n, t) => n + t.rows, 0);
  const bits = [
    `新库清掉 ${rows} 条（${report.newTables.filter((t) => t.rows > 0).map((t) => `${t.table} ${t.rows}`).join("、") || "本来就是空的"}）`,
    report.oldArchiveCleared ? "老档已清" : "老档没清成",
    report.localKeysCleared.length > 0 ? `本地小键清了 ${report.localKeysCleared.length} 个` : "本地小键本来就是空的",
  ];
  if (report.errors.length > 0) bits.push(`⚠️ ${report.errors.join("；")}`);
  return bits.join(" · ");
}
