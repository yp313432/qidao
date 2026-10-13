/**
 * **崩溃面包屑** —— 让"闪退"这件事留下证据。
 *
 * ── 为什么非做不可（2026-10）──────────────────────────────────────
 * 用户连续报了三次同一件事：
 *   · "为啥卡退了"
 *   · "全都卡住，有思考内容，然后闪退，不回复正文"
 *   · "我装的就是最新的，问题就是他卡退了，我不知道问题出在哪，你找找看"
 *
 * 而我在浏览器里把能想到的路都跑遍了（一次五连调工具 / 每轮一个 / 文本动作块 /
 * 要授权 / 星屿插件页上报情绪 / 存量 60 条再报 / 60 条消息 + 200 条记忆 + 300KB 背景图）
 * —— **一个都不崩**。原因是**手机侧的崩**（WebView 渲染进程被系统杀掉、
 * 或者主线程卡太久被判"无响应"）在这边根本复现不出来：桌面 Chromium 的 GPU、
 * 内存上限、WebView 版本都不一样。
 *
 * 所以换思路：**让 App 自己把崩之前的最后一段时间记下来**，重启后能看到。
 * 安卓杀进程时不会给 JS 留遗言，所以这里记的是"**持续滚动**的痕迹"——
 * 崩之前的最后几十条就是现场。这比再猜十轮有用。
 *
 * ── 记什么 ────────────────────────────────────────────────────────
 *   · 会话开始 / 干净退出（`pagehide`）—— 以此判断"上次是不是异常退出"
 *   · 心跳：每 10 秒一行（**堆内存**、DOM 节点数、当前阶段）
 *   · 长阻塞：主线程一次堵超过 500ms 就记一行（真机卡死的直接证据）
 *   · 报错：`window.onerror` / `unhandledrejection` / React 错误边界
 *   · 聊天链路的关键节点（发起请求 / 首个字 / 工具 / 收尾，见 use-chat）
 *
 * ── 纪律 ─────────────────────────────────────────────────────────
 *   · **绝不影响主流程**：所有写操作都在 try/catch 里，写失败就当没记（宁可没证据，不能崩）。
 *   · **不写数据、只写痕迹**：这里只放"在干什么 + 数字"，不放聊天内容、不放密钥。
 *   · **便宜**：滚动缓冲最多 80 条 + 合并写入（最快 400ms 一次）。
 *   · 只用 `localStorage`（小、同步、崩了也大概率留下）——**不碰主存档**（那是另一条命）。
 */

export type Crumb = {
  /** 记录时间（ms） */
  t: number;
  /** 分类：session / exit / beat / long / error / chat / action … */
  kind: string;
  text: string;
};

/** 滚动缓冲的键（跟主存档完全分开，绝不动它） */
const KEY = "qidao:breadcrumbs";
/** "这次会话还活着"的标记 —— 启动时看到它还在 = 上次是异常退出 */
const ALIVE_KEY = "qidao:session-alive";
/**
 * **上次那一场的结论**（`dirty` / `clean`）。
 *
 * 为什么必须单独存一份：重启之后"还活着"的标记**立刻又被立起来了**，
 * 所以「上次是不是异常退出」这个判断只能在**启动那一刻**做完、然后把结论落下来。
 * （第一版就是直接读 alive 标记 → 每次进环境自检都报"上次异常退出"，成了狼来了。）
 */
const VERDICT_KEY = "qidao:last-exit";
/** 最多留多少条（按心跳 10 秒一行算，80 条 ≈ 十几分钟的现场） */
export const MAX_CRUMBS = 80;
/**
 * 合并写入：最快多久真的落一次盘。
 *
 * ⚠️ 别调小：`localStorage.setItem` 在安卓 WebView 里是**同步写盘**，
 * 而这个模块的职责只是"留现场"，**绝不能自己变成卡顿源**。
 * 1.5 秒一次足够（崩之前的最后几秒照样看得见）。
 */
const WRITE_GAP_MS = 1500;
/** 主线程一次堵这么久就记一行（真机"卡死"的直接证据） */
export const LONG_TASK_MS = 500;
/** 心跳间隔（决定了"现场"的时间分辨率；15 秒一行 + 最多 80 条 ≈ 最近 20 分钟） */
const BEAT_MS = 15_000;

/** 当前阶段（心跳里带上，方便回看"崩的时候在干嘛"） */
let phase = "启动";

/** ───────────────────────── 纯逻辑（纯 node 就能测） ───────────────────────── */

/** 往缓冲里塞一条，返回**新的**缓冲（超过上限就丢最老的）。纯函数，好测。 */
export function pushCrumb(list: Crumb[], item: Crumb, max = MAX_CRUMBS): Crumb[] {
  const next = [...list, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * 上次是不是**异常退出**（没走到干净退出的那一步）。
 *
 * ⚠️ **只认那个"还活着"的标记，不去猜最后一条痕迹**（第一版拿"最后一条不是 exit"当兜底，
 * 结果心跳刚好在探测之后落了一行 `beat` 就被判成"崩过" —— 狼来了比漏报更糟：
 * 用户会开始无视这块提示）。
 *
 * 覆盖的两种真实情形都对得上：
 *   · **前台崩了 / 被系统杀**：来不及走 pagehide → 标记还在 → 异常 ✅
 *   · **退到后台被回收**：退后台那一刻就摘了标记（安卓回收后台是正常事）→ 正常 ✅
 */
export function isDirtyExit(alive: boolean): boolean {
  return alive;
}

/** 时间戳 → `mm:ss`（心跳那一串看着清楚；跨分钟的现场一眼能看出顺序） */
export function stampOf(t: number, base: number): string {
  const sec = Math.max(0, Math.round((t - base) / 1000));
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

/** ───────────────────────── 落地（只在浏览器里有意义） ───────────────────────── */

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readCrumbs(): Crumb[] {
  const ls = store();
  if (!ls) return [];
  try {
    const raw = ls.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as Crumb[]).filter((c) => c && typeof c.t === "number") : [];
  } catch {
    return [];
  }
}

let pending: Crumb[] = [];
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  writeTimer = null;
  const ls = store();
  if (!ls || pending.length === 0) return;
  try {
    let list = readCrumbs();
    for (const item of pending) list = pushCrumb(list, item);
    pending = [];
    ls.setItem(KEY, JSON.stringify(list));
  } catch {
    pending = [];
  }
}

/** 记一条痕迹（**永不抛**；合并写入，最快 400ms 落一次盘） */
export function crumb(kind: string, text: string): void {
  try {
    pending.push({ t: Date.now(), kind, text: text.slice(0, 160) });
    if (!writeTimer) writeTimer = setTimeout(flush, WRITE_GAP_MS);
  } catch {
    /* 见文件头：宁可没证据，不能崩 */
  }
}

/** 给心跳用的阶段名（聊天链路会更新它） */
export function setPhase(text: string): void {
  phase = text.slice(0, 60);
}

/** 手动落盘（要立刻看到痕迹时用，比如刚进「环境自检」） */
export function flushCrumbs(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  flush();
}

function heapMB(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  const v = m?.usedJSHeapSize;
  return typeof v === "number" ? Math.round(v / 1e6) : null;
}

/** 上次那一场的报告（给「环境自检」显示） */
export type RunReport = {
  /** 上次是不是异常退出（崩了 / 被系统杀了） */
  dirty: boolean;
  /** 记了多少条 */
  count: number;
  /** 现场（新→旧，最多 20 条） */
  crumbs: Crumb[];
};

export function crumbsReport(limit = 20): RunReport {
  const list = readCrumbs();
  let verdict: string | null = null;
  try {
    verdict = store()?.getItem(VERDICT_KEY) ?? null;
  } catch {
    /* 读不到就当没有 */
  }
  return {
    /** 结论在**启动那一刻**就定下来了（见 VERDICT_KEY 的说明） */
    dirty: verdict === "dirty",
    count: list.length,
    crumbs: list.slice(-limit).reverse(),
  };
}

export function clearCrumbs(): void {
  const ls = store();
  if (!ls) return;
  try {
    ls.removeItem(KEY);
    ls.removeItem(ALIVE_KEY);
    ls.removeItem(VERDICT_KEY);
  } catch {
    /* 清不掉就算了 */
  }
}

/**
 * **一次页面加载只做一次"会话记账"**。
 *
 * ⚠️ 这个守卫是必需的（不是保险）：React 在开发模式下会把挂载跑**两遍**
 * （StrictMode），重挂载也会再跑一次 —— 第二次 install 会读到**自己第一次刚立下的**
 * "还活着"标记，于是把"上次异常退出"误报出来（第一版就踩了，验收脚本当场抓到：
 * 模拟一次干净退出后仍然显示"异常退出"）。狼来了比漏报更糟。
 */
let sessionBooked = false;

/**
 * 挂上：会话标记 + 报错 + 长阻塞 + 心跳。
 * 在 App 外壳挂载时调一次；返回卸载函数。
 */
export function installBreadcrumbs(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const ls = store();

  if (!sessionBooked) {
    sessionBooked = true;
    /** 先判断"上一次"（要赶在写新标记之前读），并把结论**落下来**给「环境自检」看 */
    const wasAlive = ls?.getItem(ALIVE_KEY) === "1";
    const prev = readCrumbs();
    const prevDirty = isDirtyExit(wasAlive);

    crumb("session", `启动${wasAlive ? "（上次没干净退出）" : ""}｜${navigator.userAgent.slice(0, 60)}`);
    if (wasAlive) {
      const last = prev[prev.length - 1];
      crumb("session", `上次最后一条：${last ? `${last.kind} ${last.text}` : "（没有记录）"}`);
    }
    try {
      ls?.setItem(VERDICT_KEY, prevDirty ? "dirty" : "clean");
      ls?.setItem(ALIVE_KEY, "1");
    } catch {
      /* 见文件头 */
    }
    flushCrumbs();
  }

  const onError = (e: ErrorEvent) => crumb("error", `${e.message} @ ${(e.filename ?? "").slice(-40)}:${e.lineno}`);
  const onReject = (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string } | string;
    crumb("error", `未处理的 Promise 拒绝：${typeof r === "string" ? r : (r?.message ?? "?")}`);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onReject);

  /** 长阻塞：真机"卡死"最直接的证据（有就记，没有就算了 —— 老内核没这个 entryType） */
  let longObserver: PerformanceObserver | null = null;
  try {
    longObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration >= LONG_TASK_MS) {
          crumb("long", `主线程堵了 ${Math.round(e.duration)}ms（当时：${phase}）`);
        }
      }
    });
    longObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    /* 见文件头 */
  }

  /** 心跳：堆内存 + 节点数 + 阶段 —— 崩之前的最后一行就是"临死前的体量" */
  const beat = () => {
    if (document.visibilityState !== "visible") return;
    const heap = heapMB();
    let nodes = 0;
    try {
      nodes = document.getElementsByTagName("*").length;
    } catch {
      /* 见文件头 */
    }
    crumb("beat", `${phase}｜堆 ${heap ?? "?"}MB｜节点 ${nodes}`);
    flushCrumbs();
  };
  const beatTimer = setInterval(beat, BEAT_MS);
  beat();

  /** 干净退出：把"还活着"标记摘掉 —— 没摘掉 = 上次是被杀/崩的 */
  const onHide = () => {
    if (document.visibilityState !== "visible") {
      crumb("exit", "退到后台（正常）");
      try {
        store()?.removeItem(ALIVE_KEY);
      } catch {
        /* 见文件头 */
      }
      flushCrumbs();
    } else {
      /** 回到前台：重新立标记（后台被杀也算异常） */
      crumb("session", "回到前台");
      try {
        store()?.setItem(ALIVE_KEY, "1");
      } catch {
        /* 见文件头 */
      }
    }
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", () => {
    crumb("exit", "页面卸载（正常）");
    try {
      store()?.removeItem(ALIVE_KEY);
    } catch {
      /* 见文件头 */
    }
    flushCrumbs();
  });

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onReject);
    document.removeEventListener("visibilitychange", onHide);
    longObserver?.disconnect();
    clearInterval(beatTimer);
  };
}
