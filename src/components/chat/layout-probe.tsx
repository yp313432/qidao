import { useEffect, useRef } from "react";

/**
 * 临时诊断条（定位完立刻删）。
 *
 * v14 实测：`ih=781 vv=782/0 root=781 sb=22 dock=21 card=56 pb=0px kbd=0px`
 *   → dock 和 sb 对上 ⇒ fixed 生效；card 比 dock 多 35px ⇒ 卡片在容器里悬着。
 * v15 实测（把不弹键盘时的 bottom 从 22px 收成 0）：
 *   `ih=781 vv=782/0 root=781 sb=22 dock=-1 card=34 dh=133 wh=98 ch=98 pb=0px kbd=0px`
 *   → dock 已经贴到视口底（-1 是 781 与 782 那 1px 的取整），22px 修好了；
 *     但 card 还差 34px —— dock 高 133、外层 98、卡片 98，**容器底部凭空多出 35px**。
 *     这 35px 只可能是 dock 自己的 padding-bottom、或它那唯一子元素的 margin-bottom，
 *     所以这一版把这两个值直接打出来，顺手把两条可能的 margin 一起清零。
 *
 * 字段：
 *   ih/vv/root  布局视口 / 可视视口 / 根元素高
 *   sb          手势条高（--q-inset-bottom）
 *   dock/card   输入条容器底、卡片底，各自距 innerHeight 还差多少（0 = 贴死，负数 = 越界）
 *   dh/wh/ch    容器高 / composerWrap 高 / 卡片高
 *   pb          `.pb-composer` 的 padding-bottom
 *   dpb         容器自己的 padding-bottom（怀疑对象之一）
 *   wmb         容器唯一子元素的 margin-bottom（怀疑对象之二）
 *   n           页面上有几个 `.lq-composer-dock`（排除读到别处实例）
 *   kbd         原生推上来的键盘高
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
      const wrap = document.querySelector(".lq-composer-dock > div");
      const pbEl = document.querySelector(".pb-composer");
      const card = document.querySelector(".lq-composer");
      const gapOf = (node: Element | null) =>
        node ? Math.round(ih - node.getBoundingClientRect().bottom) : -1;
      const hOf = (node: Element | null) =>
        node ? Math.round(node.getBoundingClientRect().height) : -1;
      const cssOf = (node: Element | null, prop: string) =>
        node ? getComputedStyle(node).getPropertyValue(prop) || "-" : "-";
      el.textContent =
        `ih=${ih} vv=${vv ? Math.round(vv.height) : -1}/${vv ? Math.round(vv.offsetTop) : -1} ` +
        `root=${root.clientHeight} sb=${parseFloat(cs.getPropertyValue("--q-inset-bottom")) || 0} ` +
        `dock=${gapOf(dock)} card=${gapOf(card)} ` +
        `dh=${hOf(dock)} wh=${hOf(wrap)} ch=${hOf(card)} ` +
        `pb=${pbEl ? getComputedStyle(pbEl).paddingBottom : "-"} ` +
        `dpb=${cssOf(dock, "padding-bottom")} wmb=${cssOf(wrap, "margin-bottom")} ` +
        `n=${document.querySelectorAll(".lq-composer-dock").length} ` +
        `kbd=${cs.getPropertyValue("--q-ime-bottom-native").trim() || "0"}`;
    };
    tick();
    const timer = window.setInterval(tick, 700);
    return () => window.clearInterval(timer);
  }, []);

  return <div ref={ref} className="lq-probe" aria-hidden />;
}
