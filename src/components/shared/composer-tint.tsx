import { useEffect } from "react";
import { TINT_ALPHAS, TINT_VARS, hexToRgba, normalizeTint } from "@/lib/composer-tint";
import { useApp } from "@/lib/store";
import { materialOf } from "@/lib/material";

/**
 * 把「我的 → 个性化 → 对话框玻璃配色」里挑的颜色写进 `--q-tint-1/2/3`。
 *
 * 挂在 `app-shell.tsx`（整个 App 只有一份）：`.glass-float` 是**全局**类，
 * 所以这里改一次，聊天输入框、底部各种玻璃浮层会一起跟着变 ——
 * 不在这里写的话，每个用到 `.glass-float` 的地方都得自己拼 style（迟早走散）。
 *
 * 没设置（老存档 / 刚装）→ `normalizeTint` 会补成默认那套粉青蓝，
 * 也就是跟以前写死在 CSS 里完全一样的观感。
 */
export function ComposerTint() {
  const tint = useApp((s) => s.settings.composerTint);
  const material = useApp((s) => materialOf(s.settings));

  useEffect(() => {
    const root = document.documentElement;
    const colors = normalizeTint(tint);
    // 纸底稍染色，液态给渐变多一点可见度。
    const scale = material === "solid" ? 0.3 : 0.55;
    TINT_VARS.forEach((name, i) => {
      const css = hexToRgba(colors[i], TINT_ALPHAS[i] * scale);
      if (css) root.style.setProperty(name, css);
      else root.style.removeProperty(name);
    });
  }, [tint, material]);

  return null;
}
