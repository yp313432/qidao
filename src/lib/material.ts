import type { MaterialId, Settings } from "./types";

/**
 * 材质只剩两档：**纯色**（在线）与**液态**（未上线，皮肤文件先封存）。
 *
 * 半磨砂 `frost` 2026-11 下线 —— 用户 m06619："只做纯色和液态这两个，
 * 磨砂的话就不做了，然后液态之后再做吧，先搞纯色的"。
 *
 * 为什么必须在这里兜底：老档案里存过 `material: "frost"`。那条值如果活到
 * `applyAppearance()`，`data-material="frost"` 就找不到任何变量块，
 * 页面会呈现"没有皮肤"的裸样式（卡片透明、线全丢）。所以**存档边界**统一落回纯色。
 *
 * 规矩（往后加材质也照这个来）：
 * · 模式文件 `src/styles/modes/<id>.css` 里**只许有变量**，不许出现选择器；
 * · 组件里判断材质只准走 `isSolid()` / `materialOf()`，不许自己写
 *   `settings.material === "…"` —— 否则加一档就要改十几处，两档就会互相干扰。
 */
export const MATERIALS: readonly MaterialId[] = ["solid", "liquid"];

/** 存档里读到的任意值 → 合法材质（认不出来的、已下线的，一律落回纯色） */
export function normalizeMaterial(raw: unknown): MaterialId {
  return raw === "liquid" ? "liquid" : "solid";
}

/** 当前材质（settings 可能还没加载，所以允许 undefined） */
export function materialOf(settings: Pick<Settings, "material"> | undefined): MaterialId {
  return normalizeMaterial(settings?.material);
}

/** 是不是纯色模式 —— 组件里判材质**只准**用这个 */
export function isSolid(settings: Pick<Settings, "material"> | undefined): boolean {
  return materialOf(settings) === "solid";
}
