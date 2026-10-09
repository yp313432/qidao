import { useEffect, useState } from "react";
import { LEXICON } from "./lexicon";
import { getScene } from "./scenes";
import type { EmotionEvent, IntimacyMode, SceneCategory, Settings, UserCorrection } from "./types";
import { familyOf, resolveVisual } from "./visual";
import type { VisualParams } from "./types";
import { memoryAdapter, subscribeMemorySource, type MemorySearchResult } from "../memory";
import { useEmotionStore } from "../store";

export type EmotionView = {
  event: EmotionEvent;
  visual: VisualParams;
  summary: string;
  motion: string;
  footnote: string;
  masked: boolean;
  corrected: boolean;
  isPreview: boolean;
  lowConfidence: boolean;
  hiddenByLabel: boolean;
};

function modeFootnote(mode: IntimacyMode, category: SceneCategory): string {
  if (category !== "intimacy" && category !== "tension") {
    if (mode === "daily") return "";
    return "档位主要改变亲密场景的表达。这一条不是亲密分支，动效只做轻微强弱。";
  }
  if (mode === "daily") return "当前按日常语气收着，不把这条读成情欲。";
  if (mode === "affectionate") return "亲昵只加重温柔和陪伴，不会自动变成情欲。";
  if (mode === "flirtatious") return "暧昧保留试探和停顿，不代表对方已经同意更进一步。";
  return "浓烈只加强氛围张力。它不是生理欲望，也不等于同意。";
}

function previewEvent(term: string, groupId: string): EmotionEvent {
  const group = LEXICON.find((item) => item.id === groupId) ?? LEXICON[0];
  const mapped = TERM_FAMILY_PREVIEW(term);
  const primary = mapped ?? group.family;
  const secondaryEmotions = mapped && mapped !== term ? [term] : [];
  const family = mapped ?? group.family;
  return {
    eventId: `preview:${groupId}:${term}`,
    timestamp: new Date().toISOString(),
    title: term,
    primaryEmotion: primary,
    secondaryEmotions,
    intensity: 56,
    confidence: 38,
    sourceType: "demo",
    expressionTendencies: group.kind === "expression" ? [term] : [],
    suggestedMode: "daily",
    evidenceRefs: [],
    memoryQuery: { emotion: term },
    summary:
      group.kind === "expression"
        ? `「${term}」是表达倾向，不是情绪本身。它可以叠在别的情绪上，这里只做单独预览。`
        : `正在预览词条「${term}」。它和「${family}」共用一套基础动作，再由强度和次级词微调。这不是对你的判断。`,
    motion: "词条预览使用该分支的基础动态。数值都是示意，方便看映射，不代表一次真实推断。",
    category: group.category,
    dimensions: {
      attraction: group.category === "intimacy" ? 48 : 12,
      longing: family === "渴望" ? 70 : 16,
      shyness: term === "羞涩" || term === "羞赧" ? 72 : 14,
      restraint: term === "克制" || family === "克制" ? 76 : 18,
      warmth: family === "安心" || family === "喜悦" ? 64 : 36,
      unease: family === "不安" || family === "失落" || family === "介意" ? 58 : 16,
    },
    coach: "这是词库预览。返回后可回到时间线里的场景。",
    isDemoData: true,
  };
}

function TERM_FAMILY_PREVIEW(term: string): string | null {
  const family = familyOf(term, "");
  return family || null;
}

export function deriveView(
  scene: EmotionEvent,
  settings: Settings,
  correction: UserCorrection | undefined,
  preview: { term: string; groupId: string } | null,
): EmotionView {
  const baseEvent = preview ? previewEvent(preview.term, preview.groupId) : scene;
  const hiddenByLabel = settings.hiddenLabels.includes(baseEvent.primaryEmotion);
  const hidden = Boolean(correction?.hiddenPrimary || hiddenByLabel);
  const masked = !settings.intimacyEnabled && baseEvent.category === "intimacy";

  let event = baseEvent;
  if (!hidden && correction?.primaryEmotion && !preview) {
    event = {
      ...baseEvent,
      primaryEmotion: correction.primaryEmotion,
      title: correction.primaryEmotion,
    };
  }
  event = {
    ...event,
    secondaryEmotions: event.secondaryEmotions.filter((tag) => !settings.hiddenLabels.includes(tag)),
  };

  const corrected = Boolean(correction && !preview);
  let summary = event.summary;
  let motion = event.motion;
  if (hidden) {
    summary = "你隐藏了这个状态。灵体回到日常呼吸，原判断不会写进记忆库。";
    motion = "动态按平静处理，避免继续用这个标签的形态面对你。";
  } else if (masked) {
    summary = "亲密模块已关闭。相关标签和文案被收起，灵体保持日常呼吸。";
    motion = "翼膜和光带回到平静态。打开模块后，才会恢复这条的靠近与停顿。";
  } else if (corrected && correction?.primaryEmotion) {
    summary = `你把主情绪改成了「${correction.primaryEmotion}」。${event.summary}`;
  }

  const visual = resolveVisual(hidden ? { ...event, primaryEmotion: "平静", secondaryEmotions: [], intensity: 30 } : event, settings, {
    masked: masked || hidden,
  });

  return {
    event,
    visual,
    summary,
    motion,
    footnote: masked || hidden ? "" : modeFootnote(settings.intimacyMode, event.category),
    masked,
    corrected,
    isPreview: Boolean(preview),
    lowConfidence: event.confidence < 55 && !masked && !hidden,
    hiddenByLabel: hidden,
  };
}

export function useEmotionView(): EmotionView & {
  memory: MemorySearchResult | null;
  memoryLoading: boolean;
} {
  const sceneId = useEmotionStore((s) => s.sceneId);
  const settings = useEmotionStore((s) => s.settings);
  const corrections = useEmotionStore((s) => s.corrections);
  const preview = useEmotionStore((s) => s.preview);
  const scene = getScene(sceneId);
  const view = deriveView(scene, settings, corrections[sceneId], preview);
  const [memory, setMemory] = useState<MemorySearchResult | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(true);

  const queryKey = `${view.event.eventId}:${view.masked}:${view.hiddenByLabel}`;

  const emotion = view.event.memoryQuery.emotion ?? "";
  const topic = view.event.memoryQuery.topic ?? "";

  /**
   * **栖岛的记忆变了就重算一次**（记忆适配器接真数据之后加的这一条）。
   *
   * 为什么需要：检索是"一个场景查一次"。宿主 store 的记忆是异步 hydrate 的
   * （IndexedDB），如果第一遍在它 ready 之前跑，面板就会一直停在旧的答案上 ——
   * 看起来像"接上了"，其实没接。订阅之后，记忆一到就当场重查。
   *
   * 真实值仍然是下面那个 effect 查出来的（`search()` 是异步接口），
   * 这里只用订阅来触发它重跑。
   */
  const [memoryVersion, setMemoryVersion] = useState(0);
  useEffect(() => subscribeMemorySource(() => setMemoryVersion((v) => v + 1)), []);

  useEffect(() => {
    let live = true;
    setMemoryLoading(true);
    if (view.masked || view.hiddenByLabel) {
      setMemory({
        memories: [],
        links: [],
        relationNote: "模块或标签已隐藏，因此不展示记忆引用。",
        isDemoData: true,
      });
      setMemoryLoading(false);
      return () => {
        live = false;
      };
    }
    memoryAdapter.search({ emotion, topic }).then((result) => {
      if (!live) return;
      setMemory(result);
      setMemoryLoading(false);
    });
    return () => {
      live = false;
    };
  }, [queryKey, emotion, topic, view.masked, view.hiddenByLabel, memoryVersion]);

  return { ...view, memory, memoryLoading };
}
