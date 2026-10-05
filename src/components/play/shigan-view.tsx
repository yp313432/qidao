import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";

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
  const [state, setState] = useState<"loading" | "ok" | "stuck">("loading");
  const [dismissed, setDismissed] = useState(false);

  /**
   * 地址的默认值：
   *   · **App 里**（VITE_DIRECT_UPSTREAM=1 的那种构建）→ 用**打进本地的副本**
   *     （public/shigan/，跟 App 一起装进手机）。打开不需要网络、不需要梯子。
   *   · **网页版** → 也走同一个副本 `/shigan/index.html`。
   *
   * 为什么网页版不再指向 :8081：那个端口要求"另外开一个时感的 dev server"，
   * 部署到云端根本没有它 —— 用户点开就是白屏。
   * 而 public/shigan/ 这 16 个文件**两个构建都会带上**（Vite 会拷 public/），
   * 所以同一个域名下就能取到。实测 /shigan/index.html 返回的确实是时感那一页
   * （标题「时感」、资源在 /shigan/assets/ 下），静态文件优先于路由兜底，不会打架。
   * 想指回别处（比如局域网另一台机器）仍然可以在设置里自己填地址。
   */
  // 必须是**绝对**路径：相对路径会拼在当前目录后面（在 /play/shigan 这一页
  // 会去找 /play/shigan/index.html → 404 → 白屏）。
  const auto = "/shigan/index.html";
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
  }, [url]);

  /*
    用户："咱们就直接一整个页面就是纯时感插件了就可以"
          "时感那个插件底部本来就看不到导航栏，然后也不用留了"

    所以这一页**整个就是时感的画面**：没有栖岛的标题栏、没有背景图、
    没有圆角卡片、没有那条地址栏 —— 也没有底部导航
    （app-shell 的 hideNav 已经把 /play/ 整段都排除了）。

    代价：原来那个「换地址」入口没了。所以它挪到了
    「我的 → 我的空间 → 时感地址」——设置归设置，画面归画面。
  */
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-white">
      {/* 时感自己的页面。不加 sandbox：它是我们自己跑的，脚本要能正常工作。 */}
      <iframe
        id="shigan-frame"
        key={url}
        src={url}
        title="时感"
        onLoad={() => {
          loadedRef.current = true;
          setState(probe() === "blank" ? "stuck" : "ok");
        }}
        className="size-full border-0 bg-white"
      />

      {/*
        提示一律做成**细条贴在顶上**，绝不盖住画面中间 ——
        想给人看的东西不能被自己的提示挡掉。
      */}
      {state === "loading" && (
        <p className="pointer-events-none absolute inset-x-3 top-3 rounded-full bg-black/55 px-3.5 py-2 text-center text-[11px] text-white backdrop-blur-sm">
          正在打开时感…
        </p>
      )}

      {state === "stuck" && !dismissed && (
        <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-black/70 px-3.5 py-3 backdrop-blur-md">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-white">好像没打开</p>
              <p className="mt-1 text-[11px] leading-4 text-white/80">
                地址是 <span className="font-mono">{url}</span>。
                没打开一般是：本地副本没打进这个构建 / 地址不对。
                想换地址去「我的 → 我的空间 → 时感地址」。
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
  );
}

