/**
 * `/api/*` 的**跨域预检**（CORS preflight）—— 只有这一处。
 *
 * 为什么必须单独写个中间件、而不能写在路由里：
 *   实测发现 **OPTIONS 请求会被上层某个默认 CORS 处理先吃掉** ——
 *   它答的头是 `access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE`、
 *   `access-control-allow-origin: <reflect>`，**不含 `Access-Control-Allow-Headers`**。
 *   后果很具体：App 那边要带 `x-qidao-pass`（自定义头）过口令门，
 *   浏览器会先发预检，而预检答"没允许这个头" → **请求根本发不出去**，
 *   而且报的错是 "Failed to fetch"，看起来像网络问题，极难查。
 *   （文件名叫 `api-cors.ts`，排在 `grok-pwa.ts` / `qidao-gate.ts` 前面，
 *     抢在那层默认处理之前。）
 *
 * 为什么预检可以直接放行（不做认证）：
 *   预检是浏览器自动发的，**不携带 cookie、不带自定义头、没有请求体** ——
 *   放行它不泄露任何东西、也不消耗上游额度；真正带数据的 GET 仍然要过口令门。
 */
import { preflight } from "../../src/lib/web-tools";

interface CorsEvent {
  url: URL;
  req: { method?: string };
}

export default async function apiCorsMiddleware(
  event: CorsEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  if (!event.url.pathname.startsWith("/api/")) return next();
  if ((event.req.method ?? "GET").toUpperCase() === "OPTIONS") return preflight();
  return next();
}
