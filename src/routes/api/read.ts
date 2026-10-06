import { createFileRoute } from "@tanstack/react-router";
import { fetchText, htmlToText, isPublicHttpUrl, json, preflight } from "@/lib/web-tools";

/**
 * `GET /api/read?url=<网址>` —— **读一个网页的正文**。
 *
 * 为什么必须放在服务端：浏览器/WebView 里**任意网页都读不到**（跨域）。
 * 实测 example.com、百度都一样：网络通，但对方不给读。所以"让星芒看某个网页"
 * 这件事只有服务端能做 —— 这就是这个中转存在的最大理由。
 *
 * 返回 JSON（不是 HTML），App 那边配一条 HTTP 工具就能用，
 * 而且 `url` 是查询参数 → 会自动变成"可改参数"，星芒能自己换要读的网页。
 */
export const Route = createFileRoute("/api/read")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),

      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("url") ?? "";
        if (!raw.trim()) {
          return json({ ok: false, why: "要带上 ?url= 参数（要读的网址）" }, 400);
        }

        const checked = isPublicHttpUrl(raw.trim());
        if (!checked.ok) return json({ ok: false, why: checked.why }, 400);

        const got = await fetchText(checked.url.toString(), { maxBytes: 400_000, timeoutMs: 12_000 });
        if (!got.ok) return json({ ok: false, why: `取网页失败：${got.why}` }, 502);

        const { title, text } = htmlToText(got.text);
        return json({
          ok: true,
          url: got.finalUrl,
          status: got.status,
          title,
          // 最多给 6000 字 —— 再多会把上下文塞满，模型反而读不出重点
          text: text.slice(0, 6000),
          truncated: got.truncated || text.length > 6000,
          chars: text.length,
        });
      },
    },
  },
});
