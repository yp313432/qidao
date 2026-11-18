/**
 * 长对话的「首批只渲染最近 N 条」窗口（2026-11 微信式分批渲染）。
 *
 * 为什么：聊天页原来一次性把**全部**消息（连同每条拆成几十上百个节点的 Markdown）
 * 都挂到 DOM 上 —— 4 万节点，屏幕只看得到 5、6 条，其余全在算位置。
 * 手机上首屏和切对话最大的那笔开销就在这里。
 *
 * 做法跟微信一样：进来先铺最近 FIRST_VIEW 条，用户往上翻点「载入更早的消息」
 * 再补一批；补的时候把 scrollTop 按新增高度挪回来，看起来纹丝不动。
 *
 * 没有用 `content-visibility: auto`：它会隐含 paint 隔离，
 * 而 `src/styles/base.css` 里明确只给消息行加 `contain: layout`、不加 paint，
 * 就是为了保住搜索跳转时 `.aster-highlight` 那圈 6px 外扩光晕（裁掉是视觉回归）。
 */
import { useCallback, useRef, useState, type ReactNode } from "react";

/** 首屏铺多少条（微信差不多也是这个量级） */
const FIRST_VIEW = 60;
/** 点一次「载入更早」补多少条 */
const STEP = 40;

type Msg = { id: string };

type ScrollerLike = { readonly current: HTMLDivElement | null };

export function useMessageWindow<T extends Msg>(
  messages: readonly T[],
  conversationId: string,
  scroller: ScrollerLike,
) {
  const total = messages.length;
  const [state, setState] = useState<{ id: string; start: number }>({ id: "", start: 0 });

  /**
   * 换对话时**在渲染期**把起点定下来（React 官方允许的「按 props 调整 state」写法）。
   * 定下来之后就钉住不动：新消息是往下追加的，不该把正在看的上文挤掉。
   */
  if (state.id !== conversationId) {
    setState({ id: conversationId, start: Math.max(0, total - FIRST_VIEW) });
  }
  const pinned = state.id === conversationId ? state.start : Math.max(0, total - FIRST_VIEW);
  /** 消息被删/清空时别让起点越过末尾 */
  const start = Math.min(pinned, Math.max(0, total - 1));

  const startRef = useRef(start);
  startRef.current = start;

  const loadEarlier = useCallback(() => {
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    const next = Math.max(0, startRef.current - STEP);
    setState({ id: conversationId, start: next });
    /* 上面补进来内容会把视口往下顶：量完新高度把 scrollTop 补回去 */
    requestAnimationFrame(() => {
      const node = scroller.current;
      if (!node) return;
      node.scrollTop += node.scrollHeight - before;
    });
  }, [conversationId, scroller]);

  /**
   * 对话内搜索要跳到很老的一条时调用：先把窗口扩到那条附近再滚，
   * 不然 `document.getElementById` 根本找不到节点（它还没渲染）。
   */
  const reveal = useCallback(
    (id: string) => {
      const idx = messages.findIndex((m) => m.id === id);
      if (idx < 0 || idx >= startRef.current) return;
      setState({ id: conversationId, start: Math.max(0, idx - 5) });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById(`msg-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      });
    },
    [conversationId, messages],
  );

  const list = useCallback(
    (render: (msg: T, index: number) => ReactNode): ReactNode[] => {
      const out: ReactNode[] = [];
      if (start > 0) {
        out.push(
          <li key="__earlier" className="flex justify-center">
            <button
              type="button"
              onClick={loadEarlier}
              className="rounded-full border border-line bg-chip px-3 py-1.5 text-xs text-muted"
            >
              载入更早的消息
            </button>
          </li>,
        );
      }
      for (let i = start; i < total; i += 1) out.push(render(messages[i]!, i));
      return out;
    },
    [loadEarlier, messages, start, total],
  );

  return { list, reveal, hasEarlier: start > 0 };
}
