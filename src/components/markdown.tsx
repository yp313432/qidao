import type { ReactNode } from "react";
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
        <code key={`${key}-c${i}`} className="rounded-sm bg-chip px-1 py-0.5 font-mono text-[0.85em]">
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

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/```/);
  return (
    // 用 1em / 相对行高，跟着聊天页的字号设置走 ——
    // 早先这里写死 15px，所以只有用户那条气泡会变、AI 的回复不变（实测踩到）
    <div className={cn("space-y-3 text-[1em] leading-[1.75] text-fg", className)}>
      {blocks.map((block, i) => {
        if (i % 2 === 1) {
          const nl = block.indexOf("\n");
          const code = nl >= 0 ? block.slice(nl + 1) : block;
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-lg bg-chip px-3 py-2.5 font-mono text-[13px] leading-5 text-fg"
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
}
