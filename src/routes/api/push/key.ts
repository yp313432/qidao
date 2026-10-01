import { createFileRoute } from "@tanstack/react-router";

/**
 * 告诉客户端「服务端有没有配 VAPID 公钥」。
 * 没配的话前端就明确提示缺什么，而不是假装订阅成功。
 */
export const Route = createFileRoute("/api/push/key")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.VAPID_PUBLIC_KEY ?? "";
        return Response.json({ key, configured: key.length > 0 });
      },
    },
  },
});
