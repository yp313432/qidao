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
/** 包过的 `matchMedia` 上挂的标记（判断"这次拿到的还是不是原生那个"，见下） */
const MOTION_PATCHED = "__qidaoMotionPatched";

/**
 * 这一条查询该由**宿主**回答（返回固定值），还是**原样听系统**？
 *
 * 返回 `null` = **不干预**。只有 `prefers-reduced-motion` 这一个查询会被接管，
 * 别的查询（`(min-width: …)` 之类）一律透传；`no-preference` 那个方向也要一并对上，
 * 不然插件写 `if (!mq.matches)` 反而会被带反。
 */
function forcedReducedMotion(query: string, host: string | undefined): boolean | null {
  if (!/prefers-reduced-motion/i.test(query)) return null; // 只管这一个查询
  if (host !== "on" && host !== "off") return null; // auto / 没设 → 听系统的
  const wantsReduced = !/no-preference/i.test(query);
  return host === "on" ? !wantsReduced : wantsReduced;
}

/**
 * 把 iframe 里的 `matchMedia` 包一层：**只对 `prefers-reduced-motion`** 按栖岛
 * 写在 `<html data-motion>` 上的「动画」开关回答，别的查询原样透传。
 *
 * 为什么要在**宿主这一侧**做（这**不是 hack，是规则**）：栖岛的「动画」开关是
 * **纯 CSS** 实现的（`root.dataset.motion`，见 `store.ts` 的 `applyAppearance`），
 * 它管得到栖岛自己的动画，**管不到插件里用 JS 画的动画**（canvas / rAF）。
 * 时感是**打包好的产物**（`public/shigan/**`，源码不在我们这边，改不了），
 * 它里面直接读 `matchMedia('(prefers-reduced-motion: reduce)')`
 * → 系统一开「关闭动画」就"栖岛活着、时感死着"（真机踩过：
 * "网页里线上有粒子在跑，手机里的只有线"）。
 * 规则原文：`qidao-docs/规则-插件的动效要听宿主的.md`；
 * 原生插件（记忆宇宙）已按同一规则改过源码
 * （`src/plugins/memory-universe/MemoryUniverse.tsx`），这里补的是**同源 iframe 的兜底** ——
 * 产物一个字节都不动（也不许动美术/动画参数，规则里写了）。
 *
 * ⚠️ 只接管 `matches` 的**读取**：返回的仍是**原生 MediaQueryList**
 * （`addEventListener` / `removeEventListener` / `onchange` / `media` 全都在，
 * 不会被弄坏）。`auto` / 没设时这条查询**原样听系统**（`matches` 就是系统的值）；
 * 跨域、拿不到 `contentWindow` → **安全跳过**，
 * 绝不因此报错或白屏（嵌不进去本来就是常态，见本文件上面的规矩 2）。
 */
function patchFrameMotion(win: Window | null): void {
  if (!win) return;
  try {
    const mm = win.matchMedia as unknown as (Record<string, unknown> & typeof win.matchMedia) | undefined;
    if (!mm || mm[MOTION_PATCHED]) return; // 没有 matchMedia / 已经包过
    const original = win.matchMedia.bind(win);
    const patched = (query: string): MediaQueryList => {
      const mql = original(query);
      /**
       * 每次都**现读**宿主的设置（不是装载时读一次）——
       * 用户在设置里改「动画」开关时不用重开插件。
       */
      const forced = forcedReducedMotion(String(query), document.documentElement.dataset.motion);
      if (forced === null) return mql; // 不干预：原样透传
      try {
        Object.defineProperty(mql, "matches", {
          configurable: true,
          get: () => {
            const now = forcedReducedMotion(String(query), document.documentElement.dataset.motion);
            return now === null ? original(query).matches : now;
          },
        });
      } catch {
        /* 定义不上就保持原样 —— 宁可不改，也不能把 MediaQueryList 弄坏 */
      }
      return mql;
    };
    // 标记挂在**函数自己**身上：导航把它冲掉 = 原生函数回来了 = 该重新包一次
    (patched as unknown as Record<string, unknown>)[MOTION_PATCHED] = true;
    win.matchMedia = patched as typeof win.matchMedia;
  } catch {
    /* 跨域（读写 contentWindow 会抛）→ 安全跳过 */
  }
}

/** 拿到 iframe 里的 window —— **仅同源**；跨域 / 还没有文档时返回 null，绝不抛 */
function sameOriginFrameWindow(): Window | null {
  try {
    const el = document.getElementById("plugin-frame") as HTMLIFrameElement | null;
    if (!el) return null;
    // 跨域时 contentDocument 是 null（读它本身也可能抛 → 外层 catch）
    if (!el.contentDocument) return null;
    return el.contentWindow;
  } catch {
    return null;
  }
}

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

  /**
   * 「动画」开关 → iframe 里的 `matchMedia`（见 `patchFrameMotion`）。
   *
   * 两个时机都补一次，因为**哪个先到不确定**：
   *   · 挂载时（这时是同源可读的 `about:blank`）—— 先包上，
   *     同源导航在浏览器里会复用这个 window，于是插件脚本**跑之前**就已经兜住了；
   *   · 宿主设置变了（`<html data-motion>`）—— 用户改开关不用重开插件。
   * 跨域时 `patchFrameMotion` 自己会安全跳过。
   */
  useEffect(() => {
    const apply = () => patchFrameMotion(sameOriginFrameWindow());
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    return () => mo.disconnect();
  }, [url]);

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
        // 同源的插件这时文档已经在了 —— 顺手把它的 matchMedia 兜住（见 patchFrameMotion）
        patchFrameMotion(sameOriginFrameWindow());
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
          // 加载完成 = 文档在了 → 把插件的 matchMedia 兜住（跨域会自己跳过）
          patchFrameMotion(sameOriginFrameWindow());
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
        className="absolute inset-back left-3 z-10 flex size-9 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm active:bg-black/55"
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
