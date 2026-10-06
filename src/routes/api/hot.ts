import { createFileRoute } from "@tanstack/react-router";
import { fetchText, json, preflight } from "@/lib/web-tools";

/**
 * `GET /api/hot?src=weibo|douyin|news` —— **热搜 / 热榜**。
 *
 * 实测背景（2026-10，见接手文档）：
 *   · 免费热榜接口 10 个里 8 个在用户网络上直接**到不了**，能到的几个**不给跨域**
 *   · 所以绕不开服务端 —— 由这台 Worker 去取，App 只调我们自己的接口
 *   · 天行数据的微博热搜 / 抖音热榜**可达且允许跨域**，但要一把 key
 *     → key 放 Cloudflare Secret（`TIANAPI_KEY`），**手机上不用存任何密钥**
 *   · `src=news` 走 60s.viki.moe，**不需要 key**，永远可用
 *
 * 没配 key 时**如实说**要配 key，不返回编造的榜单。
 */
export const Route = createFileRoute("/api/hot")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),

      GET: async ({ request }) => {
        const src = (new URL(request.url).searchParams.get("src") ?? "news").trim().toLowerCase();

        if (src === "news") {
          const r = await via60s();
          return r ? json(r) : json({ ok: false, why: "今日新闻那条上游没返回内容" }, 502);
        }

        if (src === "weibo" || src === "douyin" || src === "zhihu") {
          const key = (process.env.TIANAPI_KEY ?? "").trim();
          if (!key) {
            return json(
              {
                ok: false,
                why: "没配热搜用的密钥。去 tianapi.com 免费注册拿一把 key，然后在 Cloudflare 里加一个环境变量 TIANAPI_KEY（Secret）就行。",
                needKey: "TIANAPI_KEY",
              },
              501,
            );
          }
          const r = await viaTianapi(src, key);
          if (r) return json(r);
          return json({ ok: false, why: `天行数据的 ${src} 没返回内容（key 对不对？额度用完了？）` }, 502);
        }

        return json({ ok: false, why: "src 只支持 news / weibo / douyin / zhihu" }, 400);
      },
    },
  },
});

type Item = { rank: number; title: string; url?: string; hot?: string };

/** 今日新闻：60s.viki.moe —— 免 key，实测可达 + 返回当天 15 条 */
async function via60s(): Promise<Record<string, unknown> | null> {
  const got = await fetchText("https://60s.viki.moe/v2/60s", { timeoutMs: 10_000, maxBytes: 200_000 });
  if (!got.ok || got.status !== 200) return null;
  try {
    const data = JSON.parse(got.text) as { data?: { date?: string; news?: string[] } };
    const news = data.data?.news ?? [];
    if (!news.length) return null;
    return {
      ok: true,
      src: "news",
      date: data.data?.date ?? "",
      items: news.map((t, i): Item => ({ rank: i + 1, title: t })),
    };
  } catch {
    return null;
  }
}

/**
 * 天行数据的热榜。
 *
 * 返回结构照它文档的常见形状来，但**字段名做兼容**（hotword / word / title），
 * 免得它哪天改个字段名这里就全空了。
 */
async function viaTianapi(src: string, key: string): Promise<Record<string, unknown> | null> {
  const path = src === "weibo" ? "weibohot" : src === "douyin" ? "douyinhot" : "zhihuhot";
  const got = await fetchText(`https://apis.tianapi.com/${path}/index?key=${encodeURIComponent(key)}`, {
    timeoutMs: 10_000,
    maxBytes: 300_000,
  });
  if (!got.ok || got.status !== 200) return null;
  try {
    const data = JSON.parse(got.text) as {
      code?: number;
      msg?: string;
      result?: { list?: Record<string, unknown>[] };
    };
    if (data.code !== 200) {
      return { ok: false, why: `天行数据说：${data.msg ?? "未知错误"}（code ${data.code}）` };
    }
    const list = data.result?.list ?? [];
    const items: Item[] = list.slice(0, 20).map((row, i) => {
      const title = String(row.hotword ?? row.word ?? row.title ?? row.name ?? "").trim();
      const url = String(row.url ?? row.link ?? "").trim();
      const hot = String(row.hotwordnum ?? row.hotnum ?? row.hot ?? "").trim();
      return { rank: i + 1, title, ...(url ? { url } : {}), ...(hot ? { hot } : {}) };
    });
    if (!items.length) return null;
    return { ok: true, src, items };
  } catch {
    return null;
  }
}
