import { useEffect, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { requestDrawer } from "@/lib/drawer-request";
import { registerPageHeader } from "@/lib/header-registry";
import { materialOf } from "@/lib/material";
import { backLabelOf, parentOf } from "@/lib/nav-tree";
import { useApp } from "@/lib/store";

/**
 * 二级页统一的顶部：左上角返回 + 标题 +（可选）右边一个动作。
 *
 * ── 为什么必须有这个文件 ──────────────────────────────────────
 * 用户的原话："重要的是我现在要统一一下这个 APP 的整体风格和框架，
 * 不要每一个页面一个风格那种，很乱。"
 *
 * 之前"返回 + 标题"这一个零件，全 App 有 **5 套写法**：
 *   A. alarms / env / inner / memory / permissions / tasks / worldbook /
 *      memory-library —— size-11 按钮 + 图标 size-6 + strokeWidth 1.6
 *   B. 「我的」拆出来的 /space /usage /data /system —— size-9 + size-4
 *   C. /core（AI 概览）—— size-9 + size-4，而且是**反着旋转**的 ChevronRight
 *   D. play-header.tsx —— size-6
 *   E. voice-view.tsx —— size-6，连 aria-label 都不一样
 *
 * 同一个"返回"按钮五种尺寸，就是"很乱"的根源。现在全部走这里，
 * 以后新增二级页照抄 `PageHeader`，不会再长出第六套。
 *
 * ── 液态世界的返回键（用户 m03354 / m03470）──────────────────────
 * 以前液态下这里**不画箭头**（`{!liquid && …}`），全 App 只靠 app-shell 渲染的
 * 那一颗 `.lq-back`。它是绝对定位、**不在滚动内容里**：
 *   · 标题随页面滚走、箭头钉住 → 下滑时叠在一起；
 *   · 对齐只能靠给各页头补 `padding-left` 硬凑 → 页面一多就凑不齐
 *     （"工具界面也是没对齐，基本上都有这种情况"）。
 * 现在反过来：**箭头就在这个 header 里**，跟标题同一行、同一个滚动容器，
 * 尺寸也固定成一套（箭头 26 / 左边距 16 / 与标题间距 12 / 标题 23px，
 * 见 glass.css 的 `.lq-head`）。app-shell 只给"没画页头的页面"兜底补一颗。
 *
 * ── 返回目标不再手写（用户报的第二个毛病）────────────────────────
 * 用户："返回只能返回上一级，不能直接返回首页……所有的返回都要是返回上一级"。
 *
 * 原来每个页面自己写 `to="/me"`，页面被挪深一层时它不会跟着变 ——
 * 于是 `/memory`（在「模型与用量」里面）一直退回一级首页「我的」。
 *
 * 现在**默认从 `nav-tree.ts` 的层级表读**：不传 `to` 就等于"回上一级"，
 * 这层关系只有一处定义。只有确实要跳别处才显式传 `to`。
 */
export function PageHeader({
  title,
  to,
  backLabel,
  right,
  description,
}: {
  title: string;
  /**
   * 返回去哪儿。
   * **不传（推荐）= 自动回上一级**，由 nav-tree 算出来。
   * 只有确实要跳去非上一级的地方才显式传。
   */
  to?: string;
  backLabel?: string;
  /** 标题右边的东西：动作按钮、计数、状态文字…… 不传就只有标题 */
  right?: ReactNode;
  /** 标题下面那行小字。标题跟着页面滚，所以这里也不吸顶。 */
  description?: string;
}) {
  // 当前路径 —— 用来查"我的上一级是谁"
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const liquid = useApp((s) => materialOf(s.settings) === "liquid");
  const target = to ?? parentOf(pathname, liquid) ?? (liquid ? "/" : "/me");
  const label = backLabel ?? backLabelOf(pathname, liquid);

  /**
   * 告诉 app-shell："这一页自己有页头，别再补那颗兜底箭头"。
   * 卸载时自动撤销（切页那一瞬间计数会短暂为 0，但那时页面也在换，看不出来）。
   */
  useEffect(() => registerPageHeader(), []);

  return (
    <header className={liquid ? "lq-head px-4" : "inset-top-50 px-2 pb-1"}>
      <div className={liquid ? "flex items-center gap-3" : "flex items-center gap-1"}>
        {/*
          用户 m01915/m01967："这俩都是一样的东西，不要出现两种情况。"
          用户 m02943 第 6 条："不要那个圆圈套一个大鱼号……统一成纯 < 折角箭头 + 标题。"
          → 液态下这里画的就是那颗裸箭头（`.lq-back--inline`，样式在 glass.css）。

          用户 m03470："二级返回一级是到侧边栏的，因为我是在侧边栏点开他们后续的，
          不应该返回到对话页，不然我每次都要再展开侧边栏。"
          → 退回对话页（`/`）时顺手把抽屉拉开（见 lib/drawer-request）。
        */}
        <Link
          to={target as never}
          aria-label={label}
          className={
            liquid ? "lq-back lq-back--inline" : "flex size-11 shrink-0 items-center justify-center"
          }
          onClick={() => {
            if (liquid && target === "/") requestDrawer();
          }}
        >
          <ChevronLeft className={liquid ? undefined : "size-6"} strokeWidth={liquid ? 1.5 : 1.6} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg font-medium">{title}</h1>
        {right}
      </div>
      {description && <p className="pb-1 text-[11px] leading-4 text-subtle">{description}</p>}
    </header>
  );
}
