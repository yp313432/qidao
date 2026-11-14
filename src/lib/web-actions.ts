/**
 * **手机上"搜网页 / 读网页"这两个动作的执行器**（`web.search` / `web.fetch`）。
 *
 * ── 为什么单独一个文件，而不是塞进 `actions.ts` 的 switch ──────────
 *
 * `actions.ts` 已经是几百行的总执行器，而且它 import 了 store / player / mcp / tts
 * 一大堆**只跟界面有关**的东西。联网这两个动作的全部逻辑都在 `lib/web-http.ts`，
 * 单独放一个文件有两个好处：
 *   · `actions.ts` 那边只加两行（`case "web.search": return runWebAction(action);`），
 *     对那个大文件是**最小改动**；
 *   · 这一层能被验收脚本/以后的原生调试单独 import 来跑。
 *
 * ⚠️ 措辞纪律：结果里**只有他问的内容**（标题/链接/摘要/正文），
 * 不许出现密钥、也不许把"我查了一下"这类过程话说进结果（那是给模型读的回执）。
 */

/*
  ⚠️ 相对路径 + 显式 `.ts` 同上：这个文件也想被纯 node 直接 import（验收脚本），
  别名 `@/` 只有 Vite/tsc 认得、node 也不补扩展名。
*/
import { readWebPage, webSearch } from "./web-http.ts";
import type { AppAction } from "./types.ts";
import type { WebReceipt } from "./web-sources.ts";

/** `web.search` 最多给几条（省上下文，也够模型挑） */
const MAX_HITS = 8;
/** `web.fetch` 最多给多少字 —— 再多会把上下文塞满，模型反而读不出重点 */
const MAX_CHARS = 6000;

/**
 * 跑一个联网动作，返回**给模型看的回执文本**（跟别的动作一样是字符串）。
 *
 * 失败一律**如实说**（"网络不通"/"对方返回 404"/"这个地址不给读"），
 * 绝不静默、绝不假装读到了 —— 这是这个 App 里所有外部能力的统一口径。
 */
export async function runWebAction(
  action: Extract<AppAction, { kind: "web.search" }> | Extract<AppAction, { kind: "web.fetch" }>,
): Promise<string> {
  if (action.kind === "web.search") {
    const query = (action.query ?? "").trim();
    if (!query) return "搜索要给我一个词（query 是空的）。";
    const r = await webSearch(query, { limit: MAX_HITS });
    const receipt: WebReceipt = r.ok
      ? { version: 1, kind: "web.search", ok: true, query, engine: r.engine, results: r.results,
          summary: `搜「${query}」找到 ${r.results.length} 个来源。当前内容是搜索摘要；按相关性、时效和来源挑选，通常先读 2～3 条。结论引用用 [来源](实际网址)。某页正文读不到时保留这些搜索结果，说明依据范围。` }
      : { version: 1, kind: "web.search", ok: false, query, results: [], why: r.why, summary: `搜「${query}」未取得结果：${r.why}` };
    return JSON.stringify(receipt);
  }

  const url = (action.url ?? "").trim();
  if (!url) return "读网页要给我一个网址（url 是空的）。";
  const r = await readWebPage(url, { maxChars: MAX_CHARS });
  const receipt: WebReceipt = r.ok
    ? { version: 1, kind: "web.fetch", ok: true, url: r.url, title: r.title, text: r.text, truncated: r.truncated,
        summary: r.truncated ? `已读取该页正文，截取前 ${MAX_CHARS} 字。` : "已读取该页正文。" }
    : { version: 1, kind: "web.fetch", ok: false, url, why: r.why,
        summary: `这页正文未读到：${r.why}。这次失败只针对该网页，不代表搜索失败；可使用已取得的标题、链接和搜索摘要，或更换来源。不要声称读过全文。` };
  return JSON.stringify(receipt);
}

