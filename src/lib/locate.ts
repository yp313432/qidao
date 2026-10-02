import { IS_APP } from "@/lib/platform";

/**
 * 定位。
 *
 * 两件事必须说清（用户问过"定位拿来干嘛"）：
 *   · 拿到的地名会进"此刻的情况"，也就是说**会发给你接的那家 AI** ——
 *     所以默认关，开了以后设置里随时能关
 *   · 地名反查用的是 OpenStreetMap 的 Nominatim（免费、不用密钥）：
 *     只发经纬度过去，不发别的
 */

type GeoPlugin = {
  checkPermissions: () => Promise<{ location: string; coarseLocation: string }>;
  requestPermissions: () => Promise<{ location: string; coarseLocation: string }>;
  getCurrentPosition: (opts?: {
    enableHighAccuracy?: boolean;
    timeout?: number;
  }) => Promise<{ coords: { latitude: number; longitude: number } }>;
};

/**
 * ⚠️ 跟通知插件一样：Capacitor 的插件对象是 thenable，
 * 不能从 async 函数里直接 return，必须包一层。
 */
async function geoPlugin(): Promise<{ api: GeoPlugin } | null> {
  if (!IS_APP) return null;
  try {
    const mod = await import("@capacitor/geolocation");
    return { api: mod.Geolocation as unknown as GeoPlugin };
  } catch {
    return null;
  }
}

/** 反查地名：只把经纬度发给 OSM，换成"北京市朝阳区"这种。6 秒不通就放弃（别把界面挂住） */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 6000);
  try {
    const url =
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=zh-CN" +
      `&lat=${lat}&lon=${lon}`;
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      address?: Record<string, string>;
      display_name?: string;
    };
    const a = j.address ?? {};
    const city = a.city ?? a.town ?? a.county ?? a.state ?? "";
    const district = a.suburb ?? a.city_district ?? a.district ?? a.neighbourhood ?? "";
    const label = `${city}${district}`.trim();
    if (label) return label;
    return j.display_name ? j.display_name.split(",").slice(0, 2).join(" ") : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export type PlaceResult =
  | { ok: true; label: string; lat: number; lon: number }
  | { ok: false; reason: string };

export async function currentPlace(): Promise<PlaceResult> {
  const g = await geoPlugin();
  let coords: { latitude: number; longitude: number } | null = null;

  if (g) {
    const perm = await g.api.checkPermissions();
    if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
      const asked = await g.api.requestPermissions();
      if (asked.location !== "granted" && asked.coarseLocation !== "granted") {
        return { ok: false, reason: "你还没允许定位权限" };
      }
    }
    try {
      const pos = await g.api.getCurrentPosition({ enableHighAccuracy: false, timeout: 12000 });
      coords = pos.coords;
    } catch {
      return { ok: false, reason: "定位失败（可能没开定位服务，或在室内信号不好）" };
    }
  } else {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return { ok: false, reason: "这个环境不支持定位" };
    }
    coords = await new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 12000 },
      );
    });
    if (!coords) return { ok: false, reason: "定位失败，或者你拒绝了浏览器的定位请求" };
  }

  const label = await reverseGeocode(coords.latitude, coords.longitude);
  return {
    ok: true,
    // 查不到地名就退回坐标 —— 宁可给个坐标，也别让用户以为定位没成功
    label: label ?? `坐标 ${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`,
    lat: coords.latitude,
    lon: coords.longitude,
  };
}
