/**
 * 路由加载中的顶部细进度条（业内通行做法，GitHub / YouTube 同款）。
 *
 * 为什么要有它：我们切二级页慢，慢的不是渲染，是**那个页面的 JS chunk 还没下载完**。
 * 以前这段时间界面一动不动 —— 用户看到的就是"点了没反应，两三秒后才换页"。
 * 加上这一条不占布局、不动内容的 2px 细线，等待就从"卡住"变成"在加载"。
 *
 * 放在 router 的 defaultPendingComponent 上（见 src/router.tsx）：
 * 只有真等超过 defaultPendingMs 才会出现，快的时候一眼都看不到。
 * 只动 transform（GPU 合成），不触发重排重绘，成本可以忽略。
 */
export function RoutePending() {
  return (
    <div className="k-route-pending" aria-hidden>
      <span />
    </div>
  );
}
