import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * 玩乐区首页 —— **已删**（用户 m02947）。
 *
 * 原话："点花园的时候，然后返回它还是会卡出之前的玩乐区那个页面。之前那个玩乐区
 * 不是磨砂模式会有的吗？因为磨砂模式咱们是取消嘛？所以那个玩乐区直接删掉就行了。"
 *
 * 液态模式下功能直接列在对话抽屉里（工具/动态/岁序/音乐/学习/花园/插件/桌宠），
 * 不再有"玩乐区"这一层首页，所以 `components/views/play-hub.tsx` 整个删掉了。
 *
 * 这个路由文件本身保留、改成兜底重定向：花园等子页面的返回钮还写着 `/play`，
 * 历史记录里也可能残留 `/play`，进来一律回对话页，绝不渲染旧的玩乐区。
 * TODO（一级一级改）：把这些子页的返回钮逐个改成 `/`，改完这个文件就可以删。
 */
export const Route = createFileRoute("/_app/play/")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
