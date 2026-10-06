import { actionTitle } from "@/lib/action-meta";
import { parseToolArgs } from "@/lib/tool-wire";
import type { AppAction } from "@/lib/types";

/**
 * 「这次工具调用是干什么的」—— 给界面用的一句话标题。
 *
 * ⚠️ 为什么不能直接把 `{ kind }` 丢给 `actionTitle()`：那个函数会读**具体字段**
 * （`action.path` / `action.text`…），拿不到就渲染成 "切换到页面 undefined" ——
 * 第一版真踩到了，截图里一眼看出来（这正是"断言全绿 ≠ 渲染对"）。
 *
 * ⚠️ 光"JSON.parse 没抛异常"还不够 —— **解析成功但字段缺失**同样是脏数据：
 *   · 无参调用（参数是空串，**这是合法的**）→ `切换到页面 undefined`
 *   · `{}` 给 media.volume → `把音量调到 NaN%`
 * 所以这里做三层兜底：解析失败 / 拼装时读字段抛错 / 结果里出现 `undefined|NaN`，
 * 一律退成一句"参数没读懂"。宁可说实话，也不要半截话。
 */
export function toolCallTitle(
  kind: AppAction["kind"] | null,
  name: string,
  args: string,
): string {
  if (!kind) return `不认识的工具 ${name}`;
  const fallback = `做了「${kind}」（参数没读懂）`;
  const parsed = parseToolArgs(args);
  if (parsed.error) return fallback;
  try {
    const title = actionTitle({ kind, ...parsed.args } as AppAction);
    if (!title || /undefined|NaN/.test(title)) return fallback;
    return title;
  } catch {
    return fallback;
  }
}
