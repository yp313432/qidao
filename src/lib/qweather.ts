import { useApp } from "@/lib/store";

/**
 * 和风天气（QWeather）客户端。
 *
 * ── 为什么用它 ──────────────────────────────────────────────
 *
 * 原来「知道你在哪」用的是 OpenStreetMap 的 Nominatim 反查地名。
 * 那个服务在国内**经常连不上**（用户实测："定位订不了"）——
 * 坐标其实早就拿到了，卡在"坐标 → 地名"这一步出不去。
 *
 * 和风是国内服务，国内可达；而且免费额度是**每月 5 万次**，
 * 个人用不完。更划算的是一次解决两件事：
 *   · GeoAPI  → 坐标反查地名（修定位）
 *   · 天气预报 → 天气
 *
 * ⚠️ 和风现在每个账号一个**专属 API Host**（形如 xxx.re.qweatherapi.com），
 *    老的 devapi.qweather.com 已经不能用了。所以 host 必须让用户填。
 */

/** 从设置里取配置；没填 key 就当没配 */
export function weatherConfig(): { host: string; key: string } | null {
  const s = useApp.getState().settings;
  const key = (s.qweatherKey ?? "").trim();
  if (!key) return null;
  // host 允许用户带 https:// 或者带路径，统一清干净
  const raw = (s.qweatherHost ?? "").trim() || "devapi.qweather.com";
  const host = raw
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .trim();
  if (!host) return null;
  return { host, key };
}

export function weatherConfigured(): boolean {
  return weatherConfig() !== null;
}

/**
 * 发一个和风请求。
 *
 * 两个坑记一下（都踩过）：
 *   1. 和风**默认返回 gzip**。浏览器会自动解压，但如果哪天换环境手动发，
 *      不解压就会拿到乱码 —— 所以这里显式要 JSON 并让运行时自己处理。
 *   2. 返回体里 `code` 是**字符串**的 "200"，不是数字。用 `=== "200"` 判。
 */
async function qget<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  const cfg = weatherConfig();
  if (!cfg) return { ok: false, reason: "还没配和风天气（我的 → 系统 → 天气与定位）" };
  const url = `https://${cfg.host}${path}${path.includes("?") ? "&" : "?"}key=${cfg.key}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, reason: `和风返回 HTTP ${res.status}` };
    const j = (await res.json()) as T & { code?: string };
    if (j.code && j.code !== "200") {
      return { ok: false, reason: `和风报错 code=${j.code}${codeHint(j.code)}` };
    }
    return { ok: true, data: j };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "网络错误";
    return { ok: false, reason: `连不上和风：${msg}` };
  }
}

/** 把和风的错误码翻译成人话（不然用户只看到一串数字） */
function codeHint(code: string): string {
  const map: Record<string, string> = {
    "401": "（key 不对或者没启用这个 API）",
    "402": "（这个月的免费额度用完了）",
    "403": "（key 没有这个 API 的权限 —— 去控制台给凭据勾上）",
    "404": "（查的地方不存在）",
    "429": "（请求太频繁，稍等一下）",
  };
  return map[code] ?? "";
}

/* ---------------------------- 地名 ---------------------------- */

export type GeoPlace = {
  name: string;
  id: string;
  lat: string;
  lon: string;
  /** 省 / 直辖市 */
  adm1: string;
  /** 市 */
  adm2: string;
};

/** 用「省+市」拼一个给人看的短地名：北京市朝阳 → 北京市朝阳区见下面 reverse */
function shortLabel(p: GeoPlace): string {
  const a1 = p.adm1 ?? "";
  const a2 = p.adm2 ?? "";
  // adm1 和 adm2 一样（直辖市）时只留一个，免得出现"北京市北京市"
  const city = a1 && a2 && a1 !== a2 ? `${a1}${a2}` : a1 || a2;
  if (city && p.name && !city.includes(p.name)) return `${city}${p.name}`;
  return city || p.name || "未知地点";
}

/**
 * 关键词查地点（给"手动指定地点"用）。
 * 例如输入「北京朝阳」→ 拿到 id/lat/lon，之后查天气就用它。
 */
export async function searchPlace(
  keyword: string,
): Promise<{ ok: true; places: GeoPlace[] } | { ok: false; reason: string }> {
  const kw = keyword.trim();
  if (!kw) return { ok: false, reason: "还没输地点" };
  const r = await qget<{ location?: GeoPlace[] }>(
    `/geo/v2/city/lookup?location=${encodeURIComponent(kw)}`,
  );
  if (!r.ok) return r;
  const list = r.data.location ?? [];
  if (!list.length) return { ok: false, reason: `没找到「${kw}」这个地方` };
  return { ok: true, places: list };
}

/**
 * 坐标 → 地名。**这就是替换掉 OpenStreetMap 的那一步。**
 *
 * 和风返回的 location[0] 一般是最近的城区，name 可能是"东城"，
 * adm1="北京市"。拼起来就是「北京市东城」。
 */
export async function reversePlace(
  lat: number,
  lon: number,
): Promise<{ ok: true; label: string; place: GeoPlace } | { ok: false; reason: string }> {
  // 和风的经纬度顺序是「经度,纬度」，别写反（写反了会定位到地球另一边）
  const r = await qget<{ location?: GeoPlace[] }>(
    `/geo/v2/city/lookup?location=${lon.toFixed(4)},${lat.toFixed(4)}`,
  );
  if (!r.ok) return r;
  const p = r.data.location?.[0];
  if (!p) return { ok: false, reason: "和风没给出这个坐标对应的地名" };
  return { ok: true, label: shortLabel(p), place: p };
}

/* ---------------------------- 天气 ---------------------------- */

export type WeatherNow = {
  /** 温度（摄氏，字符串） */
  temp: string;
  /** 天气现象文字：晴 / 多云 / 小雨… */
  text: string;
  /** 体感温度 */
  feelsLike: string;
  /** 湿度 % */
  humidity: string;
  windDir: string;
  windScale: string;
  /** 观测时间 */
  obsTime: string;
};

/**
 * 实时天气。
 *
 * `location` 传地点 id（最省事，GeoAPI 会给）或者「经度,纬度」。
 */
export async function weatherNow(
  location: string,
): Promise<{ ok: true; now: WeatherNow } | { ok: false; reason: string }> {
  const r = await qget<{ now?: WeatherNow }>(
    `/v7/weather/now?location=${encodeURIComponent(location)}`,
  );
  if (!r.ok) return r;
  if (!r.data.now) return { ok: false, reason: "和风没返回天气数据" };
  return { ok: true, now: r.data.now };
}

/**
 * 把天气压成**一行给人看的话**（进"此刻的情况"和首页都用这一句）。
 *
 * 故意不报湿度和风级 —— 他聊天时提"今天挺热"就够了，
 * 报一串数字反而像播天气预报。
 */
export function weatherLine(w: WeatherNow): string {
  const t = Number(w.temp);
  const feel = Number(w.feelsLike);
  // 体感跟实际差 3 度以上才提，否则啰嗦
  const feelNote = Number.isFinite(t) && Number.isFinite(feel) && Math.abs(feel - t) >= 3
    ? `（体感 ${w.feelsLike}°）`
    : "";
  return `${w.text} ${w.temp}°C${feelNote}`;
}
