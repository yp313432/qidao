import { create } from "zustand";
import { SCENES, activeScenes, setExternalScenes } from "./emotion/scenes";
import type { EmotionEvent, IntimacyMode, Settings, UserCorrection } from "./emotion/types";

export type TabId = "state" | "detail" | "timeline" | "lexicon" | "settings";

export const DEFAULT_SETTINGS: Settings = {
  intimacyMode: "daily",
  showLifeform: true,
  intimacyEnabled: true,
  showCopy: true,
  showConfidence: true,
  reducedMotion: false,
  hiddenLabels: [],
};

type Preview = { term: string; groupId: string } | null;

type Persisted = {
  v: 1;
  settings: Settings;
  corrections: Record<string, UserCorrection>;
  sceneId: string;
};

const STORAGE_KEY = "qidao-emotion-demo";

type Store = {
  tab: TabId;
  sceneId: string;
  /**
   * 现在能看的场景列表：**有真数据就是真数据，没有才是那 10 个模拟场景**。
   *
   * 用户的要求："只有'存在真情绪事件'时才用真的，否则保持现在的模拟场景
   * （这样空库也不会白屏）。" 所以这个字段永远非空。
   */
  scenes: EmotionEvent[];
  /**
   * 栖岛真上报的情绪事件（已经映射成插件的 `EmotionEvent`）。
   *
   * 空数组 = 库里一条都还没有 ⇒ 回落模拟场景。宿主那边一变就调
   * `setRealScenes()`（见 `components/app/EmotionApp.tsx` 里那个 effect）。
   */
  realScenes: EmotionEvent[];
  setRealScenes: (list: EmotionEvent[]) => void;
  settings: Settings;
  corrections: Record<string, UserCorrection>;
  preview: Preview;
  notice: string;
  setTab: (tab: TabId) => void;
  setScene: (id: string) => void;
  stepScene: (dir: 1 | -1) => void;
  setMode: (mode: IntimacyMode) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  toggleLabel: (label: string) => void;
  correct: (correction: UserCorrection) => void;
  clearCorrection: (eventId: string) => void;
  setPreview: (preview: Preview) => void;
  clearLocalDemo: () => void;
  hydrate: () => void;
};

function persist(state: Pick<Store, "settings" | "corrections" | "sceneId">) {
  if (typeof localStorage === "undefined") return;
  const data: Persisted = {
    v: 1,
    settings: state.settings,
    corrections: state.corrections,
    sceneId: state.sceneId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export const useEmotionStore = create<Store>((set, get) => ({
  tab: "state",
  sceneId: SCENES[0].eventId,
  scenes: SCENES,
  realScenes: [],
  /**
   * 登记真数据 → 数据层（`scenes.ts` 的登记处）+ 界面用的列表一起更新。
   *
   * 两条行为，都是"用户要看见变化"逼出来的：
   *   · 出现**新的一笔**（最新那条换了 id）→ 直接把镜头挪过去；
   *   · 原来选中的那条不在新列表里了（比如从模拟切到真数据）→ 也挪到最新那条。
   *   其余情况**保持用户手里的选择**（别因为他多报一笔就把人正在看的翻掉）。
   */
  setRealScenes: (list) => {
    setExternalScenes(list);
    const scenes = activeScenes();
    const newest = scenes[0];
    const prevNewest = get().realScenes[0];
    const sceneId = get().sceneId;
    const stale = !scenes.some((scene) => scene.eventId === sceneId);
    const changed = list.length > 0 && newest?.eventId !== prevNewest?.eventId;
    const nextId = changed || stale ? (newest?.eventId ?? SCENES[0].eventId) : sceneId;
    set({ realScenes: list, scenes, sceneId: nextId });
  },
  settings: DEFAULT_SETTINGS,
  corrections: {},
  preview: null,
  notice: "",
  setTab: (tab) => set({ tab }),
  setScene: (id) => {
    set({ sceneId: id, preview: null });
    persist(get());
  },
  stepScene: (dir) => {
    const { sceneId, scenes } = get();
    const index = Math.max(0, scenes.findIndex((scene) => scene.eventId === sceneId));
    const next = scenes[(index + dir + scenes.length) % scenes.length];
    set({ sceneId: next.eventId, preview: null, tab: "state" });
    persist(get());
  },
  setMode: (mode) => {
    const settings = { ...get().settings, intimacyMode: mode };
    set({ settings });
    persist(get());
  },
  updateSettings: (patch) => {
    set({ settings: { ...get().settings, ...patch } });
    persist(get());
  },
  toggleLabel: (label) => {
    const hidden = get().settings.hiddenLabels;
    const hiddenLabels = hidden.includes(label) ? hidden.filter((item) => item !== label) : [...hidden, label];
    set({ settings: { ...get().settings, hiddenLabels } });
    persist(get());
  },
  correct: (correction) => {
    set({ corrections: { ...get().corrections, [correction.eventId]: correction }, preview: null });
    persist(get());
  },
  clearCorrection: (eventId) => {
    const corrections = { ...get().corrections };
    delete corrections[eventId];
    set({ corrections });
    persist(get());
  },
  setPreview: (preview) => set({ preview, tab: preview ? "state" : get().tab }),
  clearLocalDemo: () => {
    set({
      settings: DEFAULT_SETTINGS,
      corrections: {},
      sceneId: activeScenes()[0]?.eventId ?? SCENES[0].eventId,
      preview: null,
      notice: "本地的演示修正和开关已清除。",
    });
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  },
  hydrate: () => {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        /*
          动效「听宿主的」—— 规则：`qidao-docs/规则-插件的动效要听宿主的.md`
          （跟记忆宇宙那次同一处改法）。

          宿主的动画开关是**纯 CSS** 写在 `<html data-motion>` 上的
          （栖岛 `src/lib/store.ts` 里的 `root.dataset.motion`），
          它管不到插件里 JS 画的 canvas；原来这里只问系统，于是手机上
          系统一压制动效，栖岛自己活着、这个灵体却停住。
          所以：宿主说了算 → `on` 不减少 / `off` 减少；宿主没说（独立跑）才回落到系统。

          ⚠️ 只改这一个判断，美术 / 动画参数一个都没动；
            下面「设置」页里那个「减少动态」开关是插件自己的选择，照旧保留。
        */
        const hostMotion = document.documentElement.dataset.motion;
        const reduced =
          hostMotion === "on"
            ? false
            : hostMotion === "off"
              ? true
              : window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced) set({ settings: { ...DEFAULT_SETTINGS, reducedMotion: true } });
        return;
      }
      const data = JSON.parse(raw) as Persisted;
      if (data.v !== 1) return;
      /**
       * 存档里的 sceneId 要跟**当前能看的列表**对一遍（真数据 / 模拟都可能）。
       * 对不上就取第一条 —— 绝不能让界面停在一条不存在的记录上（那就是白屏）。
       */
      const list = activeScenes();
      const sceneId = list.some((scene) => scene.eventId === data.sceneId)
        ? data.sceneId
        : (list[0]?.eventId ?? SCENES[0].eventId);
      set({
        settings: { ...DEFAULT_SETTINGS, ...data.settings },
        corrections: data.corrections ?? {},
        sceneId,
      });
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  },
}));
