import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { clearCrumbs, crumbsReport, flushCrumbs, stampOf, type RunReport } from "@/lib/breadcrumbs";
import { collectEnv, summarize, type EnvItem } from "@/lib/env-check";
import { openSenseSettings } from "@/lib/sense-bridge";
import { probeLocation, type ProbeStep } from "@/lib/locate-probe";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { cn } from "@/lib/utils";

const DOT: Record<EnvItem["status"], string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  no: "bg-fg/25",
};

const WORD: Record<EnvItem["status"], string> = {
  ok: "可用",
  warn: "受限",
  no: "不可用",
};

/**
 * 环境自检页。
 *
 * 存在的意义：麦克风、通知、摄像头这类东西「能不能用」取决于**地址与外壳**，
 * 不取决于代码。手机上打不开麦克风时，先来这页看是哪一条卡住了。
 */
export function EnvView() {
  useActivity("在看环境自检");
  const scrollRef = useScrollMemory("env");
  const [items, setItems] = useState<EnvItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * 定位自检的结果（点按钮才跑）。
   * 为什么不做成"进页面就自动跑"：那一步会真去定位一次 + 同时问三家 IP，
   * 最坏要等十几二十秒 —— 打开一页诊断就要盯着转圈，不值当。
   */
  const [probe, setProbe] = useState<{ steps: ProbeStep[]; verdict: string } | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  /**
   * **上次运行痕迹**（崩溃面包屑，见 `lib/breadcrumbs.ts`）。
   * ⚠️ 只在 `useEffect` 里读 —— 那是 localStorage，首帧读会造成 hydration 不一致
   * （仓库里那条纪律：首帧别读 localStorage / Date.now / 随机数）。
   */
  const [run, setRun] = useState<RunReport | null>(null);
  const reloadRun = () => {
    flushCrumbs();
    setRun(crumbsReport(20));
  };

  async function runLocateProbe() {
    setProbeBusy(true);
    try {
      setProbe(await probeLocation());
    } finally {
      setProbeBusy(false);
    }
  }

  async function load() {
    setBusy(true);
    try {
      setItems(await collectEnv());
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    /**
     * ⚠️ **等一个节拍再读**：面包屑的"这次是不是异常退出"是外壳挂载时才判定并落下来的，
     * 而 React 里**子组件的 effect 先于父组件**跑 —— 这一页直接读会读到上一场的旧结论。
     * 放到 `setTimeout(0)` 就落在所有挂载 effect 之后了。
     */
    const t = window.setTimeout(reloadRun, 0);
    return () => window.clearTimeout(t);
  }, []);

  const sum = items ? summarize(items) : null;

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader
        title="环境自检"
        right={
          <button
            type="button"
            aria-label="重新检测"
            onClick={() => void load()}
            className="flex size-10 items-center justify-center text-muted"
          >
            <RefreshCw className={cn("size-4", busy && "animate-spin")} />
          </button>
        }
      />

      <section className="mt-2 px-4">
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          {!sum ? (
            <p className="text-[12px] text-subtle">检测中…</p>
          ) : (
            <>
              <p className="text-[15px] font-medium">
                可用 {sum.ok} · 受限 {sum.warn} · 不可用 {sum.no}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                同一份代码在不同地址、不同外壳里结论完全不同 —— 这页报的是**此刻这台设备**的真实情况。
              </p>
            </>
          )}
        </div>
      </section>

      <section className="mt-4 px-4">
        <div className="divide-y divide-line rounded-3xl border border-line bg-surface px-4">
          {(items ?? []).map((it) => (
            <div key={it.id} className="py-3">
              <div className="flex items-start gap-2.5">
                <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[it.status])} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[13px] font-medium">{it.label}</p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                        it.status === "ok"
                          ? "bg-ok/15 text-ok"
                          : it.status === "warn"
                            ? "bg-warn/15 text-warn"
                            : "bg-fg/8 text-muted",
                      )}
                    >
                      {WORD[it.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted">{it.detail}</p>
                  {it.fix && (
                    <p className="mt-1.5 rounded-xl bg-fg/8 px-2.5 py-1.5 text-[11px] leading-4 text-fg">
                      怎么办：{it.fix}
                    </p>
                  )}
                  {it.action && (
                    <button
                      type="button"
                      disabled={it.action.kind === "locateProbe" && probeBusy}
                      onClick={() => {
                        if (it.action!.kind === "locateProbe") void runLocateProbe();
                        else void openSenseSettings(it.action!.kind);
                      }}
                      className="mt-1.5 rounded-full bg-chip px-3 py-1.5 text-[11px] font-medium text-fg disabled:opacity-50"
                    >
                      {it.action.kind === "locateProbe" && probeBusy ? "正在跑…" : it.action.label}
                    </button>
                  )}
                  {it.action?.kind === "locateProbe" && probe && (
                    <div className="mt-2 rounded-xl bg-fg/8 px-2.5 py-2">
                      {probe.steps.map((st) => (
                        <p key={st.name} className="mt-1 text-[11px] leading-4 first:mt-0">
                          <span className={st.ok ? "text-ok" : "text-warn"}>
                            {st.ok ? "✅ " : "⚠️ "}
                            {st.name}
                          </span>
                          {st.ms > 0 && <span className="text-subtle"> · {st.ms}ms</span>}
                          <br />
                          <span className="text-muted">{st.detail}</span>
                        </p>
                      ))}
                      <p className="mt-2 border-t border-line pt-1.5 text-[11px] leading-4 text-fg">
                        结论：{probe.verdict}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          **上次运行痕迹**（崩溃面包屑，2026-10 新增）

          用户报的："全都卡住，有思考内容，然后闪退" / "我装的就是最新的，
          问题就是他卡退了，我不知道问题出在哪，你找找看"。

          手机侧的崩（WebView 渲染进程被杀 / 主线程卡太久被判无响应）在电脑上
          复现不出来，所以要**让 App 自己把现场留下来**：心跳（堆内存、节点数、在干什么）、
          主线程堵超过 0.5 秒、报错、聊天每一步。重启后这一块就是"崩之前最后一段时间"。
          ⚠️ 只记"在干什么 + 数字"，不记聊天内容、不记密钥（见 breadcrumbs.ts 的纪律）。
         ───────────────────────────────────────────────────────────── */}
      <section className="mt-4 px-4">
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium">上次运行痕迹</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={reloadRun}
                className="rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted active:bg-surface"
              >
                刷新
              </button>
              <button
                type="button"
                onClick={() => {
                  clearCrumbs();
                  reloadRun();
                }}
                className="rounded-full bg-chip px-2.5 py-1 text-[11px] text-muted active:bg-surface"
              >
                清空
              </button>
            </div>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted">
            这页记的是<b>崩之前最后一段时间</b>在干什么（每 15 秒一行心跳、主线程堵超过 0.5
            秒记一行、报错和聊天每一步也记）。要是又卡退，回来把这这一块**截图**就能定位。
          </p>
          {!run ? (
            <p className="mt-2 text-[11px] text-subtle">读取中…</p>
          ) : (
            <>
              <p
                className={cn(
                  "mt-2 rounded-xl px-2.5 py-1.5 text-[11px]",
                  run.dirty ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok",
                )}
              >
                {run.dirty
                  ? "上次是**异常退出**（没走到正常收尾）—— 下面是当时的现场（新→旧）"
                  : "上次是正常退出。下面是这次运行的现场（新→旧）"}
              </p>
              {run.count === 0 ? (
                <p className="mt-2 text-[11px] text-subtle">（还没有记录）</p>
              ) : (
                <div className="mt-2 space-y-0.5 font-mono text-[10.5px] leading-4">
                  {run.crumbs.map((c, i) => (
                    <p key={`${c.t}-${i}`} className="flex gap-2">
                      <span className="shrink-0 text-subtle">
                        {stampOf(c.t, run.crumbs[run.crumbs.length - 1]?.t ?? c.t)}
                      </span>
                      <span className="w-[52px] shrink-0 text-fg">{c.kind}</span>
                      <span className="min-w-0 break-all text-muted">{c.text}</span>
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="mt-4 px-4">
        <div className="rounded-3xl border border-line bg-surface px-4 py-3.5">
          <p className="text-[13px] font-medium">封装成 APP 之后会怎样</p>
          <ul className="mt-2 space-y-2 text-[11px] leading-4 text-muted">
            <li>
              <span className="text-fg">会好的</span>：麦克风、摄像头、通知、Service Worker
              —— 前提是外壳把页面放在**安全地址**上（例如 Capacitor 的{" "}
              <span className="font-mono">https://localhost</span>，或原生层用
              WebViewAssetLoader 提供 https 源）。
            </li>
            <li>
              <span className="text-warn">不会好的</span>：如果只是套一个 WebView 直接打开
              <span className="font-mono"> http://192.168.x.x:8080</span>，WebView 跟浏览器守同一条规则，
              麦克风照样被拦。
            </li>
            <li>
              <span className="text-fg">另一条路</span>：原生层自己录音（Android
              MediaRecorder），通过 JS 桥把文件交给网页 —— 完全绕开浏览器限制，但要写原生代码。
            </li>
          </ul>
        </div>
      </section>

      <div className="h-6" />
    </div>
  );
}
