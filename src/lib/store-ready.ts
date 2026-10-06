import { useApp } from "@/lib/store";

/**
 * 等 store 从 IndexedDB 恢复完再写。
 *
 * ⚠️ 这一步**不能省**，是实测踩出来的真 bug：
 * OAuth 回调可能发生在**整页新加载**的页面上（浏览器从授权服务器跳回来），
 * 页面一加载 `persist` 就开始异步读 IndexedDB。如果这时候马上 `patchMcp`
 * 写令牌，会先写进内存、随后被**恢复出来的旧快照整个覆盖** ——
 * 表现就是"授权页明明说成功了，回列表却不显示已授权"（令牌悄悄没了）。
 *
 * 网页版（`/oauth/callback` 那条路由）和 App 版（深链回到 App）**都会用到**，
 * 所以放在一处 —— 这个 App 吃过"同一个零件多套写法"的苦。
 */
export async function waitHydrated(): Promise<void> {
  if (useApp.getState().hydrated) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsub();
      resolve();
    };
    const unsub = useApp.subscribe((s) => {
      if (s.hydrated) finish();
    });
    // 兜底：万一位已经置过、事件错过了，或者 IndexedDB 卡住
    if (useApp.getState().hydrated) finish();
    window.setTimeout(finish, 4000);
  });
}
