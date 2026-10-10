/**
 * 「主动感知」的**纯核心** —— 他主动看一眼现在的状态。
 *
 * 用户的原话：
 *   "他现在只能感知，没有办法接到回执……所有的都是被动接收的，而不是主动去用这些权限。"
 *   "我给开他那么多权限，其实是希望他**主动的去用**。"
 *   "主动的感知就是知道目前的一个状态。"
 *
 * 所以这一层跟「此刻的情况」完全不同：
 *   · 「此刻的情况」是**每一轮被系统塞进上下文**的一段（那是被动接收，别动它）；
 *   · 这里是**他自己调一个动作**去问一眼，结果跟别的动作一样**当轮回执**给他。
 *
 * ── 为什么单独一个文件（而不是直接写进 `sense.ts`）────────────────
 *
 * `sense.ts` 要 import store / Capacitor / 定位那一套，纯 node 里跑不起来。
 * 于是把**判定与措辞**全部放这里（零 import，`node --experimental-strip-types`
 * 直接 import），`sense.ts` 只负责"去把事实读出来"。`verify-sense.mjs` 就是拿
 * 这个文件在**没有原生插件**（= 网页版）的情况下逐条断言：
 *   · 不许崩
 *   · 每个结果里都有 `summary`（他读起来是一句人话）
 *   · 读不到就**如实失败**，权限没给还要说清**去哪个系统设置页开**（绝不静默）
 *
 * 跟 `tool-select.ts` 同一个套路：**纯函数 + 注入事实**（这里注入的是 `Reading`）。
 */

/** 六个感知动作的 kind（跟 `action-schema.ts` 的注册保持一致）。 */
export type SenseKind =
  | "sense.time"
  | "sense.device"
  | "sense.place"
  | "sense.notifications"
  | "sense.foreground"
  | "sense.screen";

/** A 组：零权限（网页版也有，或至少能如实说清少了什么）。 */
export const SENSE_KINDS_CHEAP: SenseKind[] = ["sense.time", "sense.device", "sense.place"];

/** B 组：要系统权限（通知使用权 / 使用情况访问），拿不到就指着设置页告诉他。 */
export const SENSE_KINDS_SYSTEM: SenseKind[] = [
  "sense.notifications",
  "sense.foreground",
  "sense.screen",
];

export const SENSE_KINDS: SenseKind[] = [...SENSE_KINDS_CHEAP, ...SENSE_KINDS_SYSTEM];

/**
 * 读不到时的**原因分类**（决定那句人话怎么写）：
 *   · `web`        网页版没有这个能力（要装成 App）—— 不许说成"权限没给"
 *   · `permission` 系统权限没给 → **必须**带上 `fix`（去哪个设置页开）
 *   · `off`        用户把功能开关关着（例如定位）→ 也要说清去哪打开
 *   · `error`      插件在、但这次读失败（原生报错 / 系统不给）
 */
export type SenseGap = "web" | "permission" | "off" | "error";

/** 一次读取的结果：要么有事实，要么说清为什么没有（`fix` = 去哪儿开）。 */
export type Reading<T> =
  | { ok: true; value: T }
  | { ok: false; gap: SenseGap; detail: string; fix?: string };

/** 一句话结论 + 结构化字段（`summary` 永远在，`ok` 永远在）。 */
export type SenseOutcome = { ok: boolean; summary: string; [key: string]: unknown };

/**
 * **系统设置页在哪** —— 权限没给时必须照这里说。
 *
 * 用户的要求："权限没给时：返回 ok:false + 明确说去哪个系统设置页面开，绝不静默。"
 * 所以这份文案只有一处（`sense-core`），别在接线层再抄一份。
 */
export const SENSE_SETTINGS_FIX: Record<string, string> = {
  notifications: "去「设置 → 应用 → 特殊应用权限 → 通知使用权」给栖岛打开",
  foreground: "去「设置 → 应用 → 特殊应用权限 → 使用情况访问」给栖岛打开",
};

/** 兜底：真是权限问题但接线层没给路径时，也得指向"设置"（别让他去别处找）。 */
export const SENSE_PERMISSION_FALLBACK_FIX = "去系统设置里给栖岛打开这一项";

/** 定位/天气的**开关**关着时指的路（跟权限不是一回事，别混）。 */
export const SENSE_PLACE_SWITCH_FIX = "去「我的 → 系统 → 天气与定位」把那个开关打开";

/** 网页版那一句（B 组整组、A 组的电量都走它）。 */
export function webGapOutcome(what: string): SenseOutcome {
  return {
    ok: false,
    reason: "web",
    summary: `网页版没有这个能力（${what}）—— 装成安卓 App 才能用`,
  };
}

/**
 * 把"读不到"变成一句**如实**的话。
 *
 * ⚠️ 四种 gap 的措辞不许混：网页版没有能力 ≠ 权限没给 ≠ 开关关着 ≠ 这次读失败。
 * 混了就等于骗他（他会去设置里找一个根本不存在的开关）。
 */
export function gapOutcome(gap: SenseGap, detail: string, fix?: string): SenseOutcome {
  if (gap === "web") return webGapOutcome(detail);
  if (gap === "permission") {
    const where = fix || SENSE_PERMISSION_FALLBACK_FIX;
    return {
      ok: false,
      reason: "permission",
      fix: where,
      summary: `没有这个系统权限：${detail}。${where}`,
    };
  }
  if (gap === "off") {
    const where = fix || SENSE_PLACE_SWITCH_FIX;
    return { ok: false, reason: "off", fix: where, summary: `${detail}。${where}` };
  }
  return { ok: false, reason: "error", summary: `这次没读到：${detail}` };
}

/* ────────────────────────────── 1. 现在几点 ────────────────────────────── */

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 一天里的哪一段（他说话时比"14:07"更有用） */
export function partOfDay(hour: number): string {
  if (hour < 5) return "凌晨";
  if (hour < 9) return "早上";
  if (hour < 12) return "上午";
  if (hour < 14) return "中午";
  if (hour < 18) return "下午";
  if (hour < 23) return "晚上";
  return "深夜";
}

/** `2026-05-03 14:07` —— 本地时间，给人看（别用 ISO，那个是 UTC、他会看错） */
export function formatLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

/** "12 分钟" / "2 小时 5 分钟" / "刚说" */
export function humanAgo(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min <= 0) return "刚刚";
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} 小时 ${rest} 分钟` : `${h} 小时`;
}

export type TimeFacts = {
  now: number;
  /** 设备时区名（如 Asia/Shanghai）；拿不到就别填 */
  tz?: string;
  /** 用户上一次说话的时间（ms）—— store 里能拿到才给 */
  lastUserAt?: number;
  /** 他自己上一次说话的时间（ms） */
  lastAssistantAt?: number;
};

export function senseTime(f: TimeFacts): SenseOutcome {
  const d = new Date(f.now);
  const hour = d.getHours();
  const part = partOfDay(hour);
  const since = typeof f.lastUserAt === "number" ? Math.max(0, f.now - f.lastUserAt) : undefined;
  const head = `现在是 ${formatLocal(f.now)} ${WEEKDAYS[d.getDay()]}（${part}${
    f.tz ? `，${f.tz}` : ""
  }）`;
  const tail =
    since === undefined
      ? "；还没有你的说话记录"
      : since < 60_000
        ? "；你刚刚才说过话"
        : `；你上次说话是 ${humanAgo(since)}前`;
  return {
    ok: true,
    time: formatLocal(f.now),
    date: formatLocal(f.now).slice(0, 10),
    weekday: WEEKDAYS[d.getDay()],
    hour,
    partOfDay: part,
    tz: f.tz ?? null,
    sinceLastUserMinutes: since === undefined ? null : Math.round(since / 60_000),
    ...(f.lastAssistantAt === undefined
      ? {}
      : { sinceLastAssistantMinutes: Math.round(Math.max(0, f.now - f.lastAssistantAt) / 60_000) }),
    summary: `${head}${tail}`,
  };
}

/* ─────────────────────────── 2. 电量 / 充电 / 网络 ─────────────────────────── */

export type DeviceFacts = {
  /** 电量百分比 0~100；读不到给 null（**不许编**） */
  battery: number | null;
  /** 是不是在充电；读不到给 null */
  charging: boolean | null;
  /** `wifi` / `cellular` / `ethernet` / `none` / `unknown` */
  network: string;
  online: boolean | null;
  /** 这台设备/这个形态读不到什么（写进 summary，别沉默） */
  missing?: string;
};

const NETWORK_LABEL: Record<string, string> = {
  wifi: "连着 WiFi",
  cellular: "用的是移动数据",
  ethernet: "插着网线",
  none: "现在没有网",
  unknown: "网络类型看不出来",
};

export function senseDevice(r: Reading<DeviceFacts>): SenseOutcome {
  if (!r.ok) {
    // 电量/网络是 A 组（零权限），所以这里只会是"网页版"或"这次读失败"
    return gapOutcome(r.gap, r.detail);
  }
  const v = r.value;
  const parts: string[] = [];
  if (v.battery === null) parts.push("电量读不到");
  else parts.push(`电量 ${Math.round(v.battery)}%`);
  if (v.charging !== null) parts.push(v.charging ? "正在充电" : "没在充电");
  // 没网就直说"没有网"；有网才谈得上类型（`online === false` 和 `network === "none"` 是一个意思）
  if (v.online === false || v.network === "none") parts.push("现在没有网");
  else if (v.network !== "unknown") parts.push(NETWORK_LABEL[v.network] ?? `网络：${v.network}`);
  const note = v.missing ? `（${v.missing}）` : "";
  return {
    ok: true,
    battery: v.battery,
    charging: v.charging,
    network: v.network,
    online: v.online,
    summary: `${parts.join("，")}${note}`,
  };
}

/* ────────────────────────────── 3. 在哪 / 天气 ────────────────────────────── */

export type PlaceSource = "manual" | "system" | "ip" | "cache" | "unknown";

const SOURCE_LABEL: Record<PlaceSource, string> = {
  manual: "你手填的地方",
  system: "系统定位",
  ip: "按 IP 认的城市",
  cache: "上次定位的缓存",
  unknown: "来源不明",
};

export type PlaceFacts = {
  label: string;
  /** 一行天气（`weatherLine()` 那种）；没有就给 null */
  weather: string | null;
  source: PlaceSource;
  /** 这个地点是什么时候拿到的（ms） */
  at: number;
};

/**
 * ⚠️ 定位本身有"飘"的已知问题（用户机器上会显示海南）—— **照实返回**，
 * 并在返回值里带上来源，让他和用户都知道这句话是哪来的、可不可信。
 */
export function sensePlace(r: Reading<PlaceFacts>, now = Date.now()): SenseOutcome {
  if (!r.ok) return gapOutcome(r.gap, r.detail, r.fix);
  const v = r.value;
  const src = SOURCE_LABEL[v.source] ?? SOURCE_LABEL.unknown;
  const age = Math.max(0, now - v.at);
  const weather = v.weather ? `外面 ${v.weather}` : "天气没拿到";
  return {
    ok: true,
    place: v.label,
    weather: v.weather,
    source: v.source,
    sourceLabel: src,
    minutesAgo: Math.round(age / 60_000),
    summary: `你在 ${v.label}；${weather}（来源：${src}${
      age > 60_000 ? `，${humanAgo(age)}前的` : ""
    }）`,
  };
}

/* ──────────────────────────── 4. 最近的通知 ──────────────────────────── */

export type NotificationFacts = {
  items: { app: string; title: string; text: string; minutesAgo: number }[];
};

/** 一行压到 18 字，通知正文常常很长 */
function clip(text: string, n = 18): string {
  const one = (text ?? "").replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

export function senseNotifications(r: Reading<NotificationFacts>): SenseOutcome {
  if (!r.ok) {
    /**
     * ⚠️ 通知这一格**必须**说清去哪开：安卓的「通知使用权」是特殊权限，
     * 不在普通的权限弹窗里 —— 不告诉他路径，他永远找不到。
     * （接线层要是漏了 fix，这里兜住，绝不静默。）
     */
    return gapOutcome(r.gap, r.detail, r.fix ?? SENSE_SETTINGS_FIX.notifications);
  }
  const items = r.value.items.slice(0, 5);
  if (items.length === 0) {
    return { ok: true, count: 0, items: [], summary: "最近没有新通知" };
  }
  const head = items
    .slice(0, 3)
    .map((i) => `${i.app}「${clip(i.title || i.text)}」`)
    .join("、");
  return {
    ok: true,
    count: items.length,
    items,
    summary: `最近 ${items.length} 条通知：${head}${items.length > 3 ? " 等" : ""}`,
  };
}

/* ───────────────────────── 5. 前台是哪个 App ───────────────────────── */

export type ForegroundFacts = { app: string; package: string };

export function senseForeground(r: Reading<ForegroundFacts>): SenseOutcome {
  if (!r.ok) return gapOutcome(r.gap, r.detail, r.fix ?? SENSE_SETTINGS_FIX.foreground);
  const v = r.value;
  return {
    ok: true,
    app: v.app,
    package: v.package,
    summary: `你现在在用「${v.app}」`,
  };
}

/* ─────────────────────────── 6. 屏幕亮着没 ─────────────────────────── */

export type ScreenFacts = { interactive: boolean; locked: boolean };

export function senseScreen(r: Reading<ScreenFacts>): SenseOutcome {
  if (!r.ok) return gapOutcome(r.gap, r.detail);
  const v = r.value;
  const what = !v.interactive ? "屏幕黑着" : v.locked ? "屏幕亮着，还锁着" : "屏幕亮着，已解锁";
  return {
    ok: true,
    interactive: v.interactive,
    locked: v.locked,
    summary: what,
  };
}

/* ────────────────────────────── 收口 ────────────────────────────── */

/**
 * 一个动作的结果**长什么样**：结构化字段 + 一句话，单行 JSON。
 *
 * 为什么是 JSON 而不是纯一句话：他要的是"看一眼状态"——
 * 电量的数字、网络的类型这些**字段**后面还能用（比如"电量低了就别放视频"），
 * 纯散文里再抠一遍就等于白给。`summary` 保证他读起来仍然是一句人话。
 */
export function renderSense(outcome: SenseOutcome): string {
  return JSON.stringify(outcome);
}

/** 结果里必须有的那个字段（验收脚本盯着它）。 */
export const SENSE_SUMMARY_FIELD = "summary";
