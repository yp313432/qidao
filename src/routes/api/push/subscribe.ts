import { createFileRoute } from "@tanstack/react-router";

/**
 * 接收浏览器的推送订阅。
 *
 * ⚠️ 现在只存在**进程内存**里：部署到 Serverless 会随实例回收。
 * 正式要用需要落到数据库或 KV（这一步等你决定部署方式再做）。
 */
const subscriptions = new Map<string, unknown>();

export const Route = createFileRoute("/api/push/subscribe")({
  server: {
    handlers: {
      GET: async () => Response.json({ count: subscriptions.size }),
      POST: async ({ request }) => {
        let body: { endpoint?: string } | null = null;
        try {
          body = (await request.json()) as { endpoint?: string };
        } catch {
          body = null;
        }
        if (!body?.endpoint) {
          return Response.json({ ok: false, message: "订阅数据不完整" }, { status: 400 });
        }
        subscriptions.set(body.endpoint, body);
        return Response.json({
          ok: true,
          message:
            `服务端已收到订阅（当前 ${subscriptions.size} 条）。` +
            "要做到「App 完全关闭也能收到」，还差两样：① VAPID 密钥对；" +
            "② 一个会主动调用推送接口的服务端任务（比如 AI 回复生成后触发）。" +
            "另外注意：这份订阅现在只存在内存里，重启就没了。",
        });
      },
    },
  },
});
