import { useEffect, useRef } from "react";

/**
 * 临时诊断条（用户 m04221 那一轮）。
 *
 * 起因：输入条离屏幕底/键盘顶总还有一截，但 CSS 已经压到没得压了 ——
 * `.lq-skin .pb-composer` 是 0、外壳只剩 2px、`.lq-composer` 自己没有外边距。
 *
 * v14 第一轮实测（用户 m04309 截图）拿到的数：
 *   ih=781 vv=782/0 root=781 sb=22 dock=21 card=56 pb=0px kbd=0px
 *   → `dock=21` 和 `sb=22` 对上了，说明 fixed 生效、容器确实贴到了视口底；
 *     但 `card=56` 比它多 35px —— 卡片在容器里还悬着 35px，这才是用户看到的那道缝。
 *   所以这一版把三个高度也打出来，一次定位那 35px 到底是谁撑的。
 *
 * 字段：
 *   ih/vv/root  布局视口 / 可视视口 / 根元素高（键盘弹起时只有 vv 会变）
 *   sb          手势条高（--q-inset-bottom）
 *   dock/card   输入条容器底、卡片底，各自距 innerHeight 还有多少 px（0 = 贴死）
 *   dh/wh/ch    容器高 / composerWrap 高 / 卡片高（差的 35px 应该出现在这里）
 *   pb          `.pb-composer` 算出来的 padding-bottom
 *   kbd         原生推上来的键盘高
 *
 * 定位完立刻删掉。
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
      const hOf = (node: Element | null) =>
        node ? Math.round(node.getBoundingClientRect().height) : -1;
      el.textContent =
        `ih=${ih} vv=${vv ? Math.round(vv.height) : -1}/${vv ? Math.round(vv.offsetTop) : -1} ` +
        `root=${root.clientHeight} sb=${parseFloat(cs.getPropertyValue("--q-inset-bottom")) || 0} ` +
        `dock=${gapOf(dock)} card=${gapOf(card)} ` +
        `dh=${hOf(dock)} wh=${hOf(pbEl?.parentElement ?? null)} ch=${hOf(card)} ` +
        `pb=${pbEl ? getComputedStyle(pbEl).paddingBottom : "-"} ` +
        `kbd=${cs.getPropertyValue("--q-ime-bottom-native").trim() || "0"}`;
    };
    tick();
    const timer = window.setInterval(tick, 700);
    return () => window.clearInterval(timer);
  }, []);

  return <div ref={ref} className="lq-probe" aria-hidden />;
}
