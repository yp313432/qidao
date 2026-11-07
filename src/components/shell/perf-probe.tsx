import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * 切页流畅度探针（2026-11 · 纯色模式「切对话/切工具会卡顿」）。
 *
 * ## 为什么存在
 * 这个 App 跑在安卓 WebView 里，而开发沙盒**起不了浏览器**（playwright 一律
 * `spawn EPERM`，`vite build` 也是），所以我没办法自己"滑一遍看看顺不顺"。
 * 既然只能靠真机，那就别猜 —— 把数字放到屏幕上：改之前记一组、改之后记一组，
 * 哪一刀有用一目了然。（先量后改，是我们定的规矩，见 design/ARCHITECTURE.md D9。）
 *
 * ## 它量什么
 * 1. **FPS** —— 过去 0.5 秒真实画了多少帧，折算成每秒帧数；
 * 2. **最长帧** —— 同一窗口里最长的一次帧间隔（毫秒）。掉帧的"那一顿"就是它；
 * 3. **长任务** —— 主线程被占用超过 50ms 的次数与最长值（`longtask`）。
 *    切页卡顿时它必然会跳，所以它是"是 DOM 太重还是动画太重"的分水岭：
 *    长任务多 = 主线程在干活（挂载/解析太多）；长任务不多但 FPS 低 = 合成器压力（动画太多）；
 * 4. **切页** —— 从**手指按下**那一刻算起，到路由换完、画面真的画出来（两帧之后）
 *    一共多少毫秒。这正是用户体感的那一段。
 *
 * ## 怎么打开（默认全关，日常使用看不到任何东西）
 * - 网址带 `?perf=1` 或 `#perf`；
 * - `localStorage.setItem("qidao:perf", "1")` 之后刷新；
 * - 把下面 `PERF_FORCE` 改成 `true` 重新打包 —— APK 里没有地址栏，用这个。
 * - 开发模式（`import.meta.env.DEV`）默认就亮着。
 *
 * ## 为什么每 0.5 秒才算一次账
 * 探针自己也是要花时间的。用 `setState` 每帧刷新的话，它就会变成"新增的卡顿源"，
 * 量的东西被自己污染。所以帧/长任务都先记在 ref 里，定时结算。
 */

/** APK 里没有地址栏时用这个开关（改完要重新打包才生效）。 */
const PERF_FORCE = false;

type Stats = {
  /** 过去 0.5 秒折算出的每秒帧数 */
  fps: number;
  /** 同一窗口里最长的一次帧间隔（毫秒） */
  worst: number;
  /** 过去 0.5 秒里 >50ms 的长任务次数 */
  longs: number;
  /** 其中最长的一次（毫秒） */
  longest: number;
  /** 上一次切页：按下 → 画完（毫秒），还没切过页是 null */
  switchMs: number | null;
};

const EMPTY: Stats = { fps: 0, worst: 0, longs: 0, longest: 0, switchMs: null };

/** 结算窗口：太短会被瞬时抖动带偏，太长看不见"刚刚那一下" */
const WINDOW_MS = 500;

export function PerfProbe() {
  const [on, setOn] = useState(false);
  const [stats, setStats] = useState<Stats>(EMPTY);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  /** 手指按下的时刻（体感起算点） */
  const tapAt = useRef(0);
  /** 未结算的原始计数 */
  const frames = useRef(0);
  const worst = useRef(0);
  const longs = useRef({ n: 0, max: 0 });

  // 开关判定放在挂载后：服务端没有 window / localStorage
  useEffect(() => {
    let stored = false;
    try {
      stored = window.localStorage.getItem("qidao:perf") === "1";
    } catch {
      /* 隐私模式没有存储，不算错 */
    }
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("perf") === "1" || url.hash === "#perf";
    if (PERF_FORCE || fromUrl || stored || import.meta.env.DEV) setOn(true);
  }, []);

  // 1) 记下"手指按下"的时刻。用捕获 + passive：不挡点击、不改任何交互行为
  useEffect(() => {
    if (!on) return;
    const mark = () => {
      tapAt.current = performance.now();
    };
    window.addEventListener("pointerdown", mark, { passive: true, capture: true });
    return () => window.removeEventListener("pointerdown", mark, { capture: true });
  }, [on]);

  // 2) 逐帧计数：帧间隔 = 上一帧到这一帧的时长，最大值就是"最长帧"
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      if (dt > 0) {
        frames.current += 1;
        if (dt > worst.current) worst.current = dt;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  // 3) 长任务：Chromium 系支持；老 WebView 没有这个 type 就静默放弃
  useEffect(() => {
    if (!on || typeof PerformanceObserver === "undefined") return;
    let po: PerformanceObserver | null = null;
    try {
      po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longs.current.n += 1;
          if (entry.duration > longs.current.max) longs.current.max = entry.duration;
        }
      });
      po.observe({ type: "longtask", buffered: true });
    } catch {
      po = null;
    }
    return () => po?.disconnect();
  }, [on]);

  // 4) 每 0.5 秒结算一次（见文件头"为什么每 0.5 秒才算一次账"）
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => {
      const f = frames.current;
      const w = worst.current;
      frames.current = 0;
      worst.current = 0;
      const l = longs.current;
      longs.current = { n: 0, max: 0 };
      // 0.5 秒里画了 f 帧 → 每秒 f / 0.5 帧
      const fps = Math.round(f * (1000 / WINDOW_MS));
      setStats((s) => ({
        ...s,
        fps,
        worst: Math.round(w),
        longs: l.n,
        longest: Math.round(l.max),
      }));
    }, WINDOW_MS);
    return () => window.clearInterval(id);
  }, [on]);

  // 5) 切页耗时：路由一变就开始量，等**两帧**（第二帧才是"已经画到屏幕上"）
  useEffect(() => {
    if (!on) return;
    const from = tapAt.current;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        /* 没按过（比如程序自己跳转）就不记，别显示一个假数字 */
        if (!from) return;
        const ms = Math.round(performance.now() - from);
        setStats((s) => ({ ...s, switchMs: ms }));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [on, pathname]);

  if (!on) return null;

  const fpsTone =
    stats.fps >= 55
      ? "rgba(120,200,140,.95)"
      : stats.fps >= 40
        ? "rgba(240,200,110,.95)"
        : "rgba(240,130,120,.95)";
  const worstTone = stats.worst >= 34 ? "rgba(240,130,120,.95)" : "rgba(255,255,255,.86)";

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: "max(env(safe-area-inset-top, 0px), 6px)",
        right: 8,
        zIndex: 200,
        pointerEvents: "none",
        padding: "5px 8px",
        borderRadius: 8,
        background: "rgba(20,18,16,.72)",
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10,
        lineHeight: 1.55,
        letterSpacing: 0.2,
        color: "rgba(255,255,255,.86)",
        whiteSpace: "nowrap",
      }}
    >
      <div>
        <span style={{ color: fpsTone }}>{stats.fps} fps</span>
        <span style={{ color: "rgba(255,255,255,.45)" }}> · 最长帧 </span>
        <span style={{ color: worstTone }}>{stats.worst}ms</span>
      </div>
      <div>
        <span style={{ color: "rgba(255,255,255,.45)" }}>长任务 </span>
        <span
          style={{ color: stats.longs > 0 ? "rgba(240,200,110,.95)" : "rgba(255,255,255,.86)" }}
        >
          {stats.longs}
        </span>
        <span style={{ color: "rgba(255,255,255,.45)" }}> / 最长 </span>
        <span>{stats.longest}ms</span>
      </div>
      <div>
        <span style={{ color: "rgba(255,255,255,.45)" }}>切页 </span>
        <span>{stats.switchMs === null ? "—" : `${stats.switchMs}ms`}</span>
      </div>
    </div>
  );
}
