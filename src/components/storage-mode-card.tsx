import { useEffect, useState } from "react";
import {
  disableV2,
  enableV2,
  previewMigration,
  readMigratedNote,
  storageMode,
  type MigratedNote,
  type StorageMode,
} from "@/lib/data/switch";
import { cn } from "@/lib/utils";

/**
 * **存储方式**（PH3，实验开关）—— 「我的 → 数据」里那张卡。
 *
 * 用户原话（2026-10）："我们不能哪里出问题再补哪一块了，拆东补西，
 * 而是把整体搭建好了，变得统一有条理。"
 *
 * 这张卡干三件事，都按 §12 的纪律来：
 *   ① 让你看得见**现在用的是哪套**（老：一条大记录 / 新：一个库多张表）
 *   ② 切之前**告诉你要搬多少**（先试算，不偷偷搬）
 *   ③ 随时**切回去**；**两边的东西都不删**（老档保留、新库保留）
 */
export function StorageModeCard() {
  const [mode, setMode] = useState<StorageMode>("legacy");
  const [note, setNote] = useState<MigratedNote | null>(null);
  const [preview, setPreview] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  /** 两段式确认：先记下要点哪一项，再点一次才真的恢复 */
  const [armed, setArmed] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  /** 存储自检结果（两份各有多少东西）——见 lib/data/selfcheck.ts */
  const [check, setCheck] = useState<Awaited<ReturnType<typeof import("@/lib/data/selfcheck").storageSelfCheck>> | null>(null);
  /** 滚动快照列表（可点"恢复这份"） */
  const [snaps, setSnaps] = useState<{ key: string; at: number; bytes: number }[]>([]);

  useEffect(() => {
    setMode(storageMode());
    setNote(readMigratedNote());
    void previewMigration().then(setPreview);
    void import("@/lib/data/selfcheck").then((m) => m.storageSelfCheck()).then(setCheck);
    void import("@/lib/data/safety").then((m) => m.listSnapshots()).then(setSnaps);
  }, []);

  const total = preview ? Object.values(preview).reduce((n, v) => n + v, 0) : 0;

  /**
   * **恢复**（用户点的，不自动）：
   *   · `mirror` —— 只用安全带里的设置（对话等其它数据不动，最保守）
   *   · `snapshot` —— 整份回到某个快照（恢复前会自动把现状再留一份）
   */
  async function restore(kind: "mirror" | "snapshot", key?: string) {
    /**
     * 确认改成**按钮两段式**（用户 m10539："安卓底层的弹窗没做适配"）：
     * `window.confirm()` 在 WebView 里是安卓原生对话框，跟 App 的玻璃感不搭。
     * 现在是"点一次变成『确定要恢复？』，再点一次才执行，5 秒没点自动取消"——
     * 目的不变（恢复不可逆，必须多一次动作），只是不再弹系统框。
     */
    const target = key ?? kind;
    if (armed !== target) return;
    setBusy(true);
    setMsg("");
    try {
      const m = await import("@/lib/data/safety");
      const r = kind === "mirror" ? await m.restoreSettingsMirror() : await m.restoreFromSnapshot(key ?? "");
      if (!r.ok) {
        setMsg(`恢复失败：${r.why ?? "未知原因"}（你现在的数据没动）`);
        setBusy(false);
        return;
      }
      setMsg("恢复好了，正在重载…");
      window.setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setMsg(`恢复出错：${String((e as Error)?.message ?? e)}`);
      setBusy(false);
    }
  }
  async function switchTo(mode: "v2" | "legacy") {
    setBusy(true);
    setMsg("");
    try {
      if (mode === "legacy") {
        disableV2();
        setMsg("已切回老存储，正在重载…");
      } else {
        const r = await enableV2();
        if (!r.ok) {
          setMsg(`没切成：${r.why ?? "搬家没通过校验"}（老存储照旧在用，什么都没动）`);
          setBusy(false);
          return;
        }
        setMsg(`搬好了：${r.why ?? "已把老档搬进新库并校验通过"}，正在重载…`);
      }
      window.setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setMsg(`出错：${String((e as Error)?.message ?? e)}`);
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 px-4">
      <h2 className="mb-2 px-1 text-[12px] tracking-wide text-muted">存储方式（实验）</h2>
      <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
        <div className="flex items-baseline justify-between">
          <p className="text-[15px] font-medium">
            {mode === "v2" ? "新存储 · 一个库多张表" : "老存储 · 一条大记录"}
          </p>
          <span className={cn("text-[11px]", mode === "v2" ? "text-accent" : "text-muted")}>
            {mode === "v2" ? "正在用" : "正在用（默认）"}
          </span>
        </div>

        <ul className="mt-2.5 space-y-1.5 text-[11px] leading-4 text-muted">
          {mode === "v2" ? (
            <>
              <li>· 改一条消息**只写一条**（不再把整块几 MB 重写一遍）</li>
              <li>· 图片/表情按字节存（不再是文本长串）</li>
              <li>· 设置单独一条 —— 不会再跟着对话一起没</li>
              <li className="text-subtle">· 老档**原样保留**，切回去随时可以</li>
            </>
          ) : (
            <>
              <li>· 老存储就是现在这样：27 类数据挤在**一条记录**里</li>
              <li>· 新存储要先把老档**照搬**过去（先试算、不偷偷搬、校验通过才切）</li>
              <li className="text-subtle">· 两边都**不会删**：老档留着，新库也留着</li>
            </>
          )}
        </ul>

        {mode === "legacy" && preview && (
          <p className="mt-2.5 text-[11px] leading-4 text-muted">
            将搬：{Object.entries(preview)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${k} ${v}`)
              .join(" · ") || "（老档是空的，没什么可搬）"}
            {total > 0 && <span className="text-subtle"> · 共 {total} 条</span>}
          </p>
        )}

        {note && (
          <p className={cn("mt-2.5 text-[11px] leading-4", note.ok ? "text-subtle" : "text-warn")}>
            上次搬家：{new Date(note.at).toLocaleString()}
            {note.ok
              ? ` · 通过${note.moved ? `（${Object.entries(note.moved).map(([k, v]) => `${k} ${v}`).join(" · ")}）` : ""}`
              : ` · 没通过：${note.why ?? ""}`}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          {mode === "v2" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void switchTo("legacy")}
              className="rounded-full border border-line px-3.5 py-1.5 text-[12px] disabled:opacity-50"
            >
              切回老存储
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void switchTo("v2")}
              className="rounded-full border border-accent/50 bg-accent/10 px-3.5 py-1.5 text-[12px] text-accent disabled:opacity-50"
            >
              {busy ? "正在搬…" : "切到新存储（先搬老档）"}
            </button>
          )}
        </div>

        {/*
          **存储自检**（2026-10）：把两套存储的真实状态摆出来。
          起因：用户真机上"打开就变初始页"时，界面上看不出是哪一份空了/读失败了，
          只能靠点一点试 —— 这张表让下一次一眼定位（也让我排障不用猜）。
        */}
        <details className="mt-3 rounded-2xl border border-line bg-chip/40 px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-muted">存储自检（两份各有多少东西）</summary>
          {check ? (
            <ul className="mt-2 space-y-1 text-[11px] leading-4 text-muted">
              <li>
                · {check.legacy.name}：<span className={check.legacy.empty ? "text-warn" : "text-fg"}>{check.legacy.detail}</span>
              </li>
              <li>
                · {check.modern.name}：<span className={check.modern.empty ? "text-warn" : "text-fg"}>{check.modern.detail}</span>
              </li>
              <li>
                · 上次写入：{check.lastWriteAt ? new Date(check.lastWriteAt).toLocaleString() : "（没记）"}
              </li>
              <li>
                · 安全带：{check.mirror.has ? `有设置镜子（${check.mirror.bytes} 字节）` : "还没抄到"}
                {check.snapshots.length > 0 ? ` · 快照 ${check.snapshots.length} 份` : ""}
              </li>
              {check.readFailed && <li className="text-warn">· 这次启动读过失败：{check.lastFailure || "（原因没记）"}</li>}
              <li className="pt-0.5">{check.verdict}</li>
              {/* 恢复入口：只用镜子救设置（最保守），或者整份回到某个快照 */}
              <li className="pt-1.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !check.mirror.has}
                  onClick={() => {
                    if (armed !== "mirror") {
                      setArmed("mirror");
                      window.setTimeout(() => setArmed(null), 5000);
                      return;
                    }
                    setArmed(null);
                    void restore("mirror");
                  }}
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] disabled:opacity-40"
                >
                  {armed === "mirror" ? "确定用安全带里的设置恢复？" : "只用安全带里的设置恢复"}
                </button>
                {snaps.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (armed !== s.key) {
                        setArmed(s.key);
                        window.setTimeout(() => setArmed(null), 5000);
                        return;
                      }
                      setArmed(null);
                      void restore("snapshot", s.key);
                    }}
                    className="rounded-full border border-line px-2.5 py-1 text-[11px] disabled:opacity-40"
                  >
                    {armed === s.key
                      ? "确定回到这版？"
                      : `回到快照 ${new Date(s.at).toLocaleString().slice(5, -3)}`}
                  </button>
                ))}
              </li>
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-subtle">体检中…</p>
          )}
        </details>

        {msg && <p className="mt-2.5 text-[11px] leading-4 text-muted">{msg}</p>}
        <p className="mt-2 text-[11px] leading-4 text-subtle">
          切换会重载一次页面。搬完会**逐类校验**（条数 + 内容校验和），对不上就不切。
        </p>
      </div>
    </section>
  );
}
