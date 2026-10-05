import { useApp } from "@/lib/store";

/**
 * 按 IP 推城市 —— **室内也能用**的兜底定位。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 *
 * 用户实测："定位失败：可能是室内信号不好（原始报错：Could not obtain location in time）"。
 * 查下来：GPS 是**卫星信号**，室内基本定不到 —— 但手机自带天气、高德在室内却能定位，
 * 因为它们走的是 **WiFi + 基站**，而 WebView 那层拿不到这些。
 *
 * 所以给一条不依赖 GPS、不依赖权限的路：
 *   你连着 WiFi/4G → 出口 IP 所在的城市 → "北京市"
 *
 * 精度只到**城市级**，但查天气完全够（北京朝阳还是海淀，天气一样）。
 *
 * ── 为什么试多家 ─────────────────────────────────────────────
 * 单一家挂了就全废，而且这类免费服务**在国内可达性参差**。
 * 所以按顺序试，谁先答应用谁；全都失败就如实说，不编。
 */

type IpLocator = {
  name: string;
  url: string;
  /** 从返回的 JSON 里抠出「省+市」，抠不到就返回空串 */
  pick: (j: Record<string, unknown>) => string;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const LOCATORS: IpLocator[] = [
  {
    // 国内可达，中文字段，最省事
    name: "太平洋电脑网",
    url: "https://whois.pconline.com.cn/ipJson.jsp?json=true",
    pick: (j) => {
      const p = str(j.pro);
      const c = str(j.city);
      // 直辖市时 pro 和 city 可能一样，去个重
      return c && p && p !== c ? `${p}${c}` : c || p;
    },
  },
  {
    name: "ipapi.co",
    url: "https://ipapi.co/json/",
    pick: (j) => {
      const region = str(j.region);
      const city = str(j.city);
      return city && region && region !== city ? `${region}${city}` : city || region;
    },
  },
  {
    // 返回中文且稳定；免费额度足够个人用
    name: "百度",
    url: "https://opendata.baidu.com/api.php?query=&resource_id=6006&oe=utf8",
    pick: (j) => {
      type R = { data?: { location?: string }[] };
      const loc = str((j as R).data?.[0]?.location);
      // 形如「北京市朝阳区」或「北京市」—— 直接把省市区里的市一级留下
      const m = loc.match(/^(.+?[市州盟])/);
      return m ? m[1]! : loc;
    },
  },
];

/** 几个服务各试一次，谁先给结果用谁。总耗时上限约 4 秒一个。 */
export async function locateByIp(): Promise<{ ok: true; label: string } | { ok: false; reason: string }> {
  for (const l of LOCATORS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(l.url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const j = (await res.json()) as Record<string, unknown>;
      const label = l.pick(j);
      if (label) return { ok: true, label };
    } catch {
      // 这家不行，试下一家
    }
  }
  return { ok: false, reason: "按 IP 也认不出你在哪个城市" };
}

/**
 * 记住上一次的 IP 定位，一小时内不重复查。
 *
 * 这类免费服务有频率限制，而且**结果一天之内基本不变**，
 * 没必要每次刷新都问一遍（也保护你自己的网络请求量）。
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
