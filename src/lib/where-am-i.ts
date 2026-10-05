import { currentPlace, manualPlaceResult } from "@/lib/locate";
import { locateByIpCached } from "@/lib/ip-locate";
import { searchPlace, weatherNow, weatherLine, weatherConfigured, type GeoPlace } from "@/lib/qweather";
import { useApp } from "@/lib/store";

/**
 * 「地点 + 天气」的**统一刷新入口**。
 *
 * 两处地方要用同一份逻辑，所以不能各写一套（那就是"同一件事两套写法"）：
 *   · 我的 → 系统 → 天气与定位（设置页，用户手动点"刷新"）
 *   · 玩乐区首页那个时间卡（打开时自动刷一次）
 *
 * ── 顺序很重要 ────────────────────────────────────────────────
 *   1. 先定地点：优先用手动填的（零成本、不会失败）；
 *      没填才走系统定位 + 和风反查地名
 *   2. 再用**这个地点的 id** 去查天气（拿不到 id 就不查，
 *      别瞎报一个城市的天气）
 *
 * 查天气需要一个「地点 id 或经纬度」。两条路都能拿到：
 *   · 自动定位：currentPlace 顺手把和风给的 id 存进 geoPlaceId
 *   · 手动填的：先 searchPlace 搜一次拿 id
 *
 * ── 缓存（保护免费额度）───────────────────────────────────────
 * 和风免费额度每月 5 万次，但**有 bug 疯狂请求一样能烧穿**，所以两道缓存：
 *   · 天气：15 分钟内不重查（天气本来就半小时才变一次）
 *   · 地点：手动填的不查；自动定位的 30 分钟内不重查
 * 一天最多几十次请求，离 5 万次差三个数量级。
 */

/** 天气多久算新鲜（毫秒） */
export const WEATHER_TTL = 15 * 60_000;
/** 自动定位的地点多久算新鲜 */
export const PLACE_TTL = 30 * 60_000;

export type RefreshResult =
  | { ok: true; label: string; weather: string | null; note?: string }
  | { ok: false; reason: string };

/** 两处界面都调它。结果写进设置，界面从设置里读，不各自记状态。 */
export async function refreshPlaceAndWeather(force = false): Promise<RefreshResult> {
  const st = useApp.getState();
  const s = st.settings;

  if (!s.geoEnabled) {
    return { ok: false, reason: "上面那个开关是关着的 —— 先打开" };
  }

  const manual = manualPlaceResult();
  const now = Date.now();
  let label = "";
  /** 查天气要用的地点标识（id 或 "经度,纬度"） */
  let locQuery: string | null = null;

  /* ---------------- 第 1 步：定地点 ---------------- */

  if (manual && manual.ok) {
    // 手动填的：直接用，不查任何服务
    label = manual.label;
    // 手动地点也有和风编号（第一次查完就存下了）
    locQuery = s.geoPlaceId || null;
  } else if (!force && s.geoLabel && s.geoAt && now - s.geoAt < PLACE_TTL) {
    // 缓存还新鲜
    label = s.geoLabel;
    locQuery = s.geoPlaceId || null;
  } else {
    if (!weatherConfigured()) {
      return {
        ok: false,
        reason:
          "要自动定位得先填和风天气的 Key 和 API Host —— 没有它就没法把坐标翻译成地名" +
          "（这正是原来一直失败的那一步）。或者在「你常待的地方」里填一个，那样不用网络。",
      };
    }

    /*
      自动定位走**三级兜底**（用户实测：室内 GPS 定不到，"Could not obtain location in time"）：

        ① 系统定位（GPS/WiFi/基站）→ 拿坐标 → 和风反查地名
        ② 失败就用 **IP 定位** 认城市 → 照样能查天气（城市级精度够用）
        ③ 都失败才报错，并明确告诉他"填个手动地点最省事"

      之所以加 ②：手机自带天气、高德在室内也能定位，是因为它们走 WiFi/基站，
      而 WebView 那层拿不到。IP 定位是我们在网页里能做到的等效手段。
    */
    const sys = await currentPlace();
    if (sys.ok) {
      label = sys.label;
      locQuery = sys.placeId ?? null;
      st.patchSettings({
        geoLabel: sys.label,
        geoAt: now,
        ...(sys.placeId ? { geoPlaceId: sys.placeId } : {}),
      });
    } else {
      const ip = await locateByIpCached();
      if (!ip.ok) {
        return {
          ok: false,
          reason:
            `${sys.reason}\n\n` +
            `按 IP 也没认出城市（${ip.reason}）。\n` +
            `最省事的办法：在上面「你常待的地方」填一个，比如「北京市朝阳区」` +
            `—— 那样不用定位、不用网络，点刷新立刻就出天气。`,
        };
      }
      label = ip.label;
      // IP 只给到城市，还得搜一次拿和风的编号
      const sres = await searchPlace(ip.label);
      if (!sres.ok) {
        return { ok: false, reason: `按 IP 认出「${ip.label}」，但和风查不到这个地方：${sres.reason}` };
      }
      const p = sres.places[0]!;
      locQuery = p.id;
      label = niceLabel(p) || ip.label;
      st.patchSettings({ geoLabel: label, geoAt: now, geoPlaceId: p.id });
    }
  }

  /* ---------------- 没有和风：地点有了就行 ---------------- */

  if (!weatherConfigured()) {
    return { ok: true, label, weather: null, note: "没配和风天气，所以只有地点、没有天气" };
  }

  /* ---------------- 第 2 步：拿地点 id ---------------- */

  // 手动填的是文字，得搜一次拿 id（搜完把 id 存下来，下次不用再搜）
  if (manual && manual.ok && !locQuery) {
    const sres = await searchPlace(manual.label);
    if (!sres.ok) {
      return { ok: false, reason: `查不到「${manual.label}」的天气：${sres.reason}` };
    }
    const p = sres.places[0]!;
    locQuery = p.id;
    const nice = niceLabel(p);
    st.patchSettings({ geoPlaceId: p.id, geoLabel: nice || label, geoAt: now });
    if (nice) label = nice;
  }

  if (!locQuery) {
    return { ok: true, label, weather: null, note: "有地点但拿不到它的编号，天气没查" };
  }

  /* ---------------- 第 3 步：查天气（带缓存）---------------- */

  if (!force && s.weatherText && s.weatherAt && now - s.weatherAt < WEATHER_TTL) {
    return { ok: true, label, weather: s.weatherText };
  }

  const w = await weatherNow(locQuery);
  if (!w.ok) return { ok: false, reason: w.reason };

  const line = weatherLine(w.now);
  st.patchSettings({ weatherText: line, weatherAt: Date.now() });
  return { ok: true, label, weather: line };
}

/** 「省+市+区」拼一个给人看的地名（跟 qweather.ts 里的规则一致） */
function niceLabel(p: GeoPlace): string {
  const a1 = p.adm1 ?? "";
  const a2 = p.adm2 ?? "";
  const city = a1 && a2 && a1 !== a2 ? `${a1}${a2}` : a1 || a2;
  if (city && p.name && !city.includes(p.name)) return `${city}${p.name}`;
  return city || p.name || "";
}
