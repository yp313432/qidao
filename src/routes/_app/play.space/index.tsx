import { createFileRoute } from "@tanstack/react-router";
import { SpaceView } from "@/components/play/space-view";

/**
 * 动态空间目录。
 *
 * ⚠️ 这里必须是**目录 + index.tsx**（跟「小日子」`play.tools/` 一个写法），
 * 不能写成 `play.space.tsx`：那样它会变成下面三页的**布局路由**，
 * 而布局要自己渲染 `<Outlet/>` —— 三页就都会渲染成这个目录（真跑抓到过）。
 * 现在这样三页是它的**平级子路径**，各自整页渲染，互不影响。
 */
export const Route = createFileRoute("/_app/play/space/")({
  component: SpaceView,
});
