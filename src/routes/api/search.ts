import { createFileRoute } from "@tanstack/react-router";
import { fetchText, htmlToText, json, preflight } from "@/lib/web-tools";

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

        const bochaKey = (process.env.BOCHA_KEY ?? "").trim();
        if (bochaKey) {
          const r = await viaBocha(q, bochaKey);
          if (r) return json(r);
          // 博查失败就往下走抓取兜底，别让用户什么都拿不到
        }

        const scraped = (await viaBing(q)) ?? (await viaDuckDuckGo(q));
        if (scraped) return json(scraped);

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

/* ---------------- ② 抓搜索结果页（没 key 时的兜底） ---------------- */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

async function viaBing(q: string): Promise<Record<string, unknown> | null> {
  const got = await fetchText(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-CN`, {
    timeoutMs: 12_000,
    maxBytes: 600_000,
  });
  if (!got.ok || got.status !== 200) return null;

  const results: Hit[] = [];
  // Bing 的每条结果都在 <li class="b_algo"> 里
  const blocks = got.text.split(/<li class="b_algo"/i).slice(1);
  for (const block of blocks) {
    /*
      ⚠️ 不要指望 `<h2><a href=...>` —— 实测（移动版）**根本没有这种结构**，
      照着写会一条都抓不到（第一次就是这样，搜索整个空掉了）。
      可靠的做法是"块里第一个 http 链接"。
    */
    const link = block.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/i);
    if (!link) continue;
    const url = decodeEntities(link[1]);
    // 标题里常混着网址面包屑（`react.devhttps://react.dev › learn`），
    // 从第一个 http 处截断，留下真正的标题
    const rawTitle = decodeEntities(link[2]);
    const title = rawTitle.split(/https?:\/\//)[0].trim() || rawTitle.trim();
    const snippet = decodeEntities(block.match(/<p[^>]*>([\s\S]{20,400}?)<\/p>/i)?.[1] ?? "");
    if (!title || !url.startsWith("http")) continue;
    results.push({ title, url, snippet: snippet.slice(0, 300) });
    if (results.length >= 5) break;
  }
  if (!results.length) return null;
  return { ok: true, engine: "bing", query: q, results };
}

async function viaDuckDuckGo(q: string): Promise<Record<string, unknown> | null> {
  const got = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    timeoutMs: 12_000,
    maxBytes: 600_000,
  });
  if (!got.ok || got.status !== 200) return null;

  const results: Hit[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snips = [...got.text.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)];
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(got.text)) && results.length < 5) {
    let url = decodeEntities(m[1]);
    // DDG 给的是跳转链接，真地址藏在 uddg 参数里
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (!url.startsWith("http")) {
      i += 1;
      continue;
    }
    results.push({
      title: decodeEntities(m[2]),
      url,
      snippet: decodeEntities(snips[i]?.[1] ?? "").slice(0, 300),
    });
    i += 1;
  }
  if (!results.length) return null;
  return { ok: true, engine: "duckduckgo", query: q, results };
}
