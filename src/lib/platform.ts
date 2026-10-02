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

/** 打包成安卓 App 的那种构建（VITE_DIRECT_UPSTREAM=1）。 */
export const IS_APP =
  (import.meta.env?.VITE_DIRECT_UPSTREAM as string | undefined) === "1";

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
    try {
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, message: `上游返回 ${res.status}：${text.slice(0, 200)}` };
      }
      const json = JSON.parse(text) as { data?: { id?: unknown }[] };
      const models = (json.data ?? [])
        .map((m) => m?.id)
        .filter((x): x is string => typeof x === "string" && x.length > 0);
      if (models.length === 0) return { ok: false, message: "上游没列出模型，手动填吧" };
      return { ok: true, models: models.sort() };
    } catch (err) {
      return {
        ok: false,
        message: `连不上上游：${(err as Error).message || "网络错误"}（检查地址与密钥）`,
      };
    }
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
