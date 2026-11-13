import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, X } from "lucide-react";
import { copyMessageText, messageCopyText, type CopyFormat } from "@/lib/message-copy";
import { isSolid, materialOf } from "@/lib/material";
import { useApp } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export type CopyMessage = { part: string; full: string };

/** Mount for each copy request so scope and format always start at this bubble / plain text. */
export function CopyMessageSheet({ message, onClose }: { message: CopyMessage; onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const liquid = materialOf(settings) === "liquid";
  const [scope, setScope] = useState<"part" | "full">("part");
  const [format, setFormat] = useState<CopyFormat>("plain");
  const [error, setError] = useState("");
  const [copying, setCopying] = useState(false);
  const content = scope === "part" ? message.part : message.full;
  const preview = useMemo(() => messageCopyText(content, format), [content, format]);
  async function copy() {
    setCopying(true);
    setError("");
    try {
      await copyMessageText(preview);
      pushToast(format === "plain" ? "已复制纯文本" : "已复制 Markdown");
      onClose();
    } catch { setError("复制失败，可长按下方预览选择文字复制，或重试。"); }
    finally { setCopying(false); }
  }
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className={cn("k-copy-scrim", liquid && "lq-dialog-scrim")} />
      <Dialog.Content data-contrast="" className={cn(
        "k-copy-sheet",
        isSolid(settings) && "paper-sheet", liquid && "lq-dialog lq-dialog--sheet",
      )}>
        <span aria-hidden="true" className="k-copy-sheet__handle" />
        <div className="flex items-center justify-between gap-3">
          <Dialog.Title className="k-copy-sheet__title">复制消息</Dialog.Title>
          <Dialog.Close aria-label="关闭复制面板" className="k-btn k-btn--icon"><X /></Dialog.Close>
        </div>
        <Dialog.Description className="k-copy-sheet__description">选择复制范围和格式，确认下方内容后复制。</Dialog.Description>
        {message.part !== message.full && <div role="group" aria-label="复制范围" className="mb-3 flex flex-wrap gap-2">
          <button type="button" aria-pressed={scope === "part"} data-active={scope === "part"} className="k-opt" onClick={() => { setScope("part"); setError(""); }}>当前气泡</button>
          <button type="button" aria-pressed={scope === "full"} data-active={scope === "full"} className="k-opt" onClick={() => { setScope("full"); setError(""); }}>整条回复</button>
        </div>}
        <div role="group" aria-label="复制格式" className="mb-3 flex flex-wrap gap-2">
          <button type="button" aria-pressed={format === "plain"} data-active={format === "plain"} className="k-opt" onClick={() => { setFormat("plain"); setError(""); }}>纯文本</button>
          <button type="button" aria-pressed={format === "markdown"} data-active={format === "markdown"} className="k-opt" onClick={() => { setFormat("markdown"); setError(""); }}>Markdown 源码</button>
        </div>
        <div tabIndex={0} role="region" aria-label="复制预览" className="k-copy-sheet__preview">{preview}</div>
        {error && <p role="alert" className="k-copy-sheet__error">{error}</p>}
        <button type="button" disabled={copying || !preview.trim()} onClick={() => void copy()} className="k-btn mt-3 shrink-0 disabled:opacity-50">
          <Copy />{copying ? "正在复制…" : format === "plain" ? "复制纯文本" : "复制 Markdown"}
        </button>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
