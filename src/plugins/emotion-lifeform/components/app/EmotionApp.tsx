"use client";

/**
 * 「情绪」插件页 —— 按设计稿 `preview-emotion-glow3.html` 的 3 屏重写。
 *
 *   今天：光团 + 主情绪 + 为什么 + 强度/确定 + 最近几笔
 *   轨迹：24 小时光带 + 时间线
 *   详情 / 设置：都从底部升起的浮层，不再占页签
 *
 * 返回沿用插件外壳已有的机制（`window.history.back()`，兜底 `/play/plugins`），
 * 不新造路由；数据只来自 `useEmotionView()` / `useEmotionStore()`。
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Settings } from "lucide-react";
import { type EmotionEvent } from "@/plugins/emotion-lifeform/lib/emotion/types";
import { useEmotionView } from "@/plugins/emotion-lifeform/lib/emotion/present";
import { useEmotionStore } from "@/plugins/emotion-lifeform/lib/store";
import { EmotionGlowStyle, GlowBackdrop, PAPER, groupOf } from "./emotion-glow";
import { DetailSheet, SettingsSheet, TodayScreen, TrackScreen } from "./panels";

type Screen = "today" | "track";

const SEGMENTS: { id: Screen; label: string }[] = [
  { id: "today", label: "今天" },
  { id: "track", label: "轨迹" },
];

export function EmotionApp({ realScenes = [] }: { realScenes?: EmotionEvent[] }) {
  const navigate = useNavigate();
  const view = useEmotionView();
  const scenes = useEmotionStore((store) => store.scenes);
  const sceneId = useEmotionStore((store) => store.sceneId);
  const settings = useEmotionStore((store) => store.settings);
  const hydrate = useEmotionStore((store) => store.hydrate);
  const setScene = useEmotionStore((store) => store.setScene);
  const setRealScenes = useEmotionStore((store) => store.setRealScenes);

  const [screen, setScreen] = useState<Screen>("today");
  const [trackMounted, setTrackMounted] = useState(false);
  /** 每次进轨迹 +1，重挂轨迹屏让光带重新"画"一遍 */
  const [trackRun, setTrackRun] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pinnedRef = useRef(false);

  const reduced = settings.reducedMotion;
  const group = groupOf(view.event);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setRealScenes(realScenes);
  }, [realScenes, setRealScenes]);

  // 第一次进来把镜头对到最近一笔（演示数据是时间升序的，最新的在末尾）
  useEffect(() => {
    if (pinnedRef.current || scenes.length === 0) return;
    pinnedRef.current = true;
    const latest = [...scenes].sort(
      (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
    )[0];
    if (latest && latest.eventId !== sceneId) setScene(latest.eventId);
  }, [scenes, sceneId, setScene]);

  const openDetail = (eventId: string) => {
    setScene(eventId);
    setDetailOpen(true);
  };

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/play/plugins" });
  };

  const switchScreen = (next: Screen) => {
    if (next === "track") {
      setTrackMounted(true);
      setTrackRun((run) => run + 1);
    }
    setScreen(next);
  };

  const screenClass = (active: boolean) =>
    active
      ? "relative"
      : `pointer-events-none absolute inset-x-0 top-0 ${reduced ? "opacity-0" : "scale-[.86] opacity-0 transition-all duration-300"}`;

  return (
    <div
      className="relative min-h-dvh"
      style={{
        background: PAPER.bg,
        color: PAPER.cream,
        /**
         * 顶部留出星空：用户 2026-11-01 "还是贴着顶边栏，往下挪，你下面不还有空地吗"。
         * 顶栏不再从 y=0 开始，上面露出背景，视觉上就不"贴"了。
         */
        paddingTop: "max(38px, calc(var(--q-inset-top, env(safe-area-inset-top, 0px)) + 28px))",
      }}
    >
      <GlowBackdrop
        hue={group.hue}
        intensity={settings.showLifeform ? view.event.intensity : 30}
        reduced={reduced}
      />
      <EmotionGlowStyle />

      <header
        className="sticky top-0 z-30 flex items-center gap-2 px-4 pb-2"
        style={{
          /**
           * 让开手机状态栏。用户实机两条反馈：
           *   ① "上面导航栏太高了，已经和我手机的时间、电量糊在一起了"；
           *   ② "返回、轨迹和设置按钮完全没反应" —— 贴顶时按钮正好压在
           *      状态栏那条区域上，看着在、点不到。
           * `--q-inset-top` 是原生推进来的；浏览器里没有，就退回 env()。
           */
          paddingTop: 0,
          background:
            "linear-gradient(180deg, rgba(13,10,20,.96) 0%, rgba(13,10,20,.82) 68%, rgba(13,10,20,0) 100%)",
        }}
      >
        <button
          type="button"
          onClick={goBack}
          aria-label="返回插件"
          className="grid size-8 shrink-0 place-items-center rounded-full"
          style={{
            background: "rgba(255,255,255,.12)",
            border: "1px solid rgba(255,255,255,.16)",
            color: "#f6efe4",
          }}
        >
          <ChevronLeft className="size-4" />
        </button>
        <h1 className="text-[16.5px] font-semibold" style={{ color: PAPER.cream }}>
          情绪
        </h1>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5" role="group" aria-label="切换视图">
          {SEGMENTS.map((segment) => {
            const active = screen === segment.id;
            return (
              <button
                key={segment.id}
                type="button"
                aria-pressed={active}
                onClick={() => switchScreen(segment.id)}
                className="rounded-full px-3 py-[5px] text-[11.5px] transition-colors"
                style={
                  active
                    ? {
                        background: "#f4eee4",
                        border: "1px solid #f4eee4",
                        color: "#191418",
                        fontWeight: 600,
                      }
                    : {
                        background: "rgba(255,255,255,.05)",
                        border: "1px solid rgba(255,255,255,.08)",
                        color: "#a99fb2",
                        fontWeight: 500,
                      }
                }
              >
                {segment.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="情绪设置"
          className="grid size-[30px] shrink-0 place-items-center rounded-full"
          style={{ background: "rgba(255,255,255,.07)", color: "#cbc2d1" }}
        >
          <Settings className="size-3.5" />
        </button>
      </header>

      <main className="relative z-10">
        <div className={screenClass(screen === "today")}>
          <TodayScreen onOpenDetail={openDetail} />
        </div>
        {trackMounted ? (
          <div key={trackRun} className={screenClass(screen === "track")}>
            <TrackScreen onOpenDetail={openDetail} />
          </div>
        ) : null}
      </main>

      {detailOpen ? <DetailSheet onClose={() => setDetailOpen(false)} /> : null}
      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
