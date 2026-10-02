import { useState } from "react";
import { Bookmark, Check, Copy, RotateCw, Share2, ThumbsDown, ThumbsUp, Volume2 } from "lucide-react";
import { speakText } from "@/lib/tts";
import { cn } from "@/lib/utils";

type Props = {
  content: string;
  feedback?: "up" | "down";
  onFeedback: (fb: "up" | "down") => void;
  onRegenerate: () => void;
  onSaveDoc?: () => void;
  saved?: boolean;
  busy?: boolean;
};

/** AI 回复下方的操作栏：复制 / 赞 / 踩 / 朗读 / 分享 / 存文档 / 重新生成。 */
export function MessageActions({
  content,
  feedback,
  onFeedback,
  onRegenerate,
  onSaveDoc,
  saved,
  busy,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* 忽略：无剪贴板权限 */
    }
  }

  async function speakTextOut() {
    // 走 lib/tts（统一处理语音包未就绪、cancel 抢跑、卡在 paused）
    speakText(content.slice(0, 400), { lang: "zh-CN", rate: 1.02 });
  }

  async function share() {
    try {
      const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
      if (typeof nav.share === "function") await nav.share({ text: content });
      else await copy();
    } catch {
      /* 用户取消分享 */
    }
  }

  return (
    <div className="mt-2.5 flex items-center gap-0.5 text-muted">
      <IconBtn label={copied ? "已复制" : "复制"} onClick={() => void copy()}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </IconBtn>
      <IconBtn label="有帮助" active={feedback === "up"} onClick={() => onFeedback("up")}>
        <ThumbsUp className="size-4" />
      </IconBtn>
      <IconBtn label="没帮助" active={feedback === "down"} onClick={() => onFeedback("down")}>
        <ThumbsDown className="size-4" />
      </IconBtn>
      <IconBtn label="朗读" onClick={() => void speakTextOut()}>
        <Volume2 className="size-4" />
      </IconBtn>
      <IconBtn label="分享" onClick={() => void share()}>
        <Share2 className="size-4" />
      </IconBtn>
      {onSaveDoc && (
        <IconBtn label={saved ? "已保存为文档" : "保存为文档"} active={saved} onClick={onSaveDoc}>
          <Bookmark className="size-4" />
        </IconBtn>
      )}
      {!busy && (
        <IconBtn label="重新生成" onClick={onRegenerate} className="ml-auto">
          <RotateCw className="size-4" />
        </IconBtn>
      )}
    </div>
  );
}

function IconBtn({
  label,
  active,
  onClick,
  children,
  className,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-full transition-colors",
        active ? "bg-chip text-fg" : "text-muted hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}
