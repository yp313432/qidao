/**
 * 「现在跑在哪」的判断集中在这一个文件里。
 *
 * 为什么必须集中：栖岛有两种形态 ——
 *   · **网页版**：有服务端，`/api/...` 那些接口都在
 *   · **App（安卓）**：没有服务端，界面是打进手机的本地资源
 *
 * App 里任何 `/api/...` 请求都会拿到 **SPA 的 HTML**，然后以
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` 的形式炸掉 ——
 * 用户看到的是一句天书，完全猜不到"这个功能在 App 里没有服务端"。
 *
 * 所以：凡是要区分两种形态的地方，都从这里取判断，别再各写各的。
 */
import { Capacitor } from "@capacitor/core";
import { looksLikeNetworkBlock, nativeHttp } from "./native-http";

/** 打包成安卓 App 的那种构建（VITE_DIRECT_UPSTREAM=1）。 */
export const IS_APP =
  (import.meta.env?.VITE_DIRECT_UPSTREAM as string | undefined) === "1";

/**
 * 现在是不是**真的跑在手机的 App 壳里**（安卓 WebView / iOS）。
 *
 * 跟 `IS_APP` 的区别很重要，别混：
 *   · `IS_APP` 是**构建期**常量 —— "这一版是给安卓打的"
 *   · 这个是**运行时**判断 —— "我此刻确实在那个原生 WebView 里"
 *
 * 为什么 OAuth 必须用运行时判断：**回跳方式完全不同** ——
 * 真机里只能跳**系统浏览器**再靠自定义 scheme 跳回来（App 里没有本地服务端，
 * 同源回调会落到 Chrome 自己身上）；网页版直接同源跳就行。
 * 用构建期常量的话，"给安卓打的包在浏览器里打开"这种调试场景会走错分支。
 */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * 问上游要模型列表。
 *
 * App 里直接问上游（国内接口允许浏览器直连，DeepSeek 的 CORS 头我实测过）；
 * 网页版走自己的服务端（免得被浏览器跨域拦住）。
 */
export async function probeUpstreamModels(
  baseUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; models?: string[]; message?: string }> {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const key = apiKey.trim();
  if (!base) return { ok: false, message: "先填上游地址" };
  if (!key) return { ok: false, message: "先填密钥" };

  if (IS_APP) {
    /**
     * 候选地址要试两个，因为用户填的「上游地址」有两种习惯：
     *   · 填到根 `https://api.lmuai.ai` → 真正的接口在 `/v1`
     *   · 填到 `https://api.lmuai.ai/v1` → 直接拼 `/models`
     * 只试一个的话，前者会去请求网站首页（200 的 HTML），报出来的错
     * 会是「JSON 解析失败」，用户完全看不懂。
     */
    const candidates = [`${base}/models`];
    try {
      const u = new URL(base);
      if (u.pathname === "" || u.pathname === "/") candidates.push(`${base}/v1/models`);
    } catch {
      /* 不是标准 URL 就只试原来那个 */
    }

    let lastMessage = "";
    for (const url of candidates) {
      try {
        const fetched = await getJson(url, key);
        if (!fetched.ok) {
          lastMessage = fetched.message;
          // 4xx/5xx 是上游明确的答复，换路径也一样，别再试了
          if (fetched.status && fetched.status >= 400) break;
          continue;
        }
        return { ok: true, models: fetched.models };
      } catch (err) {
        lastMessage = `连不上上游：${(err as Error).message || "网络错误"}（检查地址与密钥）`;
      }
    }
    return { ok: false, message: lastMessage || "上游没列出模型，手动填吧" };
  }

  try {
    const res = await fetch("/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: base, apiKey: key }),
    });
    const text = await res.text();
    // 服务端万一不在（比如老部署），别把 HTML 当 JSON 解析 ——
    // 那句 "Unexpected token '<'" 对用户毫无意义。
    try {
      return JSON.parse(text) as { ok: boolean; models?: string[]; message?: string };
    } catch {
      return {
        ok: false,
        message: "这个页面拿不到模型列表（服务端接口不在），手动填模型名也行",
      };
    }
  } catch (err) {
    return { ok: false, message: `请求失败：${(err as Error).message || "网络错误"}` };
  }
}

/**
 * 取某一处的模型列表。
 *
 * 两条策略叠在一起：
 *   1. **先 fetch**（网页版 / 开了跨域的上游都走这条，行为不变）
 *   2. App 里被浏览器拦了（`Failed to fetch`）→ 用原生 HTTP 再要一次，
 *      否则没开 CORS 的中转永远「连不上上游」
 */
async function getJson(
  url: string,
  key: string,
): Promise<{ ok: true; models: string[] } | { ok: false; status?: number; message: string }> {
  const headers = { Authorization: `Bearer ${key}` };
  let status = 0;
  let text = "";
  try {
    const res = await fetch(url, { headers });
    status = res.status;
    text = await res.text();
  } catch (err) {
    if (!looksLikeNetworkBlock(err)) throw err;
    const nat = await nativeHttp({ url, method: "GET", headers });
    if (!nat) throw err;
    status = nat.status;
    text = typeof nat.data === "string" ? nat.data : JSON.stringify(nat.data ?? {});
  }

  if (status < 200 || status >= 300) {
    return { ok: false, status, message: `上游返回 ${status}：${text.slice(0, 200)}` };
  }
  // 拿到的是网页（HTML）说明路径不对，让调用方去试下一个候选
  const json = safeJson(text) as { data?: { id?: unknown }[] } | null;
  if (!json || !Array.isArray(json.data)) {
    return { ok: false, status, message: "这个地址返回的不是模型列表，可能是它的网页首页" };
  }
  const models = json.data
    .map((m) => m?.id)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  if (models.length === 0) return { ok: false, status, message: "上游没列出模型，手动填吧" };
  return { ok: true, models: models.sort() };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
