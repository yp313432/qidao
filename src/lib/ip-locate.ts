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
 * ── 两道坎，都踩过 ──────────────────────────────────────────
 *
 * ① **CORS**：直接在浏览器里 fetch 那些免费 IP 服务，**全都 Failed to fetch**
 *    （它们不返回 CORS 头，浏览器在请求发出前就拦了）。
 *    这不是"用户没网"—— 同页面里和风的请求是正常发出去的。
 *    → 所以改走 `/api/ip-locate`，让**服务端**去问。
 *
 * ② **编码**：pconline 返回 **GBK**，解出来是 `ʯ��ׯ��` 这种乱码；
 *    ipapi 被 Cloudflare 挡（403 + "Just a moment"）。
 *    → 只用返回干净 UTF-8 的（ipwho.is / geojs）。
 *
 * ── 为什么不直接要城市名 ────────────────────────────────────
 * ipwho.is 给的是**英文**（"Hangzhou"、"Zhejiang Sheng"）。
 * 与其维护一张"Zhejiang Sheng → 浙江"的对照表，
 * 不如把**经纬度交给和风**反查 —— 它本来就干这个，
 * 而且反查出来的地名跟它的天气接口是同一套编号，最稳。
 */

type IpFix = { lat: number; lon: number; fallbackLabel?: string; via: string };

async function askServer(): Promise<IpFix | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch("/api/ip-locate", { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean } & Partial<IpFix>;
    if (j.ok && Number.isFinite(j.lat) && Number.isFinite(j.lon)) {
      return {
        lat: j.lat as number,
        lon: j.lon as number,
        fallbackLabel: j.fallbackLabel,
        via: j.via ?? "?",
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** 认城市：先拿坐标，再让和风反查中文地名；和风搜不动才退回英文名 */
export async function locateByIp(): Promise<
  { ok: true; label: string } | { ok: false; reason: string }
> {
  const fix = await askServer();
  if (!fix) {
    return { ok: false, reason: "按 IP 也没能认出位置（我们自己的接口没答上来）" };
  }

  // 优先：坐标 → 和风反查中文地名
  const rev = await reversePlace(fix.lat, fix.lon);
  if (rev.ok) return { ok: true, label: rev.label };

  // 退回英文城市名（和风搜不动时至少别空手）
  if (fix.fallbackLabel) return { ok: true, label: fix.fallbackLabel };

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
