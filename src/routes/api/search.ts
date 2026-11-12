import { createFileRoute } from "@tanstack/react-router";
import { json, preflight } from "@/lib/web-tools";
import { webSearch } from "@/lib/web-http";

/**
 * `GET /api/search?q=<关键词>` —— **搜网页**。
 *
 * 两条上游，按"有没有密钥"自动选：
 *   ① `BOCHA_KEY`（环境变量 / Cloudflare Secret）→ 调博查搜索 API，结果干净稳定
 *      实测：国内可达 + 允许跨域（浏览器能直接读），所以放服务端也行、直连也行
 *   ② 没密钥 → 退回**抓搜索引擎的结果页**（Bing / DuckDuckGo 的 HTML）
 *      能出结果，但页面结构说变就变，属于"尽力而为"，返回里会注明用的哪条路
 *
 * ⚠️ 为什么不直接让 App 抓搜索引擎：跨域 + 对方反爬，浏览器里做不到。
 *    这也是这个中转存在的第二个理由。
 */
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),

      GET: async ({ request }) => {
        const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
        if (!q) return json({ ok: false, why: "要带上 ?q= 参数（搜索词）" }, 400);
        const deadline = Date.now() + 18_000;

        const bochaKey = (process.env.BOCHA_KEY ?? "").trim();
        if (bochaKey) {
          const r = await viaBocha(q, bochaKey);
          if (r?.ok === true) return json(r);
          // 博查失败就往下走抓取兜底，别让用户什么都拿不到
        }

        /*
          兜底顺序是有讲究的（2026-10 实测）：
            ① **Bing 的 RSS 接口**（`&format=rss`）—— 官方 feed，返回结构化 XML，
               783ms、10 条；这种接口不吃反爬，**从境外网络（Cloudflare）也能用**
            ② 抓 Bing 的 HTML 结果页 —— 在这台机器上能出结果，但**从 Cloudflare 上
               失败过**（用户手机实测 502），所以只能排在后面当兜底
          DDG / Wikipedia / SearXNG 在这台机器上直接连不通（网络到不了），没法验，
          所以不放进来充数。
        */
        const scraped = await webSearch(q, { limit: 5, timeoutMs: Math.max(1, deadline - Date.now()) });
        if (scraped.ok) return json(scraped);

        return json(
          {
            ok: false,
            why: bochaKey
              ? "博查和兜底抓取都没拿到结果（可能是对方的页面结构变了）"
              : "没配搜索密钥，兜底抓取也没成功。要么在环境变量里加 BOCHA_KEY，要么稍后再试。",
          },
          502,
        );
      },
    },
  },
});

type Hit = { title: string; url: string; snippet: string };

/* ---------------- ① 博查（有 key 时走这条） ---------------- */

async function viaBocha(q: string, key: string): Promise<Record<string, unknown> | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch("https://api.bochaai.com/v1/web-search", {
      method: "POST",
      signal: ac.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: q, count: 5, summary: true }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, engine: "bocha", why: `博查返回 ${res.status}：${text.slice(0, 200)}` };
    const data = JSON.parse(text) as {
      data?: { webPages?: { value?: { name?: string; url?: string; summary?: string; snippet?: string }[] } };
    };
    const pages = data.data?.webPages?.value ?? [];
    const results: Hit[] = pages.slice(0, 5).map((p) => ({
      title: p.name ?? "",
      url: p.url ?? "",
      snippet: (p.summary ?? p.snippet ?? "").slice(0, 300),
    }));
    if (!results.length) return { ok: false, engine: "bocha", why: "博查没返回结果" };
    return { ok: true, engine: "bocha", query: q, results };
  } catch (err) {
    return { ok: false, engine: "bocha", why: (err as Error).message || "博查请求失败" };
  } finally {
    clearTimeout(timer);
  }
}
