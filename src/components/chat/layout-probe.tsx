import { useEffect, useRef } from "react";

/**
 * 临时诊断条（用户 m04221 那一轮）。
 *
 * 起因：输入条离屏幕底/键盘顶总还有一截，但 CSS 已经压到没得压了 ——
 * `.lq-skin .pb-composer` 是 0、外壳只剩 2px、`.lq-composer` 自己没有外边距。
 * 那就说明留白不在 CSS 的 padding 里，而在「输入条挂的那块容器底 ≠ 屏幕底」这一层。
 *
 * 所以把这几个真实数字打到屏幕最底下一行，用户截一张图就能定量看出到底差在哪：
 *   ih    = window.innerHeight（布局视口高）
 *   vv    = visualViewport.height/offsetTop（键盘弹起时它会变小）
 *   root  = documentElement.clientHeight
 *   sb    = --q-inset-bottom（手势条/导航条高度）
 *   dock  = 输入条容器底距 innerHeight 还有多少 px（0 = 已经贴死）
 *   card  = 输入卡片底距 innerHeight 还有多少 px
 *   pb    = `.pb-composer` 当前算出来的 padding-bottom
 *   kbd   = --q-ime-bottom-native（原生推的键盘高）
 *
 * 定位完立刻删掉（只在这里挂一行，不新增别的开关）。
 */
export function LayoutProbe() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => {
      const el = ref.current;
      if (!el) return;
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      const vv = window.visualViewport;
      const ih = window.innerHeight;
      const dock = document.querySelector(".lq-composer-dock");
      const pbEl = document.querySelector(".pb-composer");
      const card = document.querySelector(".lq-composer");
      const gapOf = (node: Element | null) =>
        node ? Math.round(ih - node.getBoundingClientRect().bottom) : -1;
      el.textContent =
        `ih=${ih} vv=${vv ? Math.round(vv.height) : -1}/${vv ? Math.round(vv.offsetTop) : -1} ` +
        `root=${root.clientHeight} sb=${parseFloat(cs.getPropertyValue("--q-inset-bottom")) || 0} ` +
        `dock=${gapOf(dock)} card=${gapOf(card)} ` +
        `pb=${pbEl ? getComputedStyle(pbEl).paddingBottom : "-"} ` +
        `kbd=${cs.getPropertyValue("--q-ime-bottom-native").trim() || "0"}`;
    };
    tick();
    const timer = window.setInterval(tick, 700);
    return () => window.clearInterval(timer);
  }, []);

  return <div ref={ref} className="lq-probe" aria-hidden />;
}
