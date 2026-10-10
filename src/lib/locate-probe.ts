/**
 * **定位自检** —— 把"这个地点到底是怎么来的"每一步的原始事实摊开。
 *
 * ── 为什么要有它（2026-11 真机）────────────────────────────────
 *
 * 用户："我点刷新还是刷到了海南。"（他人在河北）
 *
 * 光看结果永远分不出是哪种坏法，而这几种在界面上长得**一模一样**：
 *   · 手填了「你常待的地方」→ 它**盖住**实时定位（这条路的优先级最高，连"刷新"也绕不过）
 *   · 系统定位这次失败（室内），退到了 **IP** → IP 库把他认成海南
 *   · 上一次的 IP 结果被缓存了（`locateByIpCached` 一小时）
 * 所以这里每一步都**单独跑一遍**，各自报告：成没成、拿到什么、花了多久、原始报错是什么。
 * 结论一句话：现在会显示哪个来源。
 *
 * ⚠️ 这一层只做"读"，不改任何设置、不写任何缓存（点几次都不会污染状态）。
 */
import { IS_APP } from "@/lib/platform";
import { toQWeatherFix } from "@/lib/coord";
import { probeIpProviders, type IpAttempt } from "@/lib/ip-locate";
import { reversePlace, weatherConfig } from "@/lib/qweather";
import { useApp } from "@/lib/store";

export type ProbeStep = { name: string; ok: boolean; detail: string; ms: number };
export type LocateProbe = { steps: ProbeStep[]; verdict: string };

type Coords = { lat: number; lon: number; accuracy: number | null; why?: string };

/** 单独跑一次系统定位（不读缓存、不写设置） */
async function probeSystem(timeoutMs = 12_000): Promise<Coords> {
  if (!IS_APP) {
    // 网页版也能测：走浏览器的 geolocation
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return { lat: 0, lon: 0, accuracy: null, why: "这个外壳没有定位接口" };
    }
  } else {
    try {
      const mod = await import("@capacitor/geolocation");
      const api = mod.Geolocation as unknown as {
        checkPermissions: () => Promise<{ location: string; coarseLocation: string }>;
        requestPermissions: () => Promise<{ location: string; coarseLocation: string }>;
        getCurrentPosition: (o: {
          enableHighAccuracy?: boolean;
          timeout?: number;
          maximumAge?: number;
        }) => Promise<{ coords: { latitude: number; longitude: number; accuracy?: number } }>;
      };
      const perm = await api.checkPermissions();
      if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
        const asked = await api.requestPermissions();
        if (asked.location !== "granted" && asked.coarseLocation !== "granted") {
          return { lat: 0, lon: 0, accuracy: null, why: "定位权限没给" };
        }
      }
      // maximumAge = 0：**不许拿缓存位置**，自检要的就是"此刻真实拿得到吗"
      const pos = await api.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: timeoutMs,
        maximumAge: 0,
      });
      return {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null,
      };
    } catch (e) {
      return { lat: 0, lon: 0, accuracy: null, why: e instanceof Error ? e.message : String(e ?? "失败") };
    }
  }
  // 网页版
  return await new Promise<Coords>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: typeof p.coords.accuracy === "number" ? p.coords.accuracy : null,
        }),
      (err) => resolve({ lat: 0, lon: 0, accuracy: null, why: `浏览器定位失败（code ${err.code}）` }),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

const fmt = (n: number) => n.toFixed(5);
const fmtAccuracy = (a: number | null) => (a === null ? "系统没给精度" : `精度约 ${Math.round(a)} 米`);

/**
 * 跑一遍定位自检。**每一步各自计时、各自失败**，最后给一句结论。
 * 不发任何写操作；每一次调用都会真的去定位一次（所以别在页面里循环调它）。
 */
export async function probeLocation(): Promise<LocateProbe> {
  const steps: ProbeStep[] = [];
  const s = useApp.getState().settings;

  /* 1. 前提：开关、手填、天气服务 */
  const manual = (s.manualPlace ?? "").trim();
  const cfg = weatherConfig();
  steps.push({
    name: "① 开关与配置",
    ok: Boolean(s.geoEnabled) && Boolean(cfg),
    detail: [
      s.geoEnabled ? "定位开关：开着" : "定位开关：**关着**（关着不会查任何东西）",
      manual
        ? `手填了「你常待的地方」= **${manual}** —— 它优先级最高，**会盖住实时定位**（点刷新也一样）`
        : "手填地点：空（会走实时定位）",
      cfg ? `天气服务：配了（host=${cfg.host}）` : "天气服务：**没配** —— 坐标没法翻成地名",
    ].join("；"),
    ms: 0,
  });

  /* 2. 系统定位（此刻真拿一次） */
  const t0 = Date.now();
  const sys = await probeSystem();
  const sysMs = Date.now() - t0;
  const sysOk = !sys.why;
  steps.push({
    name: "② 系统定位（此刻真拿一次，不用缓存）",
    ok: sysOk,
    detail: sysOk
      ? `${fmt(sys.lat)}, ${fmt(sys.lon)}（WGS-84）；${fmtAccuracy(sys.accuracy)}`
      : `**没拿到**：${sys.why}`,
    ms: sysMs,
  });

  /* 3. 和风反查（用系统给的坐标，转成 GCJ-02 再查） */
  let sysLabel = "";
  if (sysOk && cfg) {
    const t1 = Date.now();
    const g = toQWeatherFix(sys.lat, sys.lon);
    const r = await reversePlace(g.lat, g.lon);
    steps.push({
      name: "③ 用系统坐标反查地名",
      ok: r.ok,
      detail: r.ok
        ? `→ 「${r.label}」（送给和风的是 ${fmt(g.lat)}, ${fmt(g.lon)}，已从 WGS-84 转 GCJ-02）`
        : `**失败**：${r.reason}`,
      ms: Date.now() - t1,
    });
    if (r.ok) sysLabel = r.label;
  } else {
    steps.push({
      name: "③ 用系统坐标反查地名",
      ok: false,
      detail: sysOk ? "没配天气服务，跳过" : "系统定位没拿到坐标，跳过",
      ms: 0,
    });
  }

  /* 4. 三家 IP 服务各给了什么 */
  const t2 = Date.now();
  let attempts: IpAttempt[] = [];
  try {
    attempts = await probeIpProviders();
  } catch {
    attempts = [];
  }
  const hit = attempts.find((a) => a.ok);
  steps.push({
    name: "④ 按 IP 认城市（逐家问）",
    ok: Boolean(hit),
    detail: attempts.length
      ? attempts
          .map((a) =>
            a.ok
              ? `${a.name} → ${a.lat !== undefined ? fmt(a.lat) : "?"}, ${a.lon !== undefined ? fmt(a.lon) : "?"}${a.city ? `（${a.city}）` : ""} · ${a.ms}ms`
              : `${a.name} ✗ ${a.why ?? "没结果"} · ${a.ms}ms`,
          )
          .join("；")
      : "三家都没答上来（可能没网，或者都不让网页调）",
    ms: Date.now() - t2,
  });

  /* 5. 结论：现在会显示哪个 */
  let verdict: string;
  if (manual) {
    verdict = `现在会显示 **${manual}**（手填的盖住了一切；要恢复实时定位就把那一栏清空）`;
  } else if (sysLabel) {
    verdict = `现在会显示 **${sysLabel}**（系统定位那条路是通的）`;
  } else if (sysOk) {
    verdict = "系统定位拿到了坐标，但**没配天气服务**，翻译不成地名（所以只会退回 IP 或失败）";
  } else if (hit) {
    verdict = `系统定位没成 → 会退到 **IP**（这一家认的是 ${hit.city ?? "某个城市"}）—— 这就是"地点不对"的常见来源`;
  } else {
    verdict = "两条路都没成：现在只会报失败（并提示你填一个手动地点）";
  }

  return { steps, verdict };
}
