import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function inline(text: string, key: string) {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(
        <strong key={`${key}-b${i}`} className="font-medium">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <code key={`${key}-c${i}`} className="rounded-xl bg-chip-flat px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + token.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * ⚠️ **必须 memo**（2026-10，用户真机"卡死闪退"的第二号元凶）。
 *
 * 聊天页的消息列表是**整个列表一起重渲染**的，而流式回复时会不停刷新
 * （改完节流后每秒 4 次）—— 列表里有几十条他的回复，每条都挂一个 `<Markdown>`。
 * 不 memo 的话，**每刷新一次就把所有回复重新解析一遍**（正则 + 切块 + 建元素），
 * 60 条消息 × 4 次/秒 = 每秒几百次解析 —— 主线程就是这么被占满的。
 *
 * `memo` 之后只有**内容真的变了的那一条**（正在流式输出的那条）才会重新解析。
 */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/```/);
  return (
    // 用 1em / 相对行高，跟着聊天页的字号设置走 ——
    // 早先这里写死 15px，所以只有用户那条气泡会变、AI 的回复不变（实测踩到）
    <div
      className={cn(
        // `[overflow-wrap:anywhere]`：长 URL / 超长英文单词 / base64 串也得在气泡里断行，
        // 否则会整段顶出屏幕（用户 m04097："动手这个字体超出屏幕外了，看看还有哪里会出现这种情况"）
        "space-y-3 text-[1em] leading-[1.75] [overflow-wrap:anywhere] text-fg",
        className,
      )}
    >
      {blocks.map((block, i) => {
        if (i % 2 === 1) {
          const nl = block.indexOf("\n");
          const code = nl >= 0 ? block.slice(nl + 1) : block;
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-2xl bg-chip px-3 py-2.5 font-mono text-[13px] leading-5 text-fg"
            >
              <code>{code.replace(/\n$/, "")}</code>
            </pre>
          );
        }
        return block.split(/\n\n+/).map((para, j) => {
          const lines = para.split("\n");
          const list = lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l));
          if (list) {
            return (
              <ul key={`${i}-${j}`} className="space-y-1 pl-5">
                {lines.map((l, k) => (
                  <li key={k} className="list-disc">
                    {inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""), `${i}-${j}-${k}`)}
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <p key={`${i}-${j}`}>
              {lines.map((l, k) => (
                <span key={k}>
                  {k > 0 && <br />}
                  {inline(l, `${i}-${j}-${k}`)}
                </span>
              ))}
            </p>
          );
        });
      })}
    </div>
  );
});
