/**
 * 服务端"联网"工具 —— `/api/read`、`/api/search`、`/api/hot` 共用的东西。
 *
 * 为什么这些事要放到服务端（用户自己的 Cloudflare Worker）做：
 *   · 浏览器/WebView 有跨域限制，**任意网页都读不了**（实测 example.com、百度都一样：
 *     网络明明是通的，就是不给读）。放服务端就没这个限制。
 *   · 密钥（搜索 API 的 key）放在服务端环境变量里，**手机上什么都不用存**。
 *   · 跨域头由我们自己加，App 那边想怎么调就怎么调。
 */

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
 * 只允许"公网 http(s)" —— 防 SSRF。
 *
 * 这个接口是公网可达的（口令门没开时更是裸的），如果不管，别人就能拿它去戳
 * 内网服务（`http://10.0.0.1/admin`、`http://127.0.0.1:6379` 这类）。
 * 这里挡掉回环/内网/链路本地地址和非标准端口；域名解析到内网的情况（DNS rebinding）
 * 挡不干净，但个人自用够 —— 文档里写明了这个边界。
 */
export function isPublicHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; why: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, why: "不是合法网址" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, why: "只支持 http / https" };
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, why: "只允许 80 / 443 端口" };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return { ok: false, why: "本机/内网地址不给读" };
  }

  // IPv4 字面量：挡回环 / 私有 / 链路本地 / CGNAT
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const isPrivate =
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127);
    if (isPrivate) return { ok: false, why: "内网地址不给读" };
  }
  // IPv6 字面量：挡回环 / 唯一本地 / 链路本地
  if (host.includes(":") && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80"))) {
    return { ok: false, why: "内网地址不给读" };
  }
  return { ok: true, url };
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
        // 很多站点对"没有 UA"的请求直接 403
        "user-agent":
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
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

/** 把 HTML 弄成能读的纯文本（不做完美解析，够模型读就行） */
export function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1] ?? "").trim();
  const text = html
    // 整块丢掉脚本/样式/导航这些"读起来没意义"的部分
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // 换行语义：块级标签变空格，br/段落变换行
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    // 常见实体
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…")
    // 收尾：去掉多余空行
    .replace(/[ \t\f\v]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
  return { title, text };
}
