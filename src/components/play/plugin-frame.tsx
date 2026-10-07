"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

/**
 * **iframe 型插件的统一外壳** —— 时感用它，用户以后自己加的插件也用它（一份代码）。
 *
 * 从 `shigan-view.tsx` 抽出来的原因：用户要把插件做成"一个区"，
 * 那"整页铺满 + 返回钮 + 打不开时说明原因"这套就**不能只有时感一份**。
 *
 * ── 三个实测出来的判断规矩（别改，都是踩过的）────────────────────
 *
 * 1) **判断"到底打开了没有"只能靠 `load` 之后是不是 about:blank**：
 *    · iframe 一开始就是 `about:blank`，而它是**可读**的（非 null）
 *      → 拿 `contentDocument == null` 判断会把"还没开始加载"误判成"加载失败"
 *    · `load` 之后读不到（null）= 跨域成功加载 ✅
 *    · `load` 之后能读且是 about:blank = 没跳过去 ❌
 *    · 一直没触发 `load`（超过 25 秒）= 也算失败（兜底）
 *    ⚠️ 别用 9 秒超时：`load` 要等**所有子资源**，Vite 冷启动 148 个请求早超了。
 *
 * 2) **嵌不进去是常态，不是 bug**：对方可以写 `X-Frame-Options` /
 *    CSP `frame-ancestors` 禁止被嵌，而浏览器**不允许跨域读响应头** ——
 *    所以"填地址的时候"查不出来，只能嵌了才知道。
 *    → 所以这里**必须明说原因 + 给一个"用浏览器打开"的按钮**，
 *      绝不丢一个白屏让用户猜（这是本文件存在的主要理由）。
 *
 * 3) **返回钮不能省**：整页 iframe 里是对方的页面，它不知道栖岛的存在；
 *    用户真机实测过"时感没做返回键，我按系统返回直接退出应用了"。
 */
export function PluginFrame({
  url,
  title,
  local,
  hint,
}: {
  url: string;
  title: string;
  /** 这个地址是不是"打进包里的本地副本"（本地的不可能被 X-Frame-Options 拦） */
  local: boolean;
  /** 打不开时给用户的一句解释（不同插件不一样） */
  hint?: string;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "ok" | "stuck">("loading");
  const [dismissed, setDismissed] = useState(false);
  /** 用户点过"用浏览器打开"（那种情况就不是"没打开"，是主动跳出去） */
  const [opened, setOpened] = useState(false);

  const loadedRef = useRef(false);

  /**
   * 判断"到底打开了没有"。
   *
   * 踩过四次，前三次的结论都是错的 —— 记下来，别再回头：
   *
   * 1) ❌ `contentDocument == null` 当失败：iframe 一开始就是 `about:blank`，
   *    而它是**可读**的（非 null）→ "还没开始加载"被误判成"加载失败"。
   * 2) ❌ "load 之后凡是**能读到**就算没跳过去"：**同源**的副本当然读得到！
   *    （`public/shigan/` 跟我们同域）→ "明明打开了"被误判成失败：
   *    顶上那条"正在打开"永不消失（用户截图抓到的就是它）+ 下面弹一张失败卡片。
   * 3) ❌ "读 HTML 内容里有没有我们 App 的标记"：我猜的那个标记名**根本不存在**，
   *    于时感的页面被误判成"栖岛自己"（实测抓到的假阳性）。
   *
   * ✅ 现在只用**一条可靠判据**：`load` 之后它的地址是不是还停在 `about:blank`。
   *   · `about:blank` → 没跳过去 ❌
   *   · 别的地址（同源能读到、或跨域读不到）→ 打开了 ✅
   *   · 连 `load` 都没触发（25 秒）→ 也算失败（下面那个轮询兜底）
   *
   * ⚠️ 剩下一个**认不出来**的情况：本地副本没打进构建时，SPA 兜底会把请求接走，
   * 此时 iframe 的地址**也会被改写成请求的那个路径**（实测），所以"比地址"同样没用。
   * 那条路只能靠"25 秒还没加载完"兜底 —— 而真机上本地副本一定在，走不到这条。
   */
  function probe(): "blank" | "ok" {
    const el = document.getElementById("plugin-frame") as HTMLIFrameElement | null;
    let doc: Document | null = null;
    try {
      doc = el?.contentDocument ?? null;
    } catch {
      // 跨域读不到 = 加载了别的东西（正常）
      return "ok";
    }
    if (!doc) return "ok";
    const href = doc.location?.href ?? "";
    if (href === "about:blank") return "blank";
    /**
     * **同源**时再看一条硬证据：它停的地址是不是我们要的那个。
     *
     * 为什么需要这条（实测抓到的）：同源的页面在 Vite 下**可能永远不触发 `load`**
     * （页面一直在活动 / HMR 长连接），于是 `onLoad` 不跑、"正在打开…"挂到 25 秒兜底 —— 
     * 用户看到的就是那条遮挡。地址对上了就直接算打开，不用等事件。
     */
    if (href.startsWith("http") && el && href.startsWith(el.src.split("?")[0]!)) return "ok";
    return "ok";
  }

  useEffect(() => {
    setState("loading");
    setDismissed(false);
    setOpened(false);
    loadedRef.current = false;
    const started = Date.now();
    /**
     * 兜底轮询（每 1.5 秒），盯两件事：
     *   ① 连 `load` 都没触发（超过 25 秒）→ 判失败
     *   ② **已经能看出结果就不等 load 了** —— 这条很要紧：
     *      万一嵌进来的是"栖岛自己"（本地副本没打进构建、被 SPA 兜底接住），
     *      它会递归地再去嵌时感 → `load` **永远不会触发** →
     *      "正在打开…"就会挂在那里永久遮挡（用户截图抓到的就是它）。
     */
    const iv = window.setInterval(() => {
      if (loadedRef.current) return;
      const p = probe();
      /**
       * **轮询自己收敛**（不依赖 `load` 事件）：
       * 同源页面在 Vite 下可能永远不触发 `load`，只等事件的话
       * "正在打开…"会挂到 25 秒兜底 —— 用户看到的就是那条遮挡。
       */
      if (p === "ok") {
        loadedRef.current = true;
        setState("ok");
        return;
      }
      if (p === "blank") {
        loadedRef.current = true;
        setState("stuck");
        return;
      }
      if (Date.now() - started > 25000) setState((s) => (s === "loading" ? "stuck" : s));
    }, 1500);
    return () => window.clearInterval(iv);
  }, [url]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-white">
      {/* 对方自己的页面。不加 sandbox：这是我们/用户自己的页面，脚本要能正常工作。 */}
      <iframe
        id="plugin-frame"
        key={url}
        src={url}
        title={title}
        onLoad={() => {
          loadedRef.current = true;
          setState(probe() === "ok" ? "ok" : "stuck");
        }}
        className="size-full border-0 bg-white"
      />

      {/* 返回钮：压在左上角、半透明黑底（跟时感同一套，用户已经用惯了） */}
      <button
        type="button"
        aria-label="返回插件"
        onClick={() => {
          if (window.history.length > 1) window.history.back();
          else void navigate({ to: "/play/plugins" });
        }}
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-10 flex size-9 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm active:bg-black/55"
      >
        <ChevronLeft className="size-5" strokeWidth={2} />
      </button>

      {/* 提示一律做成**细条贴在顶上**，绝不盖住画面中间 */}
      {state === "loading" && (
        <p className="pointer-events-none absolute inset-x-3 top-3 rounded-full bg-black/55 px-3.5 py-2 text-center text-[11px] text-white backdrop-blur-sm">
          正在打开{title}…
        </p>
      )}

      {state === "stuck" && !dismissed && (
        <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-black/70 px-3.5 py-3 backdrop-blur-md">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-white">这个页面没能嵌进来</p>
              <p className="mt-1 text-[11px] leading-4 text-white/80">
                {local
                  ? "本地那份副本没被打进这个构建（或者地址填错了）—— 现在是栖岛自己的页面被兜底接住了。"
                  : "最常见的原因：对方网站**不允许被别的页面嵌进来**（这是网站自己的设置，我们改不了）。"}
                {hint ? ` ${hint}` : ""}
              </p>
              <p className="mt-1 font-mono text-[10px] break-all text-white/60">{url}</p>
            </div>
            {/*
              关键：**给一个跳出去的出口**。嵌不进去不该是死路 ——
              用户的浏览器里有他的登录态，跳出去往往反而能用。
            */}
            <div className="flex shrink-0 flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpened(true);
                  window.open(url, "_blank", "noopener");
                }}
                className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1.5 text-[11px] whitespace-nowrap text-white"
              >
                <ExternalLink className="size-3" strokeWidth={2} aria-hidden="true" />
                浏览器打开
              </button>
              <button
                type="button"
                aria-label="知道了"
                onClick={() => setDismissed(true)}
                className="rounded-full px-3 py-1.5 text-[11px] text-white/70"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {opened && (
        <p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-full bg-black/55 px-3.5 py-2 text-center text-[11px] text-white/90 backdrop-blur-sm">
          已经从浏览器打开了 —— 看完切回栖岛就行。
        </p>
      )}
    </div>
  );
}
