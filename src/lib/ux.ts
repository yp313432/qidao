import { useEffect, useRef, type RefObject } from "react";

/**
 * 点空白处关闭。
 *
 * 用 pointerdown/touchstart 而不是 click —— 手机上手指按下就该收起，
 * 不用等抬手。点在容器内部（含它里面的弹层）不关。
 */
export function useDismissOutside(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      const el = ref.current;
      if (!el) return;
      const target = e.target;
      if (target instanceof Node && el.contains(target)) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [ref, onDismiss, active]);
}

/** 每个页面记住的滚动位置。 */
const positions = new Map<string, number>();

/**
 * 记住一小段界面状态（比如"工具页当前在哪个标签"）。
 *
 * 为什么需要：工具页的三个编辑器现在是**独立页面**（点新建会跳走）。
 * 回来的时候组件重新挂载，`useState` 默认为第一项 —— 用户在 MCP 标签上
 * 点了新建，回来却落在 HTTP 标签上，看着像"我刚才是不是点错了"。
 *
 * 用 **sessionStorage** 而不是模块级变量，是因为有一种情况会**整页重新加载**：
 * OAuth 授权要把浏览器跳到授权服务器再跳回来（`/oauth/callback`），
 * 那时候内存里什么都不剩 —— 用模块变量的话，用户授权完回来会落在 HTTP 标签上，
 * 而不是他刚才在配的那个 MCP 服务器上。
 * sessionStorage 只在**这个标签页**里有效、刷新不丢、关掉就清 —— 语义正合适。
 */
const UI_STATE_PREFIX = "qidao:ui:";

export function rememberUiState(key: string, value: string) {
  try {
    sessionStorage.setItem(`${UI_STATE_PREFIX}${key}`, value);
  } catch {
    /* 隐私模式下可能不可写，记不住就算了，不影响功能 */
  }
}

export function recallUiState(key: string): string | undefined {
  try {
    return sessionStorage.getItem(`${UI_STATE_PREFIX}${key}`) ?? undefined;
  } catch {
    return undefined;
  }
}

/** 对话正文字号的四档（用户要"能调，看着大气一点"）。 */
export const CHAT_FONT_SIZES = [
  { id: "small", label: "小", px: 13 },
  { id: "normal", label: "标准", px: 15 },
  { id: "large", label: "大", px: 17 },
  { id: "xlarge", label: "特大", px: 19 },
] as const;

export function chatFontPx(id: string | undefined): number {
  return CHAT_FONT_SIZES.find((s) => s.id === id)?.px ?? 15;
}

/**
 * 记住滚动位置。
 *
 * 注意：这个 App 里页面根部虽然写着 `overflow-y-auto`，**实际滚动的是窗口**
 * （容器会被内容撑高，scrollHeight === clientHeight）。所以这里两条都挂、
 * 两条都恢复 —— 谁在滚就记谁，将来布局改成内部滚动也不用再改。
 */
export function useScrollMemory(key: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const doc = typeof document === "undefined" ? null : document.scrollingElement;

    const read = () => {
      if (el && el.scrollHeight > el.clientHeight + 4) return el.scrollTop;
      return doc ? doc.scrollTop : 0;
    };
    const apply = (v: number) => {
      if (el && el.scrollHeight > el.clientHeight + 4) el.scrollTop = v;
      if (doc) doc.scrollTop = v;
    };

    const saved = positions.get(key) ?? 0;
    let retry = 0;
    if (saved > 0) {
      apply(saved);
      // 内容（尤其是异步取回来的）晚一步撑开高度时再补一次
      retry = window.setTimeout(() => {
        if (read() < 4) apply(saved);
      }, 220);
    }

    let frame = 0;
    /** 最近一次真实读到的位置。 */
    let last = 0;
    const onScroll = () => {
      last = read();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => positions.set(key, last));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    el?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      el?.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      window.clearTimeout(retry);

      /**
       * 卸载时**不要**直接 `positions.set(key, read())`。
       *
       * React 卸载一个页面时是**先摘掉 DOM、再跑 effect 清理**，
       * 所以这一刻读到的 scrollTop 是假的 0 —— 用它覆盖，就等于把
       * 用户刚才滚到的位置抹掉，返回时自然"跳回最上面"。
       * （实测：滚到 900px → 进第二层 → 返回 → 0px。）
       *
       * 以 onScroll 记下的真实值为准；一次都没滚过才写 0。
       */
      if (last > 0) positions.set(key, last);
      else if (!positions.has(key)) positions.set(key, 0);
    };
  }, [key]);

  return ref;
}
