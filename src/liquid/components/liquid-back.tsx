import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

/**
 * 液态的「回对话页」箭头 —— 只在**没有底部导航**、又**有上一级**的页面上出现。
 *
 * 为什么需要它（用户 m08548 原话）：
 *   "由于咱们这个 没有底部导航栏了，所以你记得做好适配，还有返回键啥的。"
 *
 * 纯色世界里 `/tools` `/play` `/me` 是底部 tab 的落地页，它们**不该有返回钮** ——
 * 想换页点 tab 就行。液态把底部 tab 整层去掉了，于是这些页一进去就**没有路回去**：
 * 安卓有系统返回键（`shell/app-back.tsx` 已经按液态层级表接管），
 * 但网页版 / 手势不灵的时候，手上得有一个能看见的东西。
 *
 * m02943 第 6 条：用户不要"圆圈套 ‹"了 ——
 *   "不要那个圆圈套一个大鱼号，太大了，而且跟标题叠在一起，统一成纯 < 折角箭头 + 标题，
 *    所有界面一致，包括学习、音乐。"
 * 所以这里**只画箭头本身**，不再挂 `lq-glass lq-glass--float` 那层圆形毛玻璃底；
 * 位置和标题让位都在 `src/liquid/styles/glass.css` 的 `.lq-back` / `header` 规则里。
 * 箭头尺寸也写在 CSS（`.lq-back svg`），液态组件里不写 Tailwind 任意值。
 *
 * m03230：花园那几页原来各自画一颗箭头（有的回池塘、有的回棋桌、有的回花园）。
 * 查了 `src/lib/nav-tree.ts` 的 `parentOf`，它给的上一级跟那些自绘目标**完全一致**
 * （`/play/garden/cesta` → `/play/garden/stagno`、`tarot` → `/play/garden/tavolo`……），
 * 所以能统一：目标改由 app-shell 传进来（`parentOf(pathname, true)`），
 * 花园自绘的那几颗在液态下用 `.garden-back` 隐藏掉，全 App 只剩这一颗。
 * 插件页不在此列 —— 被 app-shell 排除（`/play/plugins/`），它们自己的返回钮压在
 * 任意插件背景上，需要底色保可见性，属于"不能统一"的那一类。
 */
export function LiquidBack({ to = "/" }: { to?: string }) {
  return (
    <Link to={to as never} aria-label="返回" className="lq-back">
      <ChevronLeft strokeWidth={1.5} />
    </Link>
  );
}
