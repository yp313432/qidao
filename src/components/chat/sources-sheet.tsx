import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { WebSourceList } from "@/components/chat/web-source-list";
import type { WebSource } from "@/lib/web-sources";
import { isSolid, materialOf } from "@/lib/material";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

export function SourcesSheet({ sources, focusedUrl, onClose }: { sources: WebSource[]; focusedUrl?: string; onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const focusedRef = useRef<HTMLAnchorElement>(null);
  const liquid = materialOf(settings) === "liquid";
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className={cn("k-source-scrim", liquid && "lq-dialog-scrim")} />
      <Dialog.Content data-contrast="" className={cn("k-source-sheet", isSolid(settings) && "paper-sheet", liquid && "lq-dialog lq-dialog--sheet")}
        onOpenAutoFocus={(event) => {
          if (!focusedRef.current) return;
          event.preventDefault(); focusedRef.current.focus({ preventScroll: true });
          focusedRef.current.scrollIntoView({ block: "nearest" });
        }}>
        <span aria-hidden="true" className="k-copy-sheet__handle" />
        <div className="flex items-center justify-between gap-3">
          <Dialog.Title className="k-copy-sheet__title">来源 · {sources.length}</Dialog.Title>
          <Dialog.Close aria-label="关闭来源面板" className="k-btn k-btn--icon"><X /></Dialog.Close>
        </div>
        <Dialog.Description className="k-copy-sheet__description">查看这条回复找到的资料。点击来源标题，在浏览器中打开原网页。</Dialog.Description>
        <div className="k-source-sheet__scroll">
          <WebSourceList sources={sources} maxVisible={8} focusedUrl={focusedUrl} focusedRef={focusedRef} />
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
