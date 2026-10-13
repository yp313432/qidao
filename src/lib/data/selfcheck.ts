/**
 * **存储自检**（2026-10）—— 把两套存储的真实状态摆出来。
 *
 * 为什么必须做：用户在真机上遇到"打开就变初始页"时，**从界面上看不出**到底是
 *   · 老档（搬家前那份）空了，还是
 *   · 新库（搬家后那份）空了，还是
 *   · 读的时候失败了（被保护住、拒绝写入），
 * 于是只能靠"点一点试试" —— 这对用户不公平，也让我排障靠猜。
 *
 * 这个面板就是那张"体检表"：两份各有多少条、上次写入是什么时候、
 * 这次启动有没有读失败、安全带里有没有镜子和快照。
 */
import { dataFlags } from "./db";
import { safetyReport } from "./safety";

export type StoreSide = {
  /** 这份在哪（给人看的名字） */
  name: string;
  /** 有没有内容（条数/字节） */
  detail: string;
  /** 空的？ */
  empty: boolean;
};

export type SelfCheck = {
  legacy: StoreSide;
  modern: StoreSide;
  /** 这次启动有没有读失败过（有的话界面要标红） */
  readFailed: boolean;
  lastFailure: string;
  /** 新库上次成功写入的时间 */
  lastWriteAt?: number;
  /** 从安全带救回过设置没有 */
  restored: boolean;
  /** 安全带里的东西 */
  mirror: { has: boolean; bytes: number };
  snapshots: string[];
  /** 一句话结论（给人看） */
  verdict: string;
};

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export async function storageSelfCheck(): Promise<SelfCheck> {
  /** ① 老档那份（搬家前）：直接数它里面有多少条消息 */
  let legacy: StoreSide = { name: "老档（搬家前那份）", detail: "读不到", empty: true };
  try {
    const { idbStorage } = await import("@/lib/idb-storage");
    const raw = await idbStorage.getItem("aster-app");
    if (!raw) {
      legacy = { name: "老档（搬家前那份）", detail: "没有（可能已经清过）", empty: true };
    } else {
      const parsed = JSON.parse(raw) as { state?: { conversations?: { messages?: unknown[] }[] } };
      const convs = arr(parsed?.state?.conversations) as { messages?: unknown[] }[];
      const msgs = convs.reduce((n, c) => n + arr(c?.messages).length, 0);
      legacy = {
        name: "老档（搬家前那份）",
        detail: `对话 ${convs.length} · 消息 ${msgs}`,
        empty: convs.length === 0 && msgs === 0,
      };
    }
  } catch (e) {
    legacy = { name: "老档（搬家前那份）", detail: `读失败：${String((e as Error)?.message ?? e)}`, empty: true };
  }

  /** ② 新库那份（一个库多张表） */
  let modern: StoreSide = { name: "新库（搬家后那份）", detail: "读不到", empty: true };
  let lastWriteAt: number | undefined;
  try {
    const { readAll, readMeta } = await import("./db");
    const { TABLES } = await import("./schema");
    const rows: string[] = [];
    let total = 0;
    for (const [label, table] of [
      ["对话", TABLES.conversations],
      ["消息", TABLES.messages],
      ["设置", TABLES.settings],
      ["记忆", TABLES.memories],
      ["日记等", TABLES.writings],
      ["二进制", TABLES.blobs],
    ] as const) {
      const r = await readAll<unknown>(table);
      if (!r.ok) {
        rows.push(`${label} 读失败`);
        continue;
      }
      const n = (r.value ?? []).length;
      total += n;
      rows.push(`${label} ${n}`);
    }
    const meta = await readMeta();
    lastWriteAt = meta?.lastWriteAt;
    modern = { name: "新库（搬家后那份）", detail: rows.join(" · "), empty: total === 0 };
  } catch (e) {
    modern = { name: "新库（搬家后那份）", detail: `读失败：${String((e as Error)?.message ?? e)}`, empty: true };
  }

  /** ③ 安全带（镜子 + 快照） */
  let mirror = { has: false, bytes: 0 };
  let snapshots: string[] = [];
  try {
    const r = await safetyReport();
    mirror = { has: r.hasMirror, bytes: r.mirrorBytes };
    snapshots = r.snapshots;
  } catch {
    /* 安全带读不到就算了 */
  }

  const readFailed = dataFlags.readFailedThisSession;
  const verdict = readFailed
    ? "⚠️ 这次启动读失败过 —— 已暂停自动保存（免得用空白盖掉老数据）。重启一次试试"
    : legacy.empty && modern.empty
      ? "⚠️ 两份都是空的 —— 数据可能真没了；安全带里有镜子的话可以救回设置"
      : legacy.empty
        ? "新库有数据、老档是空的（正常：搬过家之后老档可能被清）"
        : modern.empty
          ? "⚠️ 新库是空的，但老档还有内容 —— 千万别乱点清空；可以先切回老存储看看"
          : "两份都有内容（正常）";

  return {
    legacy,
    modern,
    readFailed,
    lastFailure: dataFlags.lastFailure,
    lastWriteAt,
    restored: false,
    mirror,
    snapshots,
    verdict,
  };
}
