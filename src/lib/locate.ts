import { IS_APP } from "@/lib/platform";
import { toQWeatherFix } from "@/lib/coord";
import { reversePlace, weatherConfigured } from "@/lib/qweather";
import { useApp } from "@/lib/store";

/**
 * 定位。
 *
 * 两件事必须说清（用户问过"定位拿来干嘛"）：
 *   · 拿到的地名会进"此刻的情况"，也就是说**会发给你接的那家 AI** ——
 *     所以默认关，开了以后设置里随时能关
 *   · 反查地名现在走**和风天气的 GeoAPI**
 *
 * ── 为什么从 OpenStreetMap 换成和风（2026-10）────────────────────
 *
 * 用户实测："定位订不了"。查下来根因不在手机定位：
 *   第 1 步 拿坐标 —— 系统给的，一直好好的
 *   第 2 步 坐标→地名 —— 原来打的是 nominatim.openstreetmap.org，
 *                        那个**国内经常连不上**，6 秒就放弃
 * 所以表现就是"授权了、也开了定位，但一直没结果"。
 *
 * 和风是国内服务、国内可达，而且免费额度每月 5 万次，
 * 它的 GeoAPI 正好就是"坐标 → 地名"。一次配好，定位和天气都能用。
 */

type GeoPlugin = {
  checkPermissions: () => Promise<{ location: string; coarseLocation: string }>;
  requestPermissions: () => Promise<{ location: string; coarseLocation: string }>;
  getCurrentPosition: (opts?: {
    enableHighAccuracy?: boolean;
    timeout?: number;
    /** 接受多久以内的缓存位置（毫秒）—— 加上它定位快很多 */
    maximumAge?: number;
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

/**
 * 反查地名：坐标 → "北京市朝阳区"。
 *
 * 走和风 GeoAPI（原来那个 nominatim 国内连不上，是"定位订不了"的真正原因）。
 * 没配和风时**如实说清楚**，而不是含糊一句"失败"——
 * 用户要知道该去配什么。
 */
async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<{ ok: true; label: string; placeId: string } | { ok: false; reason: string }> {
  if (!weatherConfigured()) {
    return {
      ok: false,
      reason:
        "拿到了坐标，但没法翻译成地名 —— 去「我的 → 系统 → 天气与定位」填上和风天气的 Key 和 API Host。",
    };
  }
  const r = await reversePlace(lat, lon);
  if (!r.ok) return { ok: false, reason: `反查地名失败：${r.reason}` };
  // placeId 一起带回去 —— 查天气要用它，省一次搜索请求
  return { ok: true, label: r.label, placeId: r.place.id };
}

export type PlaceResult =
  | { ok: true; label: string; lat: number; lon: number; placeId?: string }
  | { ok: false; reason: string };

/**
 * 拿当前位置。
 *
 * **总超时 20 秒**：不管哪条路卡住，一定有结果 ——
 * 界面上绝不能一直停在"定位中"（用户实测遇到过：授权了、但一直没结果）。
 */
export async function currentPlace(): Promise<PlaceResult> {
  return await Promise.race([
    locateOnce(),
    new Promise<PlaceResult>((resolve) =>
      window.setTimeout(
        () =>
          resolve({
            ok: false,
            reason:
              "系统定位超时了（室内 GPS 信号弱时很常见 —— 这跟国内外无关）。" +
              "别急，下面还有按 IP 认城市的兜底。",
          }),
        // 要比 locateOnce 内部的 25 秒长，否则内层还没试完外层就先判超时了
        30000,
      ),
    ),
  ]);
}

async function locateOnce(): Promise<PlaceResult> {
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
      /*
        maximumAge 给 5 分钟：附近有缓存位置就直接用，别重新走一遍定位。
        timeout 给 25 秒（原来 12 秒）：室内冷启动经常要 15~30 秒，
        12 秒太短，会误报"定位失败"。
        enableHighAccuracy 保持 false —— 它允许系统优先用 WiFi/基站，
        比死等卫星快得多（这也是手机自带天气在室内也能定位的原因）。
        ⚠️ 但 WebView 里这条不一定有 WiFi 辅助，所以 **IP 定位才是室内兜底**，
        见 where-am-i.ts 的三级兜底。
      */
      const pos = await g.api.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 25000,
        maximumAge: 300000,
      });
      coords = pos.coords;
    } catch (e) {
      /**
       * 把**原始报错**一起带上。
       *
       * 用户实测："定位显示失败，我开了定位权限了" —— 权限只是第一步，
       * 手机的**定位服务开关**（下拉菜单那个）常常是关着的，
       * 这两种情况报错不一样。含糊地说"失败了"他没法判断，
       * 所以把插件原话贴出来，他一看就知道该去开哪个开关。
       */
      const raw = e instanceof Error ? e.message : String(e ?? "");
      const hint = /denied|permission/i.test(raw)
        ? "权限被拒了：去「设置 → 应用 → 栖岛 → 权限」把位置改成「允许」"
        : /disabled|location.*off|settings/i.test(raw)
          ? "手机的定位服务没开：从屏幕顶端下拉，把「位置信息」打开"
          : "可能是室内信号不好；去窗边或户外再试一次，或者先打开地图 App 定个位再来";
      return { ok: false, reason: `定位失败：${hint}${raw ? `（原始报错：${raw.slice(0, 120)}）` : ""}` };
    }
  } else if (IS_APP) {
    /**
     * ⚠️ App 里**不要**退回浏览器的 navigator.geolocation。
     *
     * WebView 的定位要宿主自己处理权限请求；没处理的话那个回调**永远不会回来**，
     * 界面就一直卡在"定位中"（用户实测就是这样：系统里授权了、但没结果）。
     * 宁可如实说"没接上"，也别让他干等。
     */
    return { ok: false, reason: "这个版本里没接上系统定位，装最新版再试" };
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

  /*
    ⚠️ 坐标系：到这里的坐标是 **WGS-84**（系统定位给的原始 GPS），
    而和风文档明说大陆要用 **GCJ-02** —— 所以反查地名之前必须先转（见 lib/coord.ts）。
    不转的后果是差几十~几百米，边界附近会反查到隔壁区/市（用户："抓的不对"）。
    以后接了高德：那条路本来就是 GCJ-02，**不要**经过这里。
  */
  const fix = toQWeatherFix(coords.latitude, coords.longitude);
  const geo = await reverseGeocode(fix.lat, fix.lon);
  if (!geo.ok) {
    // 坐标拿到了，只是翻译地名失败 —— **分开报**，用户才知道卡在哪一步
    return { ok: false, reason: geo.reason };
  }
  return {
    ok: true,
    label: geo.label,
    lat: coords.latitude,
    lon: coords.longitude,
    placeId: geo.placeId,
  };
}

/**
 * 手动指定的地点（不查坐标，直接用）。
 *
 * 用户："我平时打车的时候高德已经知道我身份了" —— 他其实想要的是
 * "他聊天时知道我在哪个地方"，而那件事**填一次就够了**：
 * 日常就在那一两个地方，比每次自动定位更准，而且**不依赖任何服务**。
 *
 * 所以这个入口永远可用，不要求配和风。
 */
export function manualPlaceResult(): PlaceResult | null {
  const label = (useApp.getState().settings.manualPlace ?? "").trim();
  if (!label) return null;
  return { ok: true, label, lat: 0, lon: 0 };
}
