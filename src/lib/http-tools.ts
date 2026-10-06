import type { HttpTool } from "./types";

/**
 * HTTP 工具的**请求构造** —— 只有这一份实现，两个地方共用：
 *
 *   · 「工具 → HTTP」里手动点「调用」
 *   · **模型自己调**（`http.call` 动作，走权限闸门之后）
 *
 * 为什么必须共用：这两条路以前会长成两套（手动那套写在组件里），
 * 于是"参数怎么拼、请求头怎么带、方法怎么分"总有一边忘了改 ——
 * 用户的原话就是"这个组件一套代码写法，换一个组件又是另一套"。
 */

/** 把模型给的值变成能放进 URL / JSON 的字符串 */
function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * 这个工具**能被改的参数**有哪些 —— 从用户配好的请求里**推导**出来，不额外加 UI。
 *
 *   · GET / DELETE：网址里已有的查询参数（`?city=hangzhou` → `city`）
 *   · POST / PUT：请求体是 JSON 对象时，它的顶层键（`{"city":"hangzhou"}` → `city`）
 *
 * 为什么这么设计：用户"配了什么"就是"模型能改什么"，不用再去填一份参数说明；
 * 而模型看到的参数名跟真实请求完全一致，不会瞎编。
 */
export function paramsOfTool(tool: HttpTool): string[] {
  if (tool.method === "GET" || tool.method === "DELETE") {
    try {
      return [...new Set(new URL(tool.url).searchParams.keys())];
    } catch {
      return [];
    }
  }
  const raw = tool.body.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed as Record<string, unknown>);
    }
  } catch {
    /* 不是 JSON 就没有可改的参数 */
  }
  return [];
}

/** 请求头：每行一个 "Key: Value" */
function headersOf(tool: HttpTool): Headers {
  const headers = new Headers();
  for (const line of tool.headersText.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return headers;
}

export type BuiltRequest =
  | { ok: true; url: string; init: RequestInit; note: string }
  | { ok: false; error: string };

/**
 * 拼出最终要发的那一次请求。
 *
 * 参数（`args`）可以**不传** —— 那就是"按用户配好的原样发一次"，
 * 跟以前手动「调用」的行为**完全一致**（这条很重要：不能让加了 AI 之后
 * 手动那条路的行为变了）。
 *
 * 传了参数时：
 *   · GET / DELETE → 拼到网址的查询串上（已有的同名参数被覆盖）
 *   · POST / PUT → 请求体是 JSON 对象就**浅合并**；请求体空着就直接用参数当体
 *     ⚠️ 请求体**不是** JSON 对象还硬塞参数会把请求弄变形 —— 这种情况明确拒绝，
 *        而不是偷偷丢掉参数（丢了参数对方接口会返回莫名其妙的结果，更难查）
 */
export function buildHttpRequest(
  tool: HttpTool,
  args: Record<string, unknown> = {},
): BuiltRequest {
  const headers = headersOf(tool);
  const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== null);
  let url = tool.url.trim();
  if (!url) return { ok: false, error: "这个工具还没填地址。" };

  let body: string | undefined;
  let note = "";

  if (tool.method === "GET" || tool.method === "DELETE") {
    if (entries.length) {
      try {
        const u = new URL(url);
        for (const [k, v] of entries) u.searchParams.set(k, asString(v));
        url = u.toString();
        note = `（参数拼到了网址上：${entries.map(([k, v]) => `${k}=${asString(v)}`).join("、")}）`;
      } catch {
        return { ok: false, error: `地址不是合法网址，拼不了参数：${url}` };
      }
    }
  } else {
    const raw = tool.body.trim();
    if (!entries.length) {
      body = raw || undefined;
    } else if (!raw) {
      body = JSON.stringify(args);
      note = "（参数作为请求体发出去）";
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = undefined;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = JSON.stringify({ ...(parsed as Record<string, unknown>), ...args });
        note = `（参数合并进了请求体：${entries.map(([k]) => k).join("、")}）`;
      } else {
        return {
          ok: false,
          error:
            "这个工具的请求体不是 JSON 对象，硬塞参数会把请求弄坏。\n两个办法：① 把请求体清空（参数就会当 JSON 体发出去）② 这次别带参数（直接调，按原样发）。",
        };
      }
    }
  }

  const init: RequestInit = { method: tool.method, headers };
  if (body !== undefined) {
    init.body = body;
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  return { ok: true, url, init, note };
}
