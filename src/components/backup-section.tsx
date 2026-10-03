import { useEffect, useState } from "react";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { FileButton } from "@/components/file-button";
import {
  applyBackup,
  countData,
  currentData,
  downloadBackup,
  parseBackup,
  prettySize,
  type Counts,
  type Parsed,
} from "@/lib/backup";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/** 把计数说成一句人话。 */
function describe(c: Counts): string {
  const parts = [
    c.diary > 0 ? `${c.diary} 篇日记` : "",
    c.letters > 0 ? `${c.letters} 封信` : "",
    c.moments > 0 ? `${c.moments} 条动态` : "",
    c.todos > 0 ? `${c.todos} 件待办` : "",
    c.dates > 0 ? `${c.dates} 个日子` : "",
    c.conversations > 0 ? `${c.conversations} 段对话（${c.messages} 条）` : "",
    c.memories > 0 ? `${c.memories} 条记忆` : "",
    c.musicEmbeds > 0 ? `${c.musicEmbeds} 条外链` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "还是空的";
}

/**
 * 数据备份。
 *
 * 为什么要有：这些内容**只存在这台设备的浏览器里** ——
 * 换手机、清缓存、换网址（比如以后部署到线上），都会"看不见了"。
 * 导出一份存着，什么时候都能搬回来。
 *
 * `bare`：放进二级页时用。二级页自己已经有「数据」标题了，
 * 这里就不再顶一个同名的小标题（否则一进页面看见两个「数据」）。
 */
export function BackupSection({ bare = false }: { bare?: boolean } = {}) {
  const hydrated = useApp((s) => s.hydrated);
  const [now, setNow] = useState<Counts | null>(null);
  const [parsed, setParsed] = useState<(Parsed & { filename: string }) | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hydrated) setNow(countData(currentData()));
  }, [hydrated]);

  function doExport() {
    const r = downloadBackup();
    setFlash(
      `已导出 ${r.filename}（${prettySize(r.bytes)}${r.redacted > 0 ? `，顺手清掉了 ${r.redacted} 处密钥` : ""}）`,
    );
  }

  async function onPick(files: File[]) {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    setFlash(null);
    try {
      const text = await file.text();
      setParsed({ ...parseBackup(text), filename: file.name });
    } catch (err) {
      setParsed({ ok: false, error: `读文件失败：${(err as Error).message}`, filename: file.name });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={bare ? "px-4 pt-2" : "mt-5"}>
      {!bare && (
        <h2 className="px-1 pb-2 text-[13px] font-medium tracking-wide text-muted">数据</h2>
      )}
      <div className="aster-card rounded-[1.6rem] border border-line px-4 py-4">
        <p className="text-[13px] font-medium">备份 / 恢复</p>
        <p className="mt-1 text-[12px] leading-5 text-muted">
          现在有：{now ? describe(now) : "读取中…"}
        </p>
        <p className="mt-2 text-[11px] leading-4 text-subtle">
          这些东西<span className="text-fg">只存在这台设备的浏览器里</span> ——
          换手机、清缓存、换网址（比如以后部署上线），都会"看不见了"。
          导出一份存着，随时能搬回来。
        </p>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={doExport}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-ink py-3 text-[13px] font-medium text-ink-fg"
          >
            <Download className="size-3.5" />
            导出备份
          </button>
          <FileButton
            ariaLabel="导入备份"
            accept="application/json,.json"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-chip py-3 text-[13px] font-medium"
            onPick={onPick}
          >
            <Upload className="size-3.5" />
            {busy ? "读取中…" : "导入备份"}
          </FileButton>
        </div>

        {/* 导入前先说清楚里面是什么，别点一下就把现在的盖掉 */}
        {parsed && (
          <div
            className={cn(
              "mt-3 rounded-2xl border px-3.5 py-3",
              parsed.ok ? "border-line bg-chip" : "border-warn/40 bg-warn/10",
            )}
          >
            {parsed.ok && parsed.backup ? (
              <>
                <p className="text-[12px] font-medium">
                  这个备份里有：{parsed.counts ? describe(parsed.counts) : "（读不出内容）"}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-muted">
                  文件：<span className="font-mono">{parsed.filename}</span>
                  {parsed.backup.exportedAt
                    ? ` · 导出于 ${new Date(parsed.backup.exportedAt).toLocaleString("zh-CN")}`
                    : ""}
                  {parsed.backup.redacted ? ` · 当时清掉了 ${parsed.backup.redacted} 处密钥` : ""}
                </p>
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-warn">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  点下面那个按钮，会<span className="font-medium">
                    覆盖掉现在这台设备上的全部内容
                  </span>（不是合并）。
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => applyBackup(parsed.backup!)}
                    className="flex-1 rounded-xl bg-ink py-2.5 text-[12px] font-medium text-ink-fg"
                  >
                    确认覆盖，用这个备份
                  </button>
                  <button
                    type="button"
                    onClick={() => setParsed(null)}
                    className="rounded-xl bg-surface px-4 py-2.5 text-[12px] text-muted"
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[12px] font-medium text-warn">这个文件读不了</p>
                <p className="mt-1 text-[11px] leading-4 text-muted">{parsed.error}</p>
                <button
                  type="button"
                  onClick={() => setParsed(null)}
                  className="mt-2 rounded-xl bg-surface px-4 py-2 text-[12px] text-muted"
                >
                  知道了
                </button>
              </>
            )}
          </div>
        )}

        {flash && <p className="mt-2.5 text-[11px] leading-4 text-accent">{flash}</p>}

        <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-4 text-subtle">
          · <span className="text-fg">密钥不会进备份</span>（API key、各种 token
          会被自动清空，导入后重新填一次就行）
          <br />· <span className="text-fg">音乐文件不在备份里</span>
          （歌太大，存在浏览器另一个库里）—— 换设备后要重新导入，歌单信息会保留
        </p>
      </div>
    </section>
  );
}
