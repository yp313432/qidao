/**
 * 品牌名与角色名 —— 两回事，别混用。
 *
 * `APP_NAME` 是这个应用的名字（浏览器标题、分享卡片、App 内的产品自称）。
 * AI 的名字由用户在「我的 → 形象 → AI 名字」里自己填（存在本地设置里），
 * 没填时回落到 `DEFAULT_AI_NAME`。
 */
export const APP_NAME = "栖岛";

export const DEFAULT_AI_NAME = "星芒";

/** 构建标记：用来确认设备上跑的是不是最新代码（临时，稳定后可删）。 */
export const BUILD_TAG = "v4";

/** 取实际生效的 AI 名字：用户填了就用用户的，没填用默认。 */
export function resolveAiName(name?: string | null): string {
  const t = (name ?? "").trim();
  return t || DEFAULT_AI_NAME;
}
