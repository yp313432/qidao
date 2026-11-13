/**
 * **端上取网页 / 搜网页** —— 手机版（APK）里"联网"这一层的入口。
 *
 * ── 为什么需要这个文件（这是手机版第一次真的能读网页）──────────────
 *
 * 原来"搜网页 / 读正文"只有两个**服务端路由**（`routes/api/search.ts`、
 * `routes/api/read.ts`），跑在用户自己的 Cloudflare Worker 上。
 * 但 APK 是**纯前端构建**（`QIDAO_TARGET=android`）—— 手机里根本没有那台服务器，
 * 所以这条能力在手机上等于不存在（`lib/manual.ts` 以前就让模型照实说"做不到"）。
 *
 * 那为什么手机里 WebView 不能直接 `fetch` 别人的网页？**跨域**：WebView 的源是
 * `https://localhost`，实测 Bing / 百度 / 搜狗 / 夸克**都不返回 CORS 头**，
 * 浏览器层直接拦掉，跟网络通不通无关。
 *
 * 解法是 Capacitor 8 **自带**的 `CapacitorHttp`：它把请求交给原生 OkHttp 发，
 * 拿到结果再回给 JS —— **不是 WebView 发的请求，所以根本没有同源策略**。
 * 共用 `native-http.ts` 的已注入桥接，不等待动态 JS 模块；零新插件、零 key。
 *
 * ⚠️ **不要**在 `capacitor.config.ts` 里开 `plugins.CapacitorHttp.enabled = true`
 * ——那是把全局 `fetch`/`XMLHttpRequest` 打补丁。这里只**直接调** `CapacitorHttp.request()`，
 * 免得动到现有的流式对话（那是 `use-chat.ts` 里的一条长连接）。
 *
 * ── 安全（端上比服务端更要紧：手机自己就在内网里）────────────────
 *   · 只允许 http / https；
 *   · 拒内网/本机（含十进制、十六进制、八进制、缺段这些变形写法）—— 防 SSRF，
 *     判定与清单在 `lib/web-extract.ts` 的 `isPublicHttpUrl`（跟服务端**共用同一份**）；
 *   · 超时（默认 15s）、响应体上限（默认 2MB，超了**截断并如实说明**）；
 *   · **任何日志/结果里都不出现密钥**（这条路上目前也没有密钥，见 `webSearch` 的 TODO）。
 */

/*
  ⚠️ 这里用**相对路径 + 显式 .ts**（不是 `@/lib/...` 别名）：这个文件是纯逻辑
  （不碰 store / 界面），验收脚本要在纯 node 里直接 import 它 —— 而 node 既不认
  `tsconfig` 的路径别名、也不做扩展名补全。仓库里开了 `allowImportingTsExtensions`，
  所以带 `.ts` 的写法 tsc / Vite 都认（`sense-core.ts` / `tool-select.ts` 那几个
  纯模块走的也是"纯 node 能直接 import"这条规矩）。
*/
import { getNativeHttp, isNativeHttpPlatform } from "./native-http.ts";
import { decodeWebBytes, htmlToText, isPublicHttpUrl, WEB_FETCH_HEADERS } from "./web-extract.ts";

/** 取网页的默认上限（端上比服务端宽松一点：读长文更常见，但绝不无限） */
export const WEB_FETCH_DEFAULTS = {
  timeoutMs: 15_000,
  maxBytes: 2_000_000,
} as const;

/**
 * 搜网页的**总预算**与**单地址预算**。
 *
 * 为什么要有"总预算"这一层：搜索是**依次试两个地址**（cn.bing.com → www.bing.com）。
 * 2026-11 之前在真机上出事的那次：每地址 12 秒、最坏 24 秒，而闸门那把保险丝是 20 秒
 * → 保险丝先响，用户看到的全是"超时"，可其实搜索还在跑。
 * 现在：单地址最多 8 秒、**总共最多 14 秒**，第二个地址只能花"总预算剩下来的时间"
 * （所以真的卡住时不会 8+8 叠成 16 秒）。**这两个数一改，闸门那把保险丝也要跟着看**
 * （`verify-gate-stuck.mjs` 有断言盯着这个关系）。
 */
export const WEB_SEARCH_PER_ENDPOINT_MS = 8_000;
export const WEB_SEARCH_BUDGET_MS = 14_000;
/** 原生请求**没有**按我们给的时限返回时的硬兜底（见 fetchWebText） */
export const NATIVE_HTTP_HARD_MS = 3_000;

export type WebFetchResult =
  | {
      ok: true;
      status: number;
      finalUrl: string;
      text: string;
      /** 响应体超过上限、被截断了 —— 调用方**必须**如实说出来 */
      truncated: boolean;
      /** 走的哪条路（排查用：`native` = CapacitorHttp，`fetch` = 网页版） */
      via: "native" | "fetch";
    }
  | { ok: false; why: string };

/** 搜索结果一条 */
export type WebHit = { title: string; url: string; snippet: string };

export type WebSearchResult =
  | { ok: true; engine: "bing-rss" | "bing-html" | "bocha"; query: string; results: WebHit[] }
  | { ok: false; why: string; engine?: string };

/* ────────────────────────── 原生 HTTP 那一层 ────────────────────────── */

const isNativeWeb = isNativeHttpPlatform;

/** 浏览器走自己的服务端；APK 仍直接走原生 HTTP，不向第三方转发网址。 */
function hasWebServer(): boolean {
  return !isNativeWeb() && typeof location !== "undefined" && /^https?:$/.test(location.protocol);
}

async function webApi(path: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await withDeadline((async () => {
      const res = await fetch(path, { signal: ac.signal, credentials: "same-origin" });
      const raw = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(raw) as Record<string, unknown>; }
      catch { return { ok: false, why: "网页接口不可用（返回了页面，未拿到搜索或抓取结果）" }; }
      if (!data || typeof data !== "object") return { ok: false, why: "网页接口返回格式不对" };
      if (!res.ok) return { ok: false, why: data.why || data.message || `网页接口返回 HTTP ${res.status}` };
      return data;
    })(), timeoutMs, () => { ac.abort(); return { ok: false, why: "网页接口请求超时" }; });
  } catch (err) {
    return { ok: false, why: (err as Error).name === "AbortError" ? "网页接口请求超时" : (err as Error).message };
  } finally { clearTimeout(timer); }
}

/* ────────────────────────── 取网页（带护栏） ────────────────────────── */

/**
 * 给一个 promise 套**总时限**：不管里面卡在哪一步，到点一定有回音。
 *
 * ⚠️ 两个细节都是踩过的：
 *   · 里面那个 promise 的结果用 `.then(ok, err)` 收掉 —— 超时之后它再 reject 也
 *     不会变成"未处理的拒绝"（那种东西在 WebView 里只会安静地烂掉）
 *   · 超时时**清掉定时器**，不然它白挂着（验收脚本里会因此白等）
 */
type Settled<T> = { kind: "value"; value: T } | { kind: "error"; error: unknown } | { kind: "timeout" };

async function withDeadline<T>(p: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled: Promise<Settled<T>> = p.then(
    (value) => ({ kind: "value" as const, value }),
    (error: unknown) => ({ kind: "error" as const, error }),
  );
  const timedOut = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" as const }), ms);
  });
  try {
    const r = await Promise.race([settled, timedOut]);
    if (r.kind === "value") return r.value;
    if (r.kind === "error") throw r.error;
    return fallback();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 取一段文本（网页 HTML / RSS 都是它）。
 *
 * 三条护栏都要有，缺一条就会变成"手机被一个坏网页拖死"：
 *   1. **URL 先过 SSRF 检查**（服务端同一份判定）；
 *   2. **超时**：原生那侧用 `connectTimeout` / `readTimeout`，网页版用 `AbortController`；
 *      **外加一层"整个函数的总时限"**（见下面 —— 2026-11 真机就是缺了这一层）
 *   3. **大小上限**：超过就截断，并在返回值里把 `truncated` 置起来 —— 不许静默。
 *
 * 非 2xx **不算函数失败**：照样把状态码和正文还给调用方（由它决定怎么措辞），
 * 只有"连不上 / 超时 / URL 被拒"才是 `ok:false`。
 */
export async function fetchWebText(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<WebFetchResult> {
  const timeoutMs = opts.timeoutMs ?? WEB_FETCH_DEFAULTS.timeoutMs;
  /**
   * 整个函数保留总时限，覆盖原生请求、读取与解码。
   * 原生桥直接同步取得，不再因动态 import 的短暂延迟误报「通道未就绪」。
   */
  const budget = timeoutMs + NATIVE_HTTP_HARD_MS + 2000;
  return await withDeadline(fetchWebTextInner(rawUrl, timeoutMs, opts), budget, () => ({
    ok: false,
    why: `取不到：总时限 ${Math.round(budget / 1000)} 秒到了（连"把请求发出去"这一步都没走完）`,
  }));
}

async function fetchWebTextInner(
  rawUrl: string,
  timeoutMs: number,
  opts: { maxBytes?: number; headers?: Record<string, string> },
): Promise<WebFetchResult> {
  const maxBytes = opts.maxBytes ?? WEB_FETCH_DEFAULTS.maxBytes;

  const checked = isPublicHttpUrl(rawUrl.trim());
  if (!checked.ok) return { ok: false, why: checked.why };
  const url = checked.url.toString();
  const headers = { ...WEB_FETCH_HEADERS, ...(opts.headers ?? {}) };

  const http = getNativeHttp();
  if (isNativeWeb() && !http) return { ok: false, why: "原生网页请求通道未就绪，请重试；未改用会被跨域拦截的网页请求" };
  if (http) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      /**
       * ⚠️ **JS 这侧再加一道硬超时**，不只依赖原生给的 `connectTimeout`/`readTimeout`。
       *
       * 为什么非加不可（2026-11 真机）：那次"动作全挂着"里，就有一条是原生请求
       * 迟迟不返回 —— 原生那侧的时限在某些 ROM/场景下没兜住，于是 JS 一直 await 下去，
       * 整个动作队列就堵在那儿。这里用 `Promise.race` 把上限钉死：
       * 到点无论原生回不回，我们都拿到一个错误，而不是无限等。
       */
      const hard = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`原生请求超过 ${Math.round((timeoutMs + NATIVE_HTTP_HARD_MS) / 1000)} 秒没返回`)),
          timeoutMs + NATIVE_HTTP_HARD_MS,
        );
      });
      // ⚠️ 原生那个 promise 也要挂 catch：超时之后它才 reject 的话，
      //    不挂就会变成"未处理的拒绝"（在 WebView 里只会安静地烂掉）
      const req = http
        .request({ url, method: "GET", headers, connectTimeout: timeoutMs, readTimeout: timeoutMs, responseType: "arraybuffer" })
        .catch((e: unknown) => {
          throw e instanceof Error ? e : new Error(String(e ?? "原生请求失败"));
        });
      const res = await Promise.race([req, hard]);
      const status = Number(res.status ?? 0);
      if (!status) return { ok: false, why: "原生请求没拿到状态码" };
      const contentType = Object.entries(res.headers ?? {}).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
      // Capacitor 对 JSON 响应仍返回 JSON；网页/XML 的 arraybuffer 是 base64。
      const bytes = status < 200 || status >= 300 || /json/i.test(contentType) || typeof res.data !== "string"
        ? new TextEncoder().encode(typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? ""))
        : Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0));
      const truncated = bytes.byteLength > maxBytes;
      const text = decodeWebBytes(bytes.slice(0, maxBytes), contentType);
      return { ok: true, status, finalUrl: res.url || url, text, truncated, via: "native" };
    } catch (err) {
      return { ok: false, why: (err as Error)?.message || "原生请求失败" };
    } finally {
      /** 清掉硬超时那把定时器：不然它白挂着（验收脚本里还会白等十几秒） */
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // 网页版：普通 fetch（跨域读不到别人的网页是**如实结果**，不是 bug）
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "follow", headers });
    const buf = await res.arrayBuffer();
    const truncated = buf.byteLength > maxBytes;
    const slice = truncated ? buf.slice(0, maxBytes) : buf;
    const text = decodeWebBytes(new Uint8Array(slice), res.headers.get("content-type") ?? "");
    return { ok: true, status: res.status, finalUrl: res.url || url, text, truncated, via: "fetch" };
  } catch (err) {
    const aborted = (err as Error).name === "AbortError";
    const msg = aborted
      ? timeoutMs >= 1_000
        ? `超过 ${Math.round(timeoutMs / 1000)} 秒没响应`
        : `超过 ${timeoutMs} 毫秒没响应`
      : (err as Error).message;
    return { ok: false, why: msg || "取不到（也可能是对方没开跨域）" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * **读一个网页的正文**（给模型的是正文文本，不是一堆标签）。
 *
 * 抽正文用的是 `lib/web-extract.ts` 的 `htmlToText` —— 跟服务端
 * `/api/read` **同一份实现**（不是抄第二份）。
 */
export async function readWebPage(
  rawUrl: string,
  opts: { maxChars?: number; timeoutMs?: number; maxBytes?: number } = {},
): Promise<
  | {
      ok: true;
      url: string;
      status: number;
      title: string;
      text: string;
      truncated: boolean;
      chars: number;
      via: "native" | "fetch" | "server";
    }
  | { ok: false; why: string }
> {
  const maxChars = opts.maxChars ?? 6000;
  const checked = isPublicHttpUrl(rawUrl.trim());
  if (!checked.ok) return { ok: false, why: checked.why };
  if (hasWebServer()) {
    const result = await webApi(`/api/read?url=${encodeURIComponent(checked.url.toString())}`, opts.timeoutMs ?? 20_000);
    if (result.ok !== true || typeof result.text !== "string" || !result.text.trim()) {
      return { ok: false, why: String(result.why || "网页接口没有返回正文") };
    }
    if (Number(result.status || 200) < 200 || Number(result.status || 200) >= 300) {
      return { ok: false, why: `对方返回 HTTP ${result.status}（这个页面读不到）` };
    }
    return { ok: true, url: String(result.url || rawUrl), status: Number(result.status || 200),
      title: String(result.title || ""), text: result.text.slice(0, maxChars),
      truncated: Boolean(result.truncated) || result.text.length > maxChars,
      chars: Number(result.chars || result.text.length), via: "server" };
  }
  const got = await fetchWebText(rawUrl, opts);
  if (!got.ok) return { ok: false, why: got.why };

  if (got.status < 200 || got.status >= 300) {
    return { ok: false, why: `对方返回 HTTP ${got.status}（这个页面读不到）` };
  }
  const { title, text } = htmlToText(got.text);
  if (text.length < 2000 && /安全验证|访问验证|验证码|Just a moment|Access Denied|Robot Check/i.test(title)) {
    return { ok: false, why: "对方返回了验证或拦截页面，未拿到正文" };
  }
  if (!text.trim()) {
    return {
      ok: false,
      why: "取到了，但正文是空的（多半是 JS 渲染的页面 —— 这种页面取回来只有壳）",
    };
  }
  return {
    ok: true,
    url: got.finalUrl,
    status: got.status,
    title,
    text: text.slice(0, maxChars),
    truncated: got.truncated || text.length > maxChars,
    chars: text.length,
    via: got.via,
  };
}

/* ────────────────────────── 搜索 ────────────────────────── */

/** XML/HTML 实体 + CDATA 还原（RSS 的标题里常见 `&amp;` / `<![CDATA[...]]>`） */
export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/**
 * 解析 Bing 的 **RSS**（`cn.bing.com/search?q=…&format=rss`）。
 *
 * 为什么端上先走这条路（2026-10 实测，这台机器、国内家宽无代理）：
 *   · 免 key、返回结构化 XML（`<item>` 里有 title / link / description）；
 *   · **它是 feed 不是结果页**，不吃反爬（抓 HTML 结果页那条从境外/不同网络常被 502）；
 *   · 手机端走原生 HTTP，没有跨域问题。
 *
 * ⚠️ 已知边界：版权条款只允许"个人非商业用途在 RSS 聚合器里呈现必应结果" —— 自用可以，
 * 别当成可卖的产品能力。**纯函数**（喂一段 RSS 文本进来就能出结果），
 * 所以验收脚本可以拿假 RSS 直接测它，不用联网。
 */
export function parseBingRss(xml: string, limit = 8): WebHit[] {
  const out: WebHit[] = [];
  for (const item of xml.split(/<item[\s>]/i).slice(1)) {
    const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "";
    const title = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const desc = item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "";
    const url = decodeEntities(link);
    const cleanTitle = decodeEntities(title);
    if (!cleanTitle || !isPublicHttpUrl(url).ok) continue;
    out.push({ title: cleanTitle, url, snippet: decodeEntities(desc).slice(0, 300) });
    if (out.length >= limit) break;
  }
  return out;
}

/** RSS 被改回 HTML 时仍能取到真正的结果条目，不把验证页/导航当成结果。 */
export function parseBingHtml(html: string, limit = 8): WebHit[] {
  const out: WebHit[] = [];
  const blocks = html.split(/<li\b[^>]*class\s*=\s*["'][^"']*\bb_algo\b[^"']*["'][^>]*>/i).slice(1);
  for (const block of blocks) {
    const heading = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const link = (heading ?? block).match(/<a\b[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let url = decodeEntities(link[1]);
    try {
      const u = new URL(url);
      // Bing HTML 的链接常是 /ck/a?u=a1<base64url>，还原公开目标网址。
      const target = u.searchParams.get("u");
      if (/(^|\.)bing\.com$/i.test(u.hostname) && target?.startsWith("a1")) {
        const base64 = target.slice(2).replace(/-/g, "+").replace(/_/g, "/");
        url = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      }
    } catch { continue; }
    if (!isPublicHttpUrl(url).ok) continue;
    const title = decodeEntities(link[2]);
    if (!title || out.some((h) => h.url === url)) continue;
    const snippet = decodeEntities(block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "").slice(0, 300);
    out.push({ title, url, snippet });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * **搜网页**（端上）。
 *
 * 现在只有一条路：免 key 的 Bing RSS，两个域名**并发**各试一次
 * （实测 `cn.bing.com` 在国内通，`www.bing.com` 是服务端那条老路用的，留着当备用）。
 *
 * TODO（博查 BochaAI）：博查是这一层唯一"实测允许跨域（`ACAO: *`）"的正规搜索 API，
 * 效果比抓 RSS 稳。但现在**设置里没有存这个 key 的位置**（服务端那条读的是
 * `process.env.BOCHA_KEY`，APK 里没有 `process.env`），所以端上先不做 ——
 * 等设置页真的开了这个字段（例如 `settings.bochaKey`），在这里加一条分支即可：
 *   `POST https://api.bochaai.com/v1/web-search`，`authorization: Bearer <key>`。
 * ⚠️ 那时候**也不许**把 key 写进日志/动作结果/审批标题里。
 */
export async function webSearch(rawQuery: string, opts: { limit?: number; timeoutMs?: number } = {}): Promise<WebSearchResult> {
  const q = rawQuery.trim();
  if (!q) return { ok: false, why: "要给我一个搜索词" };
  const limit = Math.max(1, Math.min(opts.limit ?? 8, 10));
  if (hasWebServer()) {
    const result = await webApi(`/api/search?q=${encodeURIComponent(q)}`, opts.timeoutMs ?? 20_000);
    if (result.ok !== true || !Array.isArray(result.results)) return { ok: false, why: String(result.why || "搜索接口没有返回结果") };
    const results = (result.results as WebHit[]).filter((h) => h && typeof h.title === "string"
      && typeof h.url === "string" && isPublicHttpUrl(h.url).ok).slice(0, limit);
    if (!results.length) return { ok: false, why: "搜索接口没有返回可用结果" };
    const engine = result.engine === "bocha" || result.engine === "bing-html" ? result.engine : "bing-rss";
    return { ok: true, query: q, engine, results };
  }
  /** 总预算（默认 14 秒）—— 两个地址加起来不许超过它 */
  const deadline = Date.now() + (opts.timeoutMs ?? WEB_SEARCH_BUDGET_MS);

  const endpoints = [
    `https://cn.bing.com/search?q=${encodeURIComponent(q)}&format=rss`,
    `https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss`,
  ];
  const tried: string[] = [];
  /**
   * ⚠️ **两个地址并发问，谁先成功用谁**（2026-11 改）。
   *
   * 原来是"排队试"：先 cn.bing.com（最多 8 秒），不行再 www.bing.com
   * —— 而后者在国内基本不通，等于**白吃掉整个预算**，最坏要 14 秒才告诉用户"搜不到"。
   * 并发之后最坏 ~8 秒，而且两个都通时命中率更高。
   */
  const attempts = Promise.any(
    endpoints.map(async (endpoint, index) => {
      let why = "返回里没有结果条目（可能是验证页）";
      // 每个域名先读 RSS，失败再试 HTML；两个域名谁先拿到结果就返回。
      for (const url of [endpoint, endpoint.replace("&format=rss", "&setlang=zh-CN")]) {
        const left = deadline - Date.now();
        if (left <= 0) break;
        const got = await fetchWebText(url, {
          timeoutMs: Math.min(WEB_SEARCH_PER_ENDPOINT_MS, left), maxBytes: 600_000,
        });
        if (!got.ok) { why = got.why; continue; }
        if (got.status !== 200) { why = `HTTP ${got.status}`; continue; }
        const rss = parseBingRss(got.text, limit);
        const results = rss.length ? rss : parseBingHtml(got.text, limit);
        if (results.length) return { ok: true as const, engine: rss.length ? "bing-rss" as const : "bing-html" as const, results };
      }
      tried.push(`${index === 0 ? "cn.bing.com" : "www.bing.com"}：${why}`);
      throw new Error(why);
    }),
  ).catch(() => null);

  const hit = await withDeadline(attempts, Math.max(1, deadline - Date.now()), () => null);
  if (hit) return { ok: true, engine: hit.engine, query: q, results: hit.results };
  return {
    ok: false,
    engine: "bing-rss",
    why: `搜索没成功（${tried.join("；") || "没有任何可用通路"}）。可能是网络不通，或者对方接口变了。`,
  };
}

/** 把一条搜索结果写成人话（给模型/界面看的那一行） */
export function hitLine(i: number, h: WebHit): string {
  return `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`;
}


