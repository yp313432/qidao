import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { SceneBackdrop } from "@/components/background-layer";
import { PlayHeader } from "@/components/play-header";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 「时感」嵌进来 —— 直接看那个页面，不是调用。
 *
 * 为什么能嵌：时感首页没有 `x-frame-options`、也没有 CSP 的 `frame-ancestors`，
 * 所以浏览器允许它被装进 iframe（这两条我实测过）。
 *
 * 地址留空时**自动跟着当前主机走**：你从哪台设备打开栖岛，
 * 就往那台设备的 :8081 去找时感。电脑上是 localhost:8081，
 * 手机上是局域网IP:8081 —— 不用两台设备来回改设置。
 */
export function ShiganView() {
  const settings = useApp((s) => s.settings);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<"loading" | "ok" | "stuck">("loading");
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(settings.shiganUrl);

  /**
   * 地址的默认值：
   *   · **App 里**（VITE_DIRECT_UPSTREAM=1 的那种构建）→ 用**打进本地的副本**
   *     （public/shigan/，跟 App 一起装进手机）。打开不需要网络、不需要梯子。
   *   · **网页版** → 跟着当前主机走：电脑 localhost:8081、手机局域网IP:8081。
   * 用户在设置里自己填过地址的话，永远以他填的为准。
   */
  const NATIVE = (import.meta.env?.VITE_DIRECT_UPSTREAM as string | undefined) === "1";
  // 必须是**绝对**路径：相对路径会拼在当前目录后面（在 /play/shigan 这一页
  // 会去找 /play/shigan/index.html → 404 → 白屏）。
  const auto = NATIVE
    ? "/shigan/index.html"
    : typeof window === "undefined"
      ? "http://localhost:8081/"
      : `${window.location.protocol}//${window.location.hostname}:8081/`;
  // .html 结尾的本地路径别补斜杠，否则会变成 shigan/index.html/ 打不开
  const raw = settings.shiganUrl.trim() || auto;
  const url = /\.html?$/i.test(raw) ? raw : raw.replace(/\/?$/, "/");

  /**
   * 判断"到底打开了没有"。
   *
   * 踩过两次坑，记下来：
   *
   * 1) 只用 9 秒超时会误报 —— iframe 的 `load` 要等**所有子资源**加载完，
   *    而 Vite 冷启动要跑 148 个请求，早就过 9 秒了。
   *
   * 2) 用 `contentDocument` 判断也有坑 —— iframe 一开始就是 `about:blank`，
   *    而 about:blank 是**可读**的（非 null），于是"还没开始加载"被误判成"加载失败"。
   *
   * 所以只有一条可靠规则：**`load` 事件之后**如果还是 about:blank，才算没跳过去。
   *   - load 之后读不到（null）→ 跨域成功加载 ✅
   *   - load 之后能读且是 about:blank → 没跳过去 ❌
   *   - 一直没触发 load（超过 25 秒）→ 也算失败（兜底）
   */
  const loadedRef = useRef(false);

  function probe(): "blank" | "cross" | "same" {
    const el = document.getElementById("shigan-frame") as HTMLIFrameElement | null;
    let doc: Document | null = null;
    try {
      doc = el?.contentDocument ?? null;
    } catch {
      doc = null;
    }
    if (!doc) return "cross";
    return doc.location.href === "about:blank" ? "blank" : "same";
  }

  useEffect(() => {
    setState("loading");
    setDismissed(false);
    loadedRef.current = false;
    const started = Date.now();
    const iv = window.setInterval(() => {
      const waited = Date.now() - started;
      // 只兜底"连 load 都没触发"的情况；不动已经判定好的结果
      if (!loadedRef.current && waited > 25000) {
        setState((s) => (s === "loading" ? "stuck" : s));
      }
    }, 1500);
    return () => window.clearInterval(iv);
  }, [url, reloadKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SceneBackdrop image={settings.diaryImage} />
      <PlayHeader title="时感" />

      <div className="flex items-center justify-between gap-2 px-4">
        <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-subtle">{url}</p>
        <button
          type="button"
          aria-label="重新加载"
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-chip"
        >
          <RefreshCw className={cn("size-3.5", state === "loading" && "aster-spin")} />
        </button>
        <button
          type="button"
          aria-label="换地址"
          onClick={() => {
            setDraft(settings.shiganUrl);
            setEditing((v) => !v);
          }}
          className="flex h-8 shrink-0 items-center rounded-full bg-chip px-3 text-[11px]"
        >
          换地址
        </button>
      </div>

      {editing && (
        <div className="mt-2 px-4">
          <div className="rounded-2xl border border-line bg-surface px-3.5 py-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="时感地址"
              placeholder={auto}
              className="w-full rounded-xl bg-chip px-3 py-2.5 font-mono text-[12px] outline-none placeholder:text-subtle"
            />
            <p className="mt-1.5 text-[11px] leading-4 text-subtle">
              留空就自动用 <span className="font-mono">{auto}</span>。
              部署到公网之后，把那个地址填在这里。
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  useApp.getState().patchSettings({ shiganUrl: draft.trim() });
                  setEditing(false);
                }}
                className="flex-1 rounded-xl bg-ink py-2 text-[12px] font-medium text-ink-fg"
              >
                用这个地址
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-xl bg-chip px-3.5 py-2 text-[12px]"
              >
                <ExternalLink className="size-3" />
                新窗口打开
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 min-h-0 flex-1 px-4 pb-above-nav">
        <div className="relative h-full overflow-hidden rounded-[1.6rem] border border-line bg-surface">
          {/* 时感自己的页面。不加 sandbox：它是我们自己跑的，脚本要能正常工作。 */}
          <iframe
            id="shigan-frame"
            key={`${url}-${reloadKey}`}
            src={url}
            title="时感"
            onLoad={() => {
              loadedRef.current = true;
              setState(probe() === "blank" ? "stuck" : "ok");
            }}
            className="size-full border-0 bg-white"
          />

          {/* 提示一律做成"细条"，绝不盖住画面中间 —— 想给人看的东西不能被自己的提示挡掉 */}
          {state === "loading" && (
            <p className="pointer-events-none absolute inset-x-3 top-3 rounded-full bg-black/55 px-3.5 py-2 text-center text-[11px] text-white backdrop-blur-sm">
              正在打开时感…（第一次会慢，Vite 要现编译）
            </p>
          )}

          {state === "stuck" && !dismissed && (
            <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-black/70 px-3.5 py-3 backdrop-blur-md">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-white">好像没打开</p>
                  <p className="mt-1 text-[11px] leading-4 text-white/80">
                    iframe 不会告诉我原因（跨域），常见三种：时感没在跑 / 地址不对 /
                    手机上打开时时感得跑在同一台电脑上。
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="知道了"
                  onClick={() => setDismissed(true)}
                  className="shrink-0 rounded-full bg-white/20 px-3 py-1.5 text-[11px] text-white"
                >
                  知道了
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
