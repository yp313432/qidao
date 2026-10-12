/**
 * **本地小键的唯一入口**（PH4 第一步）。
 *
 * 规矩（`qidao-docs/UI统一规范.md` §12）：**一类数据一个真源、一个写入者**，
 * UI / 守护进程**不许直接摸 `localStorage`** —— 那是"哪里坏了补哪里"的土壤
 * （用户原话："不能哪里出问题再补哪一块了，拆东补西"）。
 *
 * 这些键是"**可重算运行态**"（去重标记、上次发生的日期…），按 §12.2 属于**允许丢**那一档：
 * 丢了最多"今天多提醒你一次"，不会伤用户资产。所以这里：
 *   · 统一加 `qidao:` 前缀（清数据时一起清）
 *   · 读写都**不抛**（隐私模式/配额满时静默降级，绝不把界面搞崩）
 *   · 提供 `kvGetJSON` / `kvSetJSON`，避免各处自己 `JSON.parse` 出岔子
 */

const PREFIX = "qidao:";

export function kvKey(name: string): string {
  return name.startsWith(PREFIX) ? name : `${PREFIX}${name}`;
}

/** 读一个字符串键（读不到/出错都返回 null） */
export function kvGet(name: string): string | null {
  try {
    return globalThis.localStorage?.getItem(kvKey(name)) ?? null;
  } catch {
    return null;
  }
}

/** 写一个字符串键（写不进也不抛） */
export function kvSet(name: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(kvKey(name), value);
  } catch {
    /* 隐私模式/配额满：允许丢的那一档，不打扰用户 */
  }
}

/**
 * **不加前缀**地写一个键（给"别的代码要按原名读"的键用，比如首屏脚本读的 `aster-theme`）。
 * 仍然走这一层，是为了"全 App 只有一处摸 localStorage"。
 */
export function kvSetRaw(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function kvRemove(name: string): void {
  try {
    globalThis.localStorage?.removeItem(kvKey(name));
  } catch {
    /* ignore */
  }
}

/** 读 JSON（坏数据/不存在 → 返回兜底值，不抛） */
export function kvGetJSON<T>(name: string, fallback: T): T {
  const raw = kvGet(name);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function kvSetJSON(name: string, value: unknown): void {
  try {
    kvSet(name, JSON.stringify(value));
  } catch {
    /* 循环引用之类：不抛 */
  }
}

/** 列出所有栖岛自己的键（清数据、自检页用） */
export function kvKeys(): string[] {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return [];
    const out: string[] = [];
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}
