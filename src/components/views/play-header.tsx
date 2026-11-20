import type { ReactNode } from "react";
import { PageHeader } from "@/components/shared/page-header";

/**
 * 玩乐区各页统一的顶部 —— **现在只是 `PageHeader` 的一层薄壳**（2026-11-18 合并）。
 *
 * 用户 m00771："纯色下工具页点进去，你看返回键和其他二级页面是不是不统一……
 * 纯色照搬液态的就行了。" 排查发现全 App 的「返回 + 标题」还有**两个**实现：
 * `PageHeader`（inset-top-50）与这个 `PlayHeader`（inset-top-60 + 自绘 flex），
 * 除了 2px 的顶部内边距、几乎逐行相同 —— 于是工具页对齐了 `PageHeader` 之后，
 * 玩乐区反而成了唯一一套「多 2px」的页头。
 *
 * 合并方式：这里直接转给 `PageHeader`，返回目标仍走 nav-tree（不传就是上一级），
 * 液态/纯色两套规范都在 PageHeader 里，玩乐区各页一行都不用改。
 * 保留这个文件名是因为 13 个玩乐区页面都 import 它；以后新页面直接用 `PageHeader`。
 */
export function PlayHeader({
  title,
  extra,
  backTo,
  backLabel,
}: {
  title: string;
  extra?: ReactNode;
  /** 不传（推荐）= 自动回上一级；只有确实要跳别处才显式传 */
  backTo?: string;
  backLabel?: string;
}) {
  return <PageHeader title={title} right={extra} to={backTo} backLabel={backLabel} />;
}
