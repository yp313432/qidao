import { createFileRoute } from "@tanstack/react-router";

/**
 * 拉取自定义上游支持的模型名。
 *
 * 为什么要这个接口：换一家 API 时，模型名得听对方的（DeepSeek 是
 * `deepseek-flash` / `deepseek-v4-pro`，智谱是 `glm-4.6`…）。
 * 猜错了上游只会回一句英文报错，看起来像密钥不对 —— 很难定位。
 * 所以直接问它 `/models`，把可用名字列出来给你点。
 *
 * 放在服务端做，是因为浏览器直连对方会被跨域拦住；密钥本身也是网页里填的，
 * 这里只是转发一次请求，不落盘、不记录。
 */
export const Route = createFileRoute("/api/models")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { baseUrl?: string; apiKey?: string };
        try {
          body = (await request.json()) as { baseUrl?: string; apiKey?: string };
        } catch {
          return Response.json({ ok: false, message: "无效请求" });
        }

        const base = (body.baseUrl ?? "").trim().replace(/\/+$/, "");
        const key = (body.apiKey ?? "").trim();
        if (!base) return Response.json({ ok: false, message: "先填上游地址" });
        if (!key) return Response.json({ ok: false, message: "先填密钥" });

        try {
          const res = await fetch(`${base}/models`, {
            headers: { Authorization: `Bearer ${key}` },
          });
          const text = await res.text();
          if (!res.ok) {
            return Response.json({
              ok: false,
              message: `上游返回 ${res.status}：${text.slice(0, 300)}`,
            });
          }
          let ids: string[] = [];
          try {
            const json = JSON.parse(text) as { data?: { id?: unknown }[] };
            ids = (json.data ?? [])
              .map((m) => m?.id)
              .filter((x): x is string => typeof x === "string" && x.length > 0);
          } catch {
            return Response.json({ ok: false, message: "上游返回的不是标准模型列表" });
          }
          if (ids.length === 0) {
            return Response.json({ ok: false, message: "上游没列出任何模型，手动填吧" });
          }
          return Response.json({ ok: true, models: ids.sort() });
        } catch (err) {
          return Response.json({
            ok: false,
            message: `连不上上游：${(err as Error).message || "网络错误"}`,
          });
        }
      },
    },
  },
});
