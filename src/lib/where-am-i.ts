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
/**
 * **按 IP 认的城市只算"临时兜底"**：5 分钟。
 *
 * 为什么单独一个更短的：2026-11 真机 —— 用户人在河北，一次系统定位失败退到 IP，
 * IP 库把他认成海南；而它和系统定位共用 30 分钟缓存，于是**整整半小时都显示海南**，
 * 刷新也没用（用户："我点刷新还是刷到了海南"）。IP 是城市级、又常认错，
 * 不配占用那 30 分钟。
 */
export const IP_PLACE_TTL = 5 * 60_000;

/**
 * **这个地点是哪来的** —— 主动感知（`sense.place`）要把它一起报给 AI。
 *
 * 为什么必须带上来源：定位有个已知的"飘"（用户机器上显示海南）。
 * 只说"你在海南"是一句没法判断真假的话；说清"按 IP 认的城市"，
 * 他和用户就都知道这句该信几分（用户原话："照实返回即可，带上来源"）。
 */
export type PlaceSourceKind = "manual" | "system" | "ip" | "cache";

export type RefreshResult =
  | { ok: true; label: string; weather: string | null; note?: string; source: PlaceSourceKind }
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
  /** 这个地点是哪来的（`sense.place` 会把它一起报出去） */
  let source: PlaceSourceKind = "cache";
  /** 额外要如实说的一句（例如"实时定位没成，先用你手填的"）—— 有就带回给界面和 AI */
  let note: string | undefined;

  /* ---------------- 第 1 步：定地点 ---------------- */

  /** 手填的那份（`force` 时它只当**兜底**，不再无条件优先 —— 见下面「刷新」的语义） */
  const manualText = manual && manual.ok ? manual.label : "";

  /*
    ⚠️ 「刷新」的语义（2026-11 用户实测逼出来的）：他说"点刷新还是刷到了海南"。
    原来手填地点**无条件优先**，连 `force = true`（设置页那个「刷新」按钮、
    AI 带 `fresh:true`）也绕不过去 —— 那个按钮等于假的。
    现在：**带了 force 就真去定位一次**，只有实时这条路全断了才退回手填的（并如实说明）。
  */
  if (manualText && !force) {
    // 手动填的：直接用，不查任何服务
    label = manualText;
    source = "manual";
    /*
      ⚠️ 这里原来写的是 `locQuery = s.geoPlaceId || null` —— **真机 bug 的根**：
      那个编号可能是**上一个地方**留下的。用户在手填框里换了个地点，它照样拿旧编号
      去查天气 → 界面名字是他新填的、天气是旧地方的（"我填哪天气都一样"）。
      现在编号必须"就是为这串文字查出来的"才敢复用。
    */
    locQuery = s.geoPlaceFor && s.geoPlaceFor === manualText ? s.geoPlaceId || null : null;
  } else if (
    !force &&
    s.geoLabel &&
    s.geoAt &&
    // ⚠️ IP 来的地点只当 5 分钟的临时兜底（见 IP_PLACE_TTL 的说明），别拿它糊住半小时
    now - s.geoAt < (s.geoSource === "ip" ? IP_PLACE_TTL : PLACE_TTL)
  ) {
    // 缓存还新鲜
    label = s.geoLabel;
    source = "cache";
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
      source = "system";
      locQuery = sys.placeId ?? null;
      st.patchSettings({
        geoLabel: sys.label,
        geoAt: now,
        ...(sys.placeId ? { geoPlaceId: sys.placeId } : {}),
        // 这条编号不是"为某串手填文字"查的 —— 清掉标记，免得被手填那条路复用
        geoPlaceFor: "",
        // 来源要记：IP 来的地点只算 5 分钟临时兜底（见 IP_PLACE_TTL）
        geoSource: "system",
      });
    } else {
      const ip = await locateByIpCached();
      if (!ip.ok) {
        /**
         * 实时这条路全断了。**这时候才退回手填的那份**（它本来就是"不依赖任何服务"的兜底），
         * 而且必须说清是兜底 —— 不能让用户以为这就是实时定位的结果。
         */
        if (manualText) {
          label = manualText;
          source = "manual";
          locQuery = null; // 交给下面第 2 步去搜一次编号
          note = `实时定位这次没成（${sys.reason}），先用你手填的「${manualText}」`;
        } else {
          return {
            ok: false,
            reason:
              `${sys.reason}\n\n` +
              `按 IP 也没认出城市（${ip.reason}）。\n` +
              `最省事的办法：在上面「你常待的地方」填一个，比如「北京市朝阳区」` +
              `—— 那样不用定位、不用网络，点刷新立刻就出天气。`,
          };
        }
      } else {
        label = ip.label;
        source = "ip";
        // IP 只给到城市，还得搜一次拿和风的编号
        const sres = await searchPlace(ip.label);
        if (!sres.ok) {
          return { ok: false, reason: `按 IP 认出「${ip.label}」，但和风查不到这个地方：${sres.reason}` };
        }
        const p = sres.places[0]!;
        locQuery = p.id;
        label = niceLabel(p) || ip.label;
        st.patchSettings({
          geoLabel: label,
          geoAt: now,
          geoPlaceId: p.id,
          geoPlaceFor: "",
          // ⚠️ 标成 ip：它只值 5 分钟（这一条就是"海南粘住半小时"的修复）
          geoSource: "ip",
        });
      }
    }
  }

  /* ---------------- 没有和风：地点有了就行 ---------------- */

  if (!weatherConfigured()) {
    return {
      ok: true,
      label,
      weather: null,
      source,
      note: note ?? "没配和风天气，所以只有地点、没有天气",
    };
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
    // ⚠️ 一起记下"这个编号是为哪串文字查的" —— 下次只有文字没变才敢复用（见文件头那个 bug）
    st.patchSettings({ geoPlaceId: p.id, geoPlaceFor: manual.label, geoLabel: nice || label, geoAt: now });
    if (nice) label = nice;
  }

  if (!locQuery) {
    return {
      ok: true,
      label,
      weather: null,
      source,
      note: note ?? "有地点但拿不到它的编号，天气没查",
    };
  }

  /* ---------------- 第 3 步：查天气（带缓存）---------------- */

  /*
    ⚠️ 缓存必须**跟地点绑定**：原来只判"15 分钟内"，于是换个地方点刷新照样端出旧天气
    （真机表现："我填哪天气都一样"）。现在 `weatherFor` 跟当前查询对不上就重查。
    `force`（用户说"刷新/现在就查"）则连这个都跳过。
  */
  if (
    !force &&
    s.weatherText &&
    s.weatherAt &&
    s.weatherFor === locQuery &&
    now - s.weatherAt < WEATHER_TTL
  ) {
    return { ok: true, label, weather: s.weatherText, source, ...(note ? { note } : {}) };
  }

  const w = await weatherNow(locQuery);
  if (!w.ok) return { ok: false, reason: w.reason };

  const line = weatherLine(w.now);
  // 一起记下"这条天气是为哪个查询查的" —— 下次只有查询没变才敢当缓存用
  st.patchSettings({ weatherText: line, weatherAt: Date.now(), weatherFor: locQuery });
  return { ok: true, label, weather: line, source, ...(note ? { note } : {}) };
}

/** 「省+市+区」拼一个给人看的地名（跟 qweather.ts 里的规则一致） */
function niceLabel(p: GeoPlace): string {
  const a1 = p.adm1 ?? "";
  const a2 = p.adm2 ?? "";
  const city = a1 && a2 && a1 !== a2 ? `${a1}${a2}` : a1 || a2;
  if (city && p.name && !city.includes(p.name)) return `${city}${p.name}`;
  return city || p.name || "";
}
