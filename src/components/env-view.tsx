import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { collectEnv, summarize, type EnvItem } from "@/lib/env-check";
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
  }, []);

  const sum = items ? summarize(items) : null;

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <header className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1">
        <Link to="/me" aria-label="返回我的" className="flex size-11 items-center justify-center">
          <ChevronLeft className="size-6" strokeWidth={1.6} />
        </Link>
        <h1 className="flex-1 font-serif text-lg font-medium">环境自检</h1>
        <button
          type="button"
          aria-label="重新检测"
          onClick={() => void load()}
          className="flex size-10 items-center justify-center text-muted"
        >
          <RefreshCw className={cn("size-4", busy && "animate-spin")} />
        </button>
      </header>

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
                </div>
              </div>
            </div>
          ))}
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
