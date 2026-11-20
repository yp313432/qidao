/**
 * 气泡旁边/下面的引用小条（灰底 + 左侧一道竖线，跟微信那套一致）。
 *
 * 从 `chat-view.tsx` 里挪出来（2026-11-18）：原来只有用户那条能引用，
 * 现在 AI 也能引用她说过的原话 —— 两处必须长得一模一样，所以抽成共用组件。
 * 样式原样搬过来，没改一个类（用户 m01498 第 1 条定的样子）。
 */
export function QuoteBar({ text }: { text: string }) {
  return (
    <p className="mt-1 max-w-[85%] truncate rounded-lg border-l-2 border-line bg-chip/80 px-2.5 py-1.5 text-[11px] text-muted">
      {text}
    </p>
  );
}
