import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

/**
 * 液态的「回对话页」圆钮 —— 只在**没有底部导航**、又**没自带返回钮**的页面上出现。
 *
 * 为什么需要它（用户 m08548 原话）：
 *   "由于咱们这个 没有底部导航栏了，所以你记得做好适配，还有返回键啥的。"
 *
 * 纯色世界里 `/tools` `/play` `/me` 是底部 tab 的落地页，它们**不该有返回钮** ——
 * 想换页点 tab 就行。液态把底部 tab 整层去掉了，于是这三张页一进去就**没有路回去**：
 * 安卓有系统返回键（`shell/app-back.tsx` 已经按液态层级表接管），
 * 但网页版 / 手势不灵的时候，手上得有一个能看见的东西。
 *
 * 位置（用户 m08661 定的 B 方案）：**左上角圆形玻璃钮**，符合"返回在左上"的通用习惯。
 * 代价是会和页面标题抢地方 —— 所以 `.lq-skin .k-head` 让出了 48px 左内边距
 * （见 `src/liquid/styles/glass.css`）；标题居中的页（玩乐首页）天然不冲突。
 */
export function LiquidBack() {
  return (
    <Link to="/" aria-label="返回对话" className="lq-back lq-glass lq-glass--float">
      <ChevronLeft className="size-5" strokeWidth={1.7} />
    </Link>
  );
}
