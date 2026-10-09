import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Gem, History, Library, ScrollText, SlidersHorizontal } from "lucide-react";
import { LifeformCanvas } from "@/plugins/emotion-lifeform/components/lifeform/LifeformCanvas";
import { MODE_LABEL, type EmotionEvent } from "@/plugins/emotion-lifeform/lib/emotion/types";
import { useEmotionView } from "@/plugins/emotion-lifeform/lib/emotion/present";
import { useEmotionStore, type TabId } from "@/plugins/emotion-lifeform/lib/store";
import { DetailPanel, LexiconPanel, SettingsPanel, StatePanel, TimelinePanel } from "./panels";

const TABS: { id: TabId; label: string; icon: typeof Gem }[] = [
  { id: "state", label: "状态", icon: Gem },
  { id: "detail", label: "详情", icon: ScrollText },
  { id: "timeline", label: "轨迹", icon: History },
  { id: "lexicon", label: "词库", icon: Library },
  { id: "settings", label: "设置", icon: SlidersHorizontal },
];

/**
 * 插件本体。
 *
 * `realScenes`（可选）= **栖岛真上报的情绪事件**（已经由宿主侧用
 * `lib/emotion/qidao-scenes.ts` 映射好）。空数组 / 不传 = 保持原来的
 * 10 个模拟场景 —— 所以空库不会白屏（用户明确要求的那条）。
 */
export function EmotionApp({ realScenes = [] }: { realScenes?: EmotionEvent[] }) {
  const tab = useEmotionStore((s) => s.tab);
  const setTab = useEmotionStore((s) => s.setTab);
  const sceneId = useEmotionStore((s) => s.sceneId);
  const scenes = useEmotionStore((s) => s.scenes);
  const setScene = useEmotionStore((s) => s.setScene);
  const stepScene = useEmotionStore((s) => s.stepScene);
  const setRealScenes = useEmotionStore((s) => s.setRealScenes);
  const settings = useEmotionStore((s) => s.settings);
  const hydrate = useEmotionStore((s) => s.hydrate);
  const view = useEmotionView();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  /** 宿主的数据一变就登记进来（空数组 = 回落模拟场景） */
  useEffect(() => {
    setRealScenes(realScenes);
  }, [realScenes, setRealScenes]);

  useEffect(() => {
    document.getElementById(`scene-${sceneId}`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [sceneId]);

  const nodes =
    view.masked || view.hiddenByLabel
      ? []
      : (view.memory?.memories ?? []).map((memory) => ({ id: memory.id, title: memory.title }));

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <p className="sr-only" aria-live="polite">
        {view.event.title}，强度 {view.event.intensity}，置信度 {view.event.confidence}
      </p>
      <div className="mx-auto lg:grid lg:min-h-dvh lg:max-w-6xl lg:grid-cols-2">
        <section className="relative h-80 overflow-hidden border-b border-line lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
          {settings.showLifeform ? (
            <LifeformCanvas params={view.visual} nodes={nodes} reduced={settings.reducedMotion} />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg px-8 text-center">
              <p className="font-display text-2xl">可视化已关闭</p>
              <p className="mt-2 text-sm text-muted">情绪名称、强度和依据仍留在旁边。</p>
            </div>
          )}
          <header className="absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between bg-gradient-to-b from-bg px-4">
            <div>
              <p className="font-display text-sm tracking-widest text-primary">QIDAO 栖岛</p>
              <p className="text-xs text-muted">星屿</p>
            </div>
            <p className="rounded-full border border-line bg-bg-elev px-3 py-1 text-xs text-muted">{MODE_LABEL[settings.intimacyMode]}</p>
          </header>
          <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-3">
            <p className="w-fit rounded-full border border-line bg-bg-elev px-3 py-1 text-xs text-muted">
              {view.event.isDemoData ? "模拟数据 · 非生理测量" : "他自己上报的 · 非生理测量"}
            </p>
          </div>
        </section>

        <section className="lg:h-dvh lg:overflow-y-auto">
          <div className="sticky top-0 z-10 bg-bg px-4 pt-3">
            <div className="mb-2 flex items-center gap-2">
              <button type="button" aria-label="上一个状态" onClick={() => stepScene(-1)} className="inline-flex size-11 items-center justify-center rounded-full border border-line">
                <ChevronLeft className="size-5" />
              </button>
              <button type="button" aria-label="下一个状态" onClick={() => stepScene(1)} className="inline-flex size-11 items-center justify-center rounded-full border border-line">
                <ChevronRight className="size-5" />
              </button>
              <p className="text-xs text-faint">
                {view.event.isDemoData ? "演示流程" : "真实上报"} ·{" "}
                {scenes.findIndex((scene) => scene.eventId === sceneId) + 1}/{scenes.length}
              </p>
            </div>
            <div className="scroll-x flex gap-2 overflow-x-auto pb-3">
              {scenes.map((scene) => {
                const active = scene.eventId === sceneId && !view.isPreview;
                return (
                  <button
                    id={`scene-${scene.eventId}`}
                    key={scene.eventId}
                    type="button"
                    onClick={() => {
                      setScene(scene.eventId);
                      setTab("state");
                    }}
                    className={
                      active
                        ? "min-h-11 shrink-0 rounded-full bg-primary-deep px-3 text-sm text-fg"
                        : "min-h-11 shrink-0 rounded-full border border-line px-3 text-sm text-muted"
                    }
                  >
                    {scene.title}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="px-4 pt-2 pb-24">
            {tab === "state" ? <StatePanel /> : null}
            {tab === "detail" ? <DetailPanel /> : null}
            {tab === "timeline" ? <TimelinePanel /> : null}
            {tab === "lexicon" ? <LexiconPanel /> : null}
            {tab === "settings" ? <SettingsPanel /> : null}
          </div>
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg-elev" aria-label="分区">
        <div className="mx-auto flex max-w-6xl">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={active ? "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-primary" : "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-faint"}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-5" />
                <span className="text-xs">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
