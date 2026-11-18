import { useEffect, useRef } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { systemBackTarget } from "@/lib/nav-tree";
import { dismissTop } from "@/lib/dismiss-stack";

/**
 * 安卓的**系统返回**：返回键 + 侧边滑动手势。
 *
 * 用户真机反馈（这条是架构级的，不只是小 bug）：
 *   "它的返回竟然还是按照网页版来做的 —— 我用手机自带的滑侧边栏返回，
 *    返回的不是我当前页面的上一级，而是我操作的上一级页面。
 *    比如我点了语音通话，又切换到其他页面点开它的下级，
 *    最后一步步返回我所有点过的页面，即使他们之间并没有层级关系。"
 *
 * 网页的返回 = 历史栈（你点过的顺序）；**App 的返回 = 层级**（当前页的上级）。
 * 安卓 WebView 默认就是历史栈，所以必须**接管**：Capacitor 注册了 `backButton`
 * 监听时，系统返回不再走 WebView 的历史，而是问我们"该去哪儿"。
 *
 * 去哪儿**不由这里决定** —— 交给 `nav-tree.ts` 的 `systemBackTarget()`，
 * 跟页内那个返回钮同一份层级表（一处定义，两个入口）。
 *
 * 网页版不挂这个监听：浏览器里"历史返回"本来就是对的。
 *
 * 2026-11-18 补上另一半（任务书 3.3 第 5 条）：开着的**弹层先关**，
 * 没有弹层才退页 —— 栈在 `lib/dismiss-stack.ts`，抽屉/弹窗/思考链/动作确认卡
 * 打开时各自压一层进去。以前这里是"不管开没开都直接退页"。
 */
export function AppBack() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  /**
   * 层级表两种主题共用一张（2026-11-18），所以这里不再按材质分叉；
   * 事件回调里要读**此刻**的路径，用 ref 免得闭包读到旧的。
   */
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | null = null;

    async function goBack() {
      /*
        1) 先关最上面那一层：抽屉、弹窗、思考链、动作确认卡……
           （任务书 3.3 第 5 条，用户 m00516 拍板：弹层关闭行为单独处理）
           没人接这一下 = 没有弹层，才轮到退页。
      */
      if (dismissTop()) return;
      const target = systemBackTarget(pathRef.current);
      if (target !== "exit") {
        // replace：App 的返回不往历史里再压一层（不然栈会越走越深）
        navigate({ to: target, replace: true });
        return;
      }
      try {
        const { App } = await import("@capacitor/app");
        await App.exitApp();
      } catch {
        /* 网页版/拿不到桥：什么也不做 */
      }
    }

    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("backButton", () => {
          void goBack();
        });
        if (disposed) void handle.remove();
        else remove = () => void handle.remove();
      } catch {
        // 网页版没有原生桥 —— 交回浏览器（那里历史返回是对的）
      }
    })();

    return () => {
      disposed = true;
      remove?.();
    };
  }, [navigate]);

  return null;
}
