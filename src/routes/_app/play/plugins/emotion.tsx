import { createFileRoute } from "@tanstack/react-router";
import { EmotionLifeformPluginView } from "@/components/play/plugins/emotion-lifeform";

/**
 * 情绪生命体 —— **原生型插件**：`src/plugins/emotion-lifeform/` 那个 App 直接渲染，
 * 整页铺满、隐藏底部导航、自带返回钮（跟记忆宇宙同一个套路）。
 *
 * 层级 / 导航不用在这里写：`nav-tree.ts` 里
 *   · `hidesNav` 的 `FULL_BLEED_PREFIXES` 已经含 `/play/plugins/`
 *   · `parentOf` 已经把 `/play/plugins/*` 的上一级定成 `/play/plugins`
 * 两条都是**前缀规则**，所以新增插件不用动那张表（那个文件自己也这么写着）。
 */
export const Route = createFileRoute("/_app/play/plugins/emotion")({
  component: EmotionLifeformPluginView,
});
