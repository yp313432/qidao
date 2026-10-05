import { useApp } from "@/lib/store";
import { reversePlace } from "@/lib/qweather";

/**
 * 按 IP 推城市 —— **室内也能用**的兜底定位。
 *
 * ── 为什么要它 ──────────────────────────────────────────────
 *
 * 用户实测："定位失败：可能是室内信号不好（原始报错：Could not obtain location in time）"。
 * GPS 是**卫星信号**，室内基本定不到 —— 但手机自带天气、高德在室内却能定位，
 * 因为它们走 **WiFi + 基站**，而 WebView 那层拿不到这些。
 * 所以加一条不依赖 GPS、不依赖权限的路：连着网就能认出你在哪个城市。
 *
 * ── 三道坎，全都踩过（这段别删，省得以后重复踩）─────────────
 *
 * ① **CORS**：一开始选的几家（pconline / ipapi / 百度 / taobao）
 *    **都不返回 CORS 头** → 浏览器在请求发出前就拦掉，报
 *    `TypeError: Failed to fetch`。用户那句"我手机是有网的，为啥 IP 也不可以"
 *    就是这个 —— 不是没网，是那几家不让网页调。
 *
 * ② **编码**：pconline 返回 **GBK**，解出来是 `ʯ��ׯ��` 这种乱码。
 *
 * ③ **我绕错的路**：为了躲 CORS，我一度改成走 `/api/ip-locate`（服务端代理）。
 *    在开发环境能通，**但 APK 里根本没有服务端** ——
 *    vite.config.ts 写着：`QIDAO_TARGET === "android"` 时走**纯前端（SPA）构建**
 *    （见 vite.config 里 ANDROID 那段）。所以手机上那个接口不存在，等于白做。
 *
 * 正解：**只用 CORS 友好的**（实测过响应头）：
 *    ipwho.is      ✅ CORS=*  UTF-8  **给坐标**
 *    get.geojs.io  ✅ CORS=*  UTF-8  给坐标（但糙：杭州的 IP 给过郑州的坐标）
 *    ipinfo.io     ✅ CORS=*  UTF-8  给坐标 + 城市名
 * 这三个在**网页和 APK 里都能直接调**，不需要任何服务端。
 *
 * ── 为什么拿坐标而不是城市名 ────────────────────────────────
 * 这几家给的是**英文**（"Hangzhou"、"Zhejiang Sheng"）。
 * 与其维护"Zhejiang Sheng → 浙江"的对照表，不如把**经纬度交给和风**反查 ——
 * 和风本来就干这个，而且反查出的地名跟它的天气接口是同一套编号，最稳。
 */

type Fix = { lat: number; lon: number; city?: string };

/** 挨家问，谁先给出坐标用谁 */
async function askProviders(): Promise<Fix | null> {
  const providers: { name: string; url: string; pick: (j: unknown) => Fix | null }[] = [
    {
      name: "ipwho.is",
      url: "https://ipwho.is/",
      pick: (j) => {
        const o = j as { success?: boolean; latitude?: number; longitude?: number; city?: string };
        if (o.success === false) return null;
        const lat = Number(o.latitude);
        const lon = Number(o.longitude);
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, city: o.city } : null;
      },
    },
    {
      name: "ipinfo.io",
      url: "https://ipinfo.io/json",
      pick: (j) => {
        const o = j as { loc?: string; city?: string };
        // loc 形如 "30.2936,120.1614"
        const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec((o.loc ?? "").trim());
        if (!m) return null;
        return { lat: Number(m[1]), lon: Number(m[2]), city: o.city };
      },
    },
    {
      name: "geojs",
      url: "https://get.geojs.io/v1/ip/geo.json",
      pick: (j) => {
        const o = j as { latitude?: string; longitude?: string; city?: string };
        const lat = Number(o.latitude);
        const lon = Number(o.longitude);
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, city: o.city } : null;
      },
    },
  ];

  for (const p of providers) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(p.url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const fix = p.pick(await res.json());
      if (fix) return fix;
    } catch {
      // 这家不行（可能又是 CORS），试下一家
    }
  }
  return null;
}

/** 认城市：先拿坐标，再让和风反查中文地名；和风搜不动才退回英文城市名 */
export async function locateByIp(): Promise<
  { ok: true; label: string } | { ok: false; reason: string }
> {
  const fix = await askProviders();
  if (!fix) {
    return {
      ok: false,
      reason: "几个 IP 服务都没答上来（可能都没网，或者都不让网页调用）",
    };
  }

  // 优先：坐标 → 和风反查中文地名
  const rev = await reversePlace(fix.lat, fix.lon);
  if (rev.ok) return { ok: true, label: rev.label };

  // 退回英文城市名（和风搜不动时至少别空手）
  if (fix.city) return { ok: true, label: fix.city };

  return { ok: false, reason: `认出了坐标但翻译不出地名：${rev.reason}` };
}

/**
 * 记住上一次的结果，一小时内不重复查。
 *
 * 这类免费服务有频率限制，而且**城市一天之内基本不变** ——
 * 没必要每次刷新都问一遍。
 */
let ipCache: { label: string; at: number } | null = null;
const IP_TTL = 3600_000;

export async function locateByIpCached(): Promise<
  { ok: true; label: string } | { ok: false; reason: string }
> {
  if (ipCache && Date.now() - ipCache.at < IP_TTL) {
    return { ok: true, label: ipCache.label };
  }
  const r = await locateByIp();
  if (r.ok) ipCache = { label: r.label, at: Date.now() };
  return r;
}

/** 供设置页显示"上次是怎么定到的" */
export function lastIpLabel(): string {
  return ipCache?.label ?? useApp.getState().settings.geoLabel ?? "";
}
