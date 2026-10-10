/**
 * 服务端"联网"工具 —— `/api/read`、`/api/search`、`/api/hot`、`/api/wake` 共用的东西。
 *
 * 为什么这些事要放到服务端（用户自己的 Cloudflare Worker）做：
 *   · 浏览器/WebView 有跨域限制，**任意网页都读不了**（实测 example.com、百度都一样：
 *     网络明明是通的，就是不给读）。放服务端就没这个限制。
 *   · 密钥（搜索 API 的 key）放在服务端环境变量里，**手机上什么都不用存**。
 *   · 跨域头由我们自己加，App 那边想怎么调就怎么调。
 *
 * ⚠️ 2026-10 拆分：**纯函数**（`isPublicHttpUrl` / `htmlToText`）搬去了
 * `lib/web-extract.ts` —— 因为手机版（APK）里没有服务端，那两件事要搬到端上做
 * （见 `lib/web-http.ts`），而"抽正文规则"必须**只有一份**。
 * 这里 re-export 出去，`routes/api/*.ts` 那几行 import **一个字都不用改**。
 */

import { htmlToText, isPublicHttpUrl, WEB_FETCH_HEADERS } from "@/lib/web-extract";

export { htmlToText, isPublicHttpUrl };

/** 统一的跨域头：App 的 WebView 源是 `https://localhost`，所以用 * 就行。 */
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-qidao-pass",
  "access-control-max-age": "86400",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}

/** 跨域预检：路由自己答（预检不带数据，放行无害） */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * 带超时和大小上限地取一个网页。服务端做这件事的风险是"对方一直不返回/返回巨大"，
 * 所以两个上限都要有 —— 不然这个接口就成了拖垮 Worker 的入口。
 */
export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<{ ok: true; status: number; finalUrl: string; text: string; truncated: boolean } | { ok: false; why: string }> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxBytes = opts.maxBytes ?? 400_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        // 很多站点对"没有 UA"的请求直接 403（口径跟端上那份**共用**，见 web-extract.ts）
        ...WEB_FETCH_HEADERS,
        ...(opts.headers ?? {}),
      },
    });
    const buf = await res.arrayBuffer();
    const truncated = buf.byteLength > maxBytes;
    const slice = truncated ? buf.slice(0, maxBytes) : buf;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    return { ok: true, status: res.status, finalUrl: res.url, text, truncated };
  } catch (err) {
    const msg = (err as Error).name === "AbortError" ? `超过 ${timeoutMs / 1000} 秒没响应` : (err as Error).message;
    return { ok: false, why: msg || "取不到" };
  } finally {
    clearTimeout(timer);
  }
}
