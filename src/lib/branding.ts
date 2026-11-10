/**
 * 品牌名与角色名 —— 两回事，别混用。
 *
 * `APP_NAME` 是这个应用的名字（浏览器标题、分享卡片、App 内的产品自称）。
 * AI 的名字由用户在「我的 → 形象 → AI 名字」里自己填（存在本地设置里），
 * 没填时回落到 `DEFAULT_AI_NAME`。
 */
/**
 * 2026-11-10 改名：用户 m03921「我想把栖岛图标换成这个，并且改名为 Yisle,能改不」。
 * 只改**对外名字**（桌面图标名、窗口标题、分享卡片、App 内自称），包名
 * `com.yanping.qidao` 一个字没动 —— 改包名等于换成一个新 App，手机上会并排装两套、
 * 旧数据也不会继承过来。
 */
export const APP_NAME = "Yisle";

export const DEFAULT_AI_NAME = "星芒";

/**
 * 构建标记：用来确认设备上跑的是不是最新代码（临时，稳定后可删）。
 *
 * ⚠️ 2026-11-10 教训（用户 m02144："我装了三遍包，我都怀疑我装错了"）：
 *   这个标记原来一直写死 `v4`，从十月到现在的几十个包**全都显示 v4** ——
 *   用户拿它根本没法判断自己装的是哪一版，我也没法判断。以后每推一版就改这里的号，
 *   它显示在「我的」页最底下一行（`Yisle · 思考链保存在这台设备 · vN`）。
 */
export const BUILD_TAG = "v13";

/** 取实际生效的 AI 名字：用户填了就用用户的，没填用默认。 */
export function resolveAiName(name?: string | null): string {
  const t = (name ?? "").trim();
  return t || DEFAULT_AI_NAME;
}
