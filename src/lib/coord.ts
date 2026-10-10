/**
 * 坐标系换算：**WGS-84 → GCJ-02**（俗称"火星坐标"）。
 *
 * ── 为什么需要（2026-11，先查了官方文档才敢写）────────────────────
 *
 * 和风天气《专用词汇表》「坐标」那节的原话：
 *   **"中国大陆地区应使用 GCJ-02 坐标系，在其他地区应使用 WGS-84 坐标系。"**
 *
 * 而我们手上这几个来源给的全是 **WGS-84**：
 *   · 系统定位（`@capacitor/geolocation`）—— GPS 原始坐标
 *   · 三家 IP 服务（ipwho.is / ipinfo.io / geojs）—— 国际口径
 * 所以**境内**必须先转成 GCJ-02 再交给和风反查地名，否则会差几十~几百米。
 * 城区里这点偏差无所谓，但**在行政区边界附近可能反查到隔壁区/市** ——
 * 用户说的"定位抓得不对"里，有这一份。
 *
 * ⚠️ 以后接了高德：**高德给的本来就是 GCJ-02，不要再转**（转两次就偏了）。
 * 调用点只有两个：`locate.ts`（系统定位那条路）和 `ip-locate.ts`（IP 那条路）。
 *
 * 算法是公开的标准做法（偏移量 + 二次修正），**纯函数、不发任何请求**，
 * 所以验收脚本可以直接拿几个点对拍。
 */

const PI = Math.PI;
/** 克拉索夫斯基椭球长半轴 */
const A = 6378245.0;
/** 第一偏心率平方（写成这个位数就够了：再多也没有额外精度，eslint 反而会报） */
const EE = 0.00669342162296594;

/** 粗略判断在不在中国境内（这个矩形是通行做法，够用） */
export function outOfChina(lat: number, lon: number): boolean {
  return !(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x: number, y: number): number {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return ret;
}

export type Coord = { lat: number; lon: number; converted: boolean };

/** WGS-84 → GCJ-02（境外原样返回，`converted: false`） */
export function wgs84ToGcj02(lat: number, lon: number): Coord {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { lat, lon, converted: false };
  if (outOfChina(lat, lon)) return { lat, lon, converted: false };

  const dLat0 = transformLat(lon - 105, lat - 35);
  const dLon0 = transformLon(lon - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLat = (dLat0 * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  const dLon = (dLon0 * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lat: lat + dLat, lon: lon + dLon, converted: true };
}

/**
 * **交给和风之前统一走这一个**（名字直说用途，免得有人忘了转）。
 * 输入必须是 WGS-84（系统定位 / IP 服务那两路）；高德那条路不要用它。
 */
export function toQWeatherFix(lat: number, lon: number): Coord {
  return wgs84ToGcj02(lat, lon);
}
