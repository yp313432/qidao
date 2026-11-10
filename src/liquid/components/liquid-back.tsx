import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { requestDrawer } from "@/lib/drawer-request";

/**
 * 液态的「回对话页」箭头 —— **兜底用**，只在"这一页根本没画页头"的页面上出现。
 *
 * 为什么需要它（用户 m08548 原话）：
 *   "由于咱们这个 没有底部导航栏了，所以你记得做好适配，还有返回键啥的。"
 *
 * 纯色世界里 `/tools` `/play` `/me` 是底部 tab 的落地页，它们**不该有返回钮** ——
 * 想换页点 tab 就行。液态把底部 tab 整层去掉了，于是这些页一进去就**没有路回去**：
 * 安卓有系统返回键（`shell/app-back.tsx` 已经按液态层级表接管），
 * 但网页版 / 手势不灵的时候，手上得有一个能看见的东西。
 *
 * ── 它现在是兜底，不是主力（用户 m03354 / m03470）──────────────────
 * 用户报的毛病："这个返回键跟我的，他俩不是绑定的，就是我往下滑的时候，这个我的会被
 * 划上去，但是返回键却不会被划上去就导致它会跟下面有重叠" —— 因为这一颗是
 * `position: absolute` 挂在页面容器上，压根不在滚动内容里。
 *
 * 所以主力已经换成 `PageHeader` / `PlayHeader` 自己画的那颗（`.lq-back--inline`，
 * 跟标题同一个 `<header>`、一起滚）。这一颗只在页面**没有页头**时兜底补上
 * （app-shell 靠 `lib/header-registry` 判断）。
 *
 * 用户 m03470："二级返回一级是到侧边栏的，因为我是在侧边栏点开他们后续的，
 * 不应该返回到对话页，不然我每次都要再展开侧边栏。" → 回 `/` 时顺手拉开抽屉。
 */
export function LiquidBack({ to = "/" }: { to?: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <Link
      to={to as never}
      aria-label="返回"
      className="lq-back lq-back--global"
      onClick={() => {
        // 二级目录页的上一级就是对话页 —— 退回时把侧边栏拉开（m03470）
        if (pathname !== "/") requestDrawer();
      }}
    >
      <ChevronLeft strokeWidth={1.5} />
    </Link>
  );
}
