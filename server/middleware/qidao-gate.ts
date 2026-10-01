/**
 * 口令门：给部署到公网的栖岛加一道门。
 *
 * 为什么需要：部署后任何人拿到网址都能打开。数据本身是安全的（全在各自设备的
 * 浏览器里，服务器只是个空壳），但**一旦接上 AI，别人就能用你的额度花钱**。
 *
 * 为什么不用 Cloudflare Access：它能做同样的事，但官方要求必须填支付方式
 * （免费版也要填，只是不扣费）。所以这里自己加一道：不依赖任何外部服务、
 * 不要卡、本地/线上都管用、以后换托管也还在。
 *
 * 设计取舍：
 *   · **没设 QIDAO_PASSPHRASE 就完全不启用** —— 本地开发和预览不受影响，
 *     也不会因为忘了配环境变量就把自己永远锁在外面。
 *   · cookie 是**签名**过的（HMAC），不是明文口令 —— 拿到 cookie 也推不出口令。
 *   · 比对用固定时间算法，避免按字符逐位试探。
 *   · 口令只存在环境变量里，**不进代码、不进仓库**。
 *   · 换了口令，旧 cookie 自动失效（签名跟着口令变）。这是有意为之。
 */

const COOKIE_NAME = "qidao_gate";
/** cookie 有效期：30 天。自己家用，太短会烦，太长没必要。 */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const GATE_PATH = "/__gate";

interface GateEvent {
  url: URL;
  req: {
    method: string;
    headers: Headers;
    /** 读请求体（交口令那个 POST 要用）。 */
    text: () => Promise<string>;
  };
}

function passphrase(): string {
  return (process.env.QIDAO_PASSPHRASE ?? "").trim();
}

/** 用口令派生一个签名：cookie 里存的是它，不是口令本身。 */
async function signature(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("qidao-gate-v1"));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 固定时间比较：长度不同直接 false，否则逐位异或累计。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE_NAME) return rest.join("=") || null;
  }
  return null;
}

/** 门后面的那张脸。不加载任何外部资源，所以门本身不会因为网络慢而卡住。 */
function loginPage(host: string, failed: boolean): string {
  const err = failed
    ? `<p class="err">口令不对，再试一次</p>`
    : `<p class="hint">这是私人空间，先对个口令</p>`;
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>栖岛</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background:
      radial-gradient(58% 70% at 16% 10%, rgba(255,214,170,.55), transparent 62%),
      radial-gradient(48% 64% at 84% 14%, rgba(196,181,253,.5), transparent 62%),
      radial-gradient(70% 68% at 50% 104%, rgba(147,197,253,.45), transparent 70%),
      #f6f3ee;
    color: #2b2723;
  }
  .card {
    width: min(22rem, 100%); padding: 26px 22px 22px; border-radius: 28px;
    background: rgba(255,255,255,.55); border: 1px solid rgba(255,255,255,.6);
    box-shadow: 0 18px 50px rgba(60,40,20,.14);
    -webkit-backdrop-filter: blur(28px) saturate(1.6); backdrop-filter: blur(28px) saturate(1.6);
    text-align: center;
  }
  .mark { font: 500 26px/1 Georgia, "Songti SC", serif; letter-spacing: .06em; }
  .hint { margin: 8px 0 18px; font-size: 12px; opacity: .62; }
  .err { margin: 8px 0 18px; font-size: 12px; color: #b4462e; }
  input {
    width: 100%; padding: 13px 16px; border-radius: 999px; border: 1px solid rgba(0,0,0,.08);
    background: rgba(255,255,255,.8); font-size: 16px; outline: none; text-align: center;
  }
  input:focus { border-color: rgba(0,0,0,.22); }
  button {
    margin-top: 12px; width: 100%; padding: 13px 16px; border: 0; border-radius: 999px;
    background: #211d19; color: #fff; font-size: 15px; font-weight: 500; cursor: pointer;
  }
  .foot { margin-top: 16px; font-size: 11px; opacity: .45; }
</style></head>
<body>
  <form class="card" method="POST" action="${GATE_PATH}">
    <div class="mark">栖岛</div>
    ${err}
    <input name="pass" type="password" inputmode="text" autocomplete="current-password"
           autofocus required aria-label="口令" placeholder="口令">
    <button type="submit">进去</button>
    <p class="foot">${host}</p>
  </form>
</body></html>`;
}

export default async function qidaoGateMiddleware(
  event: GateEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const secret = passphrase();
  // 没配口令 = 这道门不存在（本地开发、预览、CI 都是这个状态）
  if (!secret) return next();

  const expected = await signature(secret);
  const method = (event.req.method ?? "GET").toUpperCase();
  const path = event.url.pathname;

  // 交口令
  if (path === GATE_PATH && method === "POST") {
    let submitted = "";
    try {
      const body = await event.req.text();
      submitted = new URLSearchParams(body).get("pass") ?? "";
    } catch {
      submitted = "";
    }
    if (!safeEqual(await signature(submitted.trim()), expected)) {
      return new Response(loginPage(event.url.host, true), {
        status: 401,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    const secure = event.url.protocol === "https:" ? " Secure;" : "";
    return new Response(null, {
      status: 303,
      headers: {
        location: "/",
        "set-cookie": `${COOKIE_NAME}=${expected}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly;${secure} SameSite=Lax`,
        "cache-control": "no-store",
      },
    });
  }

  // 已经有票就放行
  const token = cookieValue(event.req.headers.get("cookie"));
  if (token && safeEqual(token, expected)) return next();

  // 没票：拦住。接口返回 JSON，页面返回那张门。
  if (path.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "unauthorized", message: "需要先过口令门" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return new Response(loginPage(event.url.host, false), {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
