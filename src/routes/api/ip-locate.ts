import { createFileRoute } from "@tanstack/react-router";

/**
 * 按 IP 认城市 —— **服务端**代理。
 *
 * ── 为什么要绕一道（实测结论）────────────────────────────────
 *
 * 直接在浏览器里 fetch 那几个免费 IP 服务，**全都失败**：
 *   TypeError: Failed to fetch
 * 因为它们不返回 CORS 头，浏览器**在请求发出前就拦掉了**。
 * 注意这**不是**"用户手机没网" —— 同一个页面里和风的请求正常发出去
 * （能拿到 401/200），说明网络是通的，只是那几个服务不允许网页直接调。
 *
 * 所以改由**服务端**去问（服务端没有 CORS 这回事）。
 *
 * ── 服务怎么选（都实测过）────────────────────────────────────
 *
 *   ipwho.is   ✅ 干净 UTF-8，**而且给经纬度** → 最优先
 *   geojs      ✅ 干净 UTF-8，但**坐标不准**（杭州的 IP 给了郑州的坐标）→ 次选
 *   pconline   ❌ 返回 **GBK**，解出来是乱码（`ʯ��ׯ��`）→ 弃用
 *   ipapi.co   ❌ 被 Cloudflare 挡了（403 + "Just a moment"）→ 弃用
 *   百度       ❌ 空 query 直接报"参数错误"→ 要传 IP，麻烦 → 弃用
 *
 * ── 为什么返回坐标而不是城市名 ───────────────────────────────
 * ipwho.is 给的是**英文**城市名（"Hangzhou"、"Zhejiang Sheng"）。
 * 与其自己拼中文（还得维护一张"Zhejiang Sheng → 浙江"的表），
 * 不如把**经纬度交给和风**反查 —— 和风本来就干这个，
 * 而且反查出来的中文地名跟它的天气接口是同一套编号，最稳。
 */
export const Route = createFileRoute("/api/ip-locate")({
  server: {
    handlers: {
      GET: async () => {
        /** 问 ipwho.is 拿经纬度（英文地名只当兜底） */
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 6000);
          const res = await fetch("https://ipwho.is/", { signal: ctrl.signal });
          clearTimeout(timer);
          if (res.ok) {
            const j = (await res.json()) as {
              success?: boolean;
              latitude?: number;
              longitude?: number;
              city?: string;
              region?: string;
            };
            const lat = Number(j.latitude);
            const lon = Number(j.longitude);
            if (j.success !== false && Number.isFinite(lat) && Number.isFinite(lon)) {
              return Response.json({
                ok: true,
                lat,
                lon,
                // 英文城市名交给页面决定要不要用（和风搜不动时才退回它）
                fallbackLabel: (j.city ?? "").trim() || (j.region ?? "").trim(),
                via: "ipwho.is",
              });
            }
          }
        } catch {
          /* 换下一家 */
        }

        /** 兜底：geojs（坐标糙，但好歹有） */
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 6000);
          const res = await fetch("https://get.geojs.io/v1/ip/geo.json", { signal: ctrl.signal });
          clearTimeout(timer);
          if (res.ok) {
            const j = (await res.json()) as { latitude?: string; longitude?: string; city?: string };
            const lat = Number(j.latitude);
            const lon = Number(j.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              return Response.json({
                ok: true,
                lat,
                lon,
                fallbackLabel: (j.city ?? "").trim(),
                via: "geojs",
              });
            }
          }
        } catch {
          /* 都不行就如实说 */
        }

        return Response.json({ ok: false, reason: "两个 IP 服务都没答上来" }, { status: 502 });
      },
    },
  },
});
