import { Plus } from "lucide-react";
import { FileButton } from "@/components/file-button";
import { PlayHeader } from "@/components/play-header";
import { MusicLinks } from "@/components/play/music-links";
import { usePlayer } from "@/lib/player";

const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac";

/**
 * 添加音乐：本地导入 + 外链粘贴，都收在这一页，由列表右上角的「＋」进来。
 */
export function MusicAddView() {
  const busy = usePlayer((s) => s.busy);
  const notice = usePlayer((s) => s.notice);
  const toast = usePlayer((s) => s.toast);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PlayHeader title="添加音乐" />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pt-2 pb-above-nav">
        {/* 本地文件 */}
        <div className="rounded-3xl border border-line bg-surface px-4 py-4">
          <p className="text-[13px] font-medium">导入本地文件</p>
          <p className="mt-1 text-[11px] leading-4 text-muted">
            mp3 / m4a / wav / flac 都行。文件只存在这台设备，不会上传，也不用联网。
          </p>
          <FileButton
            ariaLabel="选择音乐"
            accept={AUDIO_ACCEPT}
            multiple
            disabled={busy}
            className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-ink px-5 py-3 text-[13px] font-medium text-ink-fg"
            onPick={(files) => void usePlayer.getState().addFiles(files)}
          >
            <Plus className="size-4" />
            {busy ? "导入中…" : "选择音乐文件"}
          </FileButton>
          {toast && <p className="mt-2 text-[11px] text-ok">{toast}</p>}
          {notice && <p className="mt-2 text-[11px] leading-4 text-warn">{notice}</p>}
          <p className="mt-2 text-[11px] leading-4 text-subtle">
            导入后会自动尝试读取文件里内嵌的歌词。
          </p>
        </div>

        {/* 外链 */}
        <MusicLinks compact />
      </div>
    </div>
  );
}
