import { useEffect, useState } from "react";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { FileButton } from "@/components/shared/file-button";
import { KButton } from "@/components/ui-kit";
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
 * 2026-11-07 用户 m03368 说「备份的那个卡片还没换，没同步，还是圆形的」——
 * 原来这里是 `aster-card rounded-3xl` + 一堆 `rounded-2xl bg-ink/bg-chip` 的自己画法，
 * 跟别处的纸卡不是一套。现在整块换成标准件：一张 `.k-card k-sub`、
 * 内嵌那块提示用 `.k-inset`、按钮用 `KButton`。形状交给 kit，这里只管摆。
 *
 * `bare`：放进二级页时用（旧 `/data` 页会自己顶一个「数据」标题），只差一点外边距。
 */
export function BackupSection({ bare = false }: { bare?: boolean } = {}) {
  const hydrated = useApp((s) => s.hydrated);
  const [now, setNow] = useState<Counts | null>(null);
  const [parsed, setParsed] = useState<(Parsed & { filename: string }) | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    /**
     * ⚠️ `currentData()` 现在是**异步**的（2026-10）：它要去读真源
     * （新库 / 老 IndexedDB），不再读那份早就被删掉的 localStorage 副本。
     */
    if (!hydrated) return;
    let alive = true;
    void currentData().then((d) => {
      if (alive) setNow(countData(d));
    });
    return () => {
      alive = false;
    };
  }, [hydrated]);

  async function doExport() {
    const r = await downloadBackup();
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
    <section className={cn("k-card k-sub", !bare && "mt-5")}>
      <div className="k-sect">
        <h2 className="k-sect__title">备份与恢复</h2>
      </div>

      <div className="flex flex-col gap-3">
        <p className="k-row__title">现在有：{now ? describe(now) : "读取中…"}</p>
        <p className="k-hint">
          这些东西只存在这台设备的浏览器里 —— 换手机、清缓存、换网址（比如以后部署上线），
          都会「看不见了」。导出一份存着，随时能搬回来。
        </p>

        <div className="k-hstack">
          <KButton variant="primary" className="k-grow" onClick={() => void doExport()}>
            <Download aria-hidden="true" />
            导出备份
          </KButton>
          <FileButton
            ariaLabel="导入备份"
            accept="application/json,.json"
            className="k-btn k-grow"
            onPick={onPick}
          >
            <Upload aria-hidden="true" />
            {busy ? "读取中…" : "导入备份"}
          </FileButton>
        </div>

        {/* 导入前先说清楚里面是什么，别点一下就把现在的盖掉 */}
        {parsed && (
          <div className="k-inset" data-tone={parsed.ok ? undefined : "warn"}>
            {parsed.ok && parsed.backup ? (
              <>
                <p className="k-row__title">
                  这个备份里有：{parsed.counts ? describe(parsed.counts) : "（读不出内容）"}
                </p>
                <p className="k-row__meta">
                  文件：<span className="font-mono">{parsed.filename}</span>
                  {parsed.backup.exportedAt
                    ? ` · 导出于 ${new Date(parsed.backup.exportedAt).toLocaleString("zh-CN")}`
                    : ""}
                  {parsed.backup.redacted ? ` · 当时清掉了 ${parsed.backup.redacted} 处密钥` : ""}
                </p>
                <p className="k-row__meta flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  <span>
                    点下面那个按钮，会
                    <span className="font-medium">覆盖掉现在这台设备上的全部内容</span>
                    （不是合并）。
                  </span>
                </p>
                <div className="k-hstack">
                  <KButton
                    variant="primary"
                    className="k-grow"
                    onClick={() => {
                      /**
                       * ⚠️ 恢复现在是异步的（写真源 + 先留证）。**失败必须说出来** ——
                       * 以前失败是静默的（写进一个读不到的地方，用户以为恢复了）。
                       */
                      setBusy(true);
                      void applyBackup(parsed.backup!).then((r) => {
                        if (!r.ok) {
                          setFlash(`恢复失败：${r.why ?? "未知原因"}（你现在的数据没动）`);
                          setBusy(false);
                        }
                      });
                    }}
                  >
                    确认覆盖，用这个备份
                  </KButton>
                  <KButton onClick={() => setParsed(null)}>取消</KButton>
                </div>
              </>
            ) : (
              <>
                <p className="k-row__title">这个文件读不了</p>
                <p className="k-row__meta">{parsed.error}</p>
                <KButton className="k-btn--block" onClick={() => setParsed(null)}>
                  知道了
                </KButton>
              </>
            )}
          </div>
        )}

        {flash && <p className="k-hint">{flash}</p>}

        <p className="k-hint">
          · 密钥不会进备份（API key、各种 token 会被自动清空，导入后重新填一次就行）
          <br />· 音乐文件不在备份里（歌太大，存在浏览器另一个库里）—— 换设备后要重新导入，
          歌单信息会保留
        </p>
      </div>
    </section>
  );
}
