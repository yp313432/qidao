import { useMemo, useState } from "react";
import { CATEGORY_LABEL, DIMENSIONS, MODE_LABEL, MODES, SOURCE_LABEL, type IntimacyMode, type SceneCategory } from "@/plugins/emotion-lifeform/lib/emotion/types";
import { LEXICON } from "@/plugins/emotion-lifeform/lib/emotion/lexicon";
import { useEmotionView } from "@/plugins/emotion-lifeform/lib/emotion/present";
import { useEmotionStore } from "@/plugins/emotion-lifeform/lib/store";

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function ModeSwitch({ value, onChange }: { value: IntimacyMode; onChange: (mode: IntimacyMode) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1 rounded-full border border-line bg-surface p-1" role="radiogroup" aria-label="亲密氛围档位">
      {MODES.map((mode) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(mode)}
            className={
              active
                ? "min-h-11 rounded-full bg-primary-deep text-sm text-fg"
                : "min-h-11 rounded-full text-sm text-muted"
            }
          >
            {MODE_LABEL[mode]}
          </button>
        );
      })}
    </div>
  );
}

function Meter({ label, value, hue, marker }: { label: string; value: number; hue: number; marker?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular-nums text-fg">
          {value}
          <span className="text-faint">/100</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: `hsl(${hue} 42% 74%)` }} />
      </div>
      {marker ? <p className="mt-1 text-xs text-faint">{marker}</p> : null}
    </div>
  );
}

export function StatePanel() {
  const view = useEmotionView();
  const setTab = useEmotionStore((s) => s.setTab);
  const setMode = useEmotionStore((s) => s.setMode);
  const setPreview = useEmotionStore((s) => s.setPreview);
  const correct = useEmotionStore((s) => s.correct);
  const clearCorrection = useEmotionStore((s) => s.clearCorrection);
  const settings = useEmotionStore((s) => s.settings);
  const [open, setOpen] = useState(false);
  const sceneId = useEmotionStore((s) => s.sceneId);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{view.isPreview ? "词条预览" : view.event.coach}</p>
      {view.isPreview ? (
        <button type="button" onClick={() => setPreview(null)} className="min-h-11 self-start rounded-full border border-line px-4 text-sm text-primary">
          返回当前场景
        </button>
      ) : null}

      <div>
        <p className="text-xs tracking-widest text-faint">主情绪</p>
        <h2 className="mt-1 font-display text-4xl text-fg">{view.hiddenByLabel || view.masked ? "已隐藏" : view.event.title}</h2>
        {!view.masked && !view.hiddenByLabel ? (
          <p className="mt-2 text-sm text-muted">
            {view.event.primaryEmotion}
            {view.event.secondaryEmotions.length ? ` · ${view.event.secondaryEmotions.join(" · ")}` : ""}
          </p>
        ) : null}
      </div>

      {!view.masked && !view.hiddenByLabel ? (
        <div className="grid gap-4">
          <Meter label="强度 · 估计" value={view.event.intensity} hue={view.visual.hue} marker="强度高，不代表判断一定准确。" />
          {settings.showConfidence ? (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted">
                <span>置信度 · 证据支持</span>
                <span className="tabular-nums text-fg">{view.event.confidence}</span>
              </div>
              <div className="flex gap-1" aria-hidden>
                {Array.from({ length: 10 }, (_, i) => (
                  <span
                    key={i}
                    className={i < Math.round(view.event.confidence / 10) ? "h-2 flex-1 rounded-sm bg-blush" : "h-2 flex-1 rounded-sm bg-surface-2"}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {view.lowConfidence ? (
        <p className="rounded-lg border border-line bg-surface px-3 py-3 text-sm text-blush">
          推断偏强，证据偏弱。把它当成疑问，而不是事实。
        </p>
      ) : null}

      {settings.showCopy ? (
        <div className="flex flex-col gap-3">
          <p className="text-base text-fg">{view.summary}</p>
          <p className="text-sm text-muted">{view.motion}</p>
          {view.footnote ? <p className="text-sm text-faint">{view.footnote}</p> : null}
        </div>
      ) : (
        <p className="text-sm text-faint">文字描述已关闭。</p>
      )}

      {!view.masked && view.event.secondaryEmotions.length ? (
        <div className="flex flex-wrap gap-2">
          {view.event.secondaryEmotions.map((tag) => (
            <span key={tag} className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-muted">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3">
        {DIMENSIONS.slice(0, 4).map(([key, label]) => (
          <Meter key={key} label={label} value={view.masked ? 0 : view.event.dimensions[key]} hue={view.visual.hue} />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">氛围档位</p>
          {!view.isPreview && view.event.suggestedMode !== settings.intimacyMode ? (
            <button type="button" className="min-h-11 text-sm text-primary" onClick={() => setMode(view.event.suggestedMode)}>
              采用建议：{MODE_LABEL[view.event.suggestedMode]}
            </button>
          ) : (
            <span className="text-xs text-faint">建议 {MODE_LABEL[view.event.suggestedMode]}</span>
          )}
        </div>
        <ModeSwitch value={settings.intimacyMode} onChange={setMode} />
        <p className="text-xs text-faint">档位只改变表达和动效，不代表同意，也不代表生理欲望。</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setTab("detail")} className="min-h-11 rounded-full bg-primary-deep px-4 text-sm text-fg">
          查看依据
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-h-11 rounded-full border border-line px-4 text-sm text-fg">
          修正状态
        </button>
      </div>

      {open && !view.isPreview ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <p className="text-sm text-muted">修正只留在这次演示里，不会写回记忆库。</p>
          {[
            ["更像委屈", "委屈"],
            ["更像克制", "克制"],
            ["更像安心", "安心"],
          ].map(([label, primary]) => (
            <button
              key={primary}
              type="button"
              className="min-h-11 rounded-full border border-line px-4 text-left text-sm"
              onClick={() => {
                correct({ eventId: sceneId, primaryEmotion: primary, note: label });
                setOpen(false);
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="min-h-11 rounded-full border border-line px-4 text-left text-sm"
            onClick={() => {
              correct({ eventId: sceneId, hiddenPrimary: true, note: "隐藏" });
              setOpen(false);
            }}
          >
            不想显示这个状态
          </button>
          <button type="button" className="min-h-11 text-left text-sm text-primary" onClick={() => clearCorrection(sceneId)}>
            撤销修正
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function DetailPanel() {
  const view = useEmotionView();
  const settings = useEmotionStore((s) => s.settings);
  const setTab = useEmotionStore((s) => s.setTab);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs text-faint">{view.event.isDemoData ? "情绪详情 · 模拟" : "情绪详情 · 他自己上报的"}</p>
        <h2 className="mt-1 font-display text-3xl">{view.masked || view.hiddenByLabel ? "已隐藏" : view.event.title}</h2>
      </div>
      {settings.showConfidence && !view.masked ? (
        <p className="text-sm text-muted">
          来源：{SOURCE_LABEL[view.event.sourceType]} · 置信度 {view.event.confidence} · 强度 {view.event.intensity}
        </p>
      ) : null}
      {settings.showCopy ? (
        <>
          <p className="text-fg">{view.summary}</p>
          <div className="rounded-lg border border-line bg-surface px-3 py-3">
            <p className="text-xs text-faint">为什么是这个动作</p>
            <p className="mt-1 text-sm text-muted">{view.motion}</p>
          </div>
        </>
      ) : null}
      {view.footnote ? <p className="text-sm text-faint">{view.footnote}</p> : null}

      {!view.masked && view.event.expressionTendencies.length ? (
        <div>
          <p className="mb-2 text-xs text-faint">表达倾向 · 不是情绪标签</p>
          <div className="flex flex-wrap gap-2">
            {view.event.expressionTendencies.map((item) => (
              <span key={item} className="rounded-full border border-line px-3 py-1 text-sm text-muted">
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs text-faint">触发依据</p>
        {view.masked || view.hiddenByLabel ? (
          <p className="text-sm text-muted">内容已隐藏。</p>
        ) : view.event.evidenceRefs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">这条没有附带对话片段。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {view.event.evidenceRefs.map((item) => (
              <blockquote key={item.id} className="rounded-lg border border-line bg-surface px-3 py-3">
                <p className="text-xs text-blush">{view.event.isDemoData ? "模拟对话片段" : "他引的那一句"}</p>
                <p className="mt-2 text-fg">「{item.quote}」</p>
                <p className="mt-2 text-sm text-muted">{item.note}</p>
              </blockquote>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs text-faint">记忆引用</p>
        {view.memoryLoading ? <p className="text-sm text-muted">正在检索模拟记忆…</p> : null}
        {view.memory && !view.memoryLoading && view.memory.memories.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">{view.memory.relationNote}</p>
        ) : null}
        {view.memory?.memories.map((memory) => (
          <article key={memory.id} className="mb-2 rounded-lg border border-line bg-surface px-3 py-3">
            <p className="text-xs text-blush">
              {memory.title} · {memory.sourceLabel}
            </p>
            <p className="mt-2 text-sm text-fg">{memory.summary}</p>
            <p className="mt-2 text-xs text-faint">
              {memory.id} · {formatWhen(memory.createdAt)} · 模拟
            </p>
          </article>
        ))}
        {view.memory && view.memory.memories.length > 0 ? <p className="text-xs text-faint">{view.memory.relationNote}</p> : null}
      </div>

      {view.corrected ? <p className="text-sm text-primary">已按你的修正显示。原场景仍留在轨迹里。</p> : null}
      <button type="button" onClick={() => setTab("timeline")} className="min-h-11 self-start text-sm text-primary">
        在轨迹里查看前后变化
      </button>
    </div>
  );
}

const FILTERS: Array<SceneCategory | "all"> = ["all", "base", "intimacy", "tension", "cognition", "expression"];

export function TimelinePanel() {
  const sceneId = useEmotionStore((s) => s.sceneId);
  const setScene = useEmotionStore((s) => s.setScene);
  const setTab = useEmotionStore((s) => s.setTab);
  /** 有真数据就是真数据，没有才是模拟场景（空库不白屏） */
  const scenes = useEmotionStore((s) => s.scenes);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const items = useMemo(
    () => scenes.filter((scene) => filter === "all" || scene.category === filter),
    [scenes, filter],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-3xl">轨迹</h2>
        <p className="mt-2 text-sm text-muted">
          {scenes[0]?.isDemoData
            ? "这是系统对一段模拟对话的判断记录，不是生理情绪日志。"
            : "这是他自己上报的情绪记录（按时间倒序），不是生理情绪日志。"}
        </p>
      </div>
      <div className="scroll-x flex gap-2 overflow-x-auto">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={
              filter === item
                ? "min-h-11 shrink-0 rounded-full bg-primary-deep px-3 text-sm text-fg"
                : "min-h-11 shrink-0 rounded-full border border-line px-3 text-sm text-muted"
            }
          >
            {item === "all" ? "全部" : CATEGORY_LABEL[item]}
          </button>
        ))}
      </div>
      <ol className="flex flex-col gap-3 border-l border-line pl-4">
        {items.map((scene) => {
          const active = scene.eventId === sceneId;
          return (
            <li key={scene.eventId}>
              <button type="button" onClick={() => setScene(scene.eventId)} className="w-full rounded-lg px-2 py-2 text-left">
                <p className="text-xs text-faint">
                  {formatWhen(scene.timestamp)} · {CATEGORY_LABEL[scene.category]} ·{" "}
                  {scene.isDemoData ? "模拟" : "真实上报"}
                </p>
                <p className={active ? "mt-1 text-fg" : "mt-1 text-muted"}>{scene.title}</p>
                <p className="text-xs text-faint">
                  强度 {scene.intensity} · 置信度 {scene.confidence} · {SOURCE_LABEL[scene.sourceType]}
                </p>
              </button>
              {active ? (
                <button type="button" onClick={() => setTab("detail")} className="min-h-11 px-2 text-sm text-primary">
                  查看当时的依据
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function LexiconPanel() {
  const [query, setQuery] = useState("");
  const setPreview = useEmotionStore((s) => s.setPreview);
  const hidden = useEmotionStore((s) => s.settings.hiddenLabels);
  const toggleLabel = useEmotionStore((s) => s.toggleLabel);
  const needle = query.trim();
  const groups = LEXICON.map((group) => ({
    ...group,
    terms: group.terms.filter((term) => !needle || term.includes(needle) || group.title.includes(needle)),
  })).filter((group) => group.terms.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-3xl">词库</h2>
        <p className="mt-2 text-sm text-muted">同一分支共享基础动作。点一个词，看它如何改写灵体，而不是换一个角色。</p>
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索词条"
        className="min-h-11 rounded-full border border-line bg-surface px-4 text-sm text-fg outline-none"
        aria-label="搜索情绪词"
      />
      {groups.length === 0 ? <p className="text-sm text-muted">没有匹配的词条。</p> : null}
      {groups.map((group) => (
        <details key={group.id} className="border-b border-line" open={Boolean(needle)}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between py-2">
            <span className="text-sm text-fg">{group.title}</span>
            <span className="text-xs text-faint">{group.terms.length}</span>
          </summary>
          <p className="pb-2 text-xs text-faint">{group.note}</p>
          <div className="flex flex-wrap gap-2 pb-4">
            {group.terms.map((term) => {
              const off = hidden.includes(term);
              return (
                <span key={term} className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPreview({ term, groupId: group.id })}
                    className={off ? "min-h-11 rounded-full border border-line px-3 text-sm text-faint line-through" : "min-h-11 rounded-full border border-line px-3 text-sm text-fg"}
                  >
                    {term}
                  </button>
                  <button type="button" onClick={() => toggleLabel(term)} className="min-h-11 px-1 text-xs text-faint" aria-label={off ? `恢复${term}` : `隐藏${term}`}>
                    {off ? "恢复" : "隐藏"}
                  </button>
                </span>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 items-center justify-between gap-4 border-b border-line py-3 text-left"
    >
      <span>
        <span className="block text-sm text-fg">{label}</span>
        <span className="block text-xs text-faint">{hint}</span>
      </span>
      <span className={checked ? "h-7 w-12 shrink-0 rounded-full bg-primary-deep p-1" : "h-7 w-12 shrink-0 rounded-full bg-surface-2 p-1"}>
        <span className={checked ? "block h-5 w-5 translate-x-5 rounded-full bg-fg" : "block h-5 w-5 rounded-full bg-muted"} />
      </span>
    </button>
  );
}

export function SettingsPanel() {
  const settings = useEmotionStore((s) => s.settings);
  const updateSettings = useEmotionStore((s) => s.updateSettings);
  const setMode = useEmotionStore((s) => s.setMode);
  const clearLocalDemo = useEmotionStore((s) => s.clearLocalDemo);
  const notice = useEmotionStore((s) => s.notice);
  const toggleLabel = useEmotionStore((s) => s.toggleLabel);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-3xl">设置</h2>
        <p className="mt-2 text-sm text-muted">这些开关只影响演示里的显示。它们不会把推断写成长期记忆。</p>
      </div>
      <ModeSwitch value={settings.intimacyMode} onChange={setMode} />
      <div>
        <Toggle label="情绪可视化" hint="关闭后仍保留文字、强度和依据。" checked={settings.showLifeform} onChange={(showLifeform) => updateSettings({ showLifeform })} />
        <Toggle label="亲密模块" hint="关闭后，亲密分支的文案和动态都会收起。" checked={settings.intimacyEnabled} onChange={(intimacyEnabled) => updateSettings({ intimacyEnabled })} />
        <Toggle label="文字描述" hint="关掉诗意说明，只留标签和数值。" checked={settings.showCopy} onChange={(showCopy) => updateSettings({ showCopy })} />
        <Toggle label="来源与置信度" hint="默认打开。强度和置信度始终分开。" checked={settings.showConfidence} onChange={(showConfidence) => updateSettings({ showConfidence })} />
        <Toggle label="减少动态" hint="停在一帧静态形态，避免晃动和闪烁。" checked={settings.reducedMotion} onChange={(reducedMotion) => updateSettings({ reducedMotion })} />
      </div>
      {settings.hiddenLabels.length ? (
        <div>
          <p className="mb-2 text-xs text-faint">已隐藏的词</p>
          <div className="flex flex-wrap gap-2">
            {settings.hiddenLabels.map((label) => (
              <button key={label} type="button" onClick={() => toggleLabel(label)} className="min-h-11 rounded-full border border-line px-3 text-sm">
                恢复{label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <button type="button" onClick={clearLocalDemo} className="min-h-11 self-start rounded-full border border-line px-4 text-sm">
        清除本地演示记录
      </button>
      {notice ? <p className="text-sm text-primary">{notice}</p> : null}
      <p className="text-xs text-faint">记忆接入点是 MemoryAdapter。现在使用的是 MockMemoryAdapter，界面不会假设栖岛记忆库的字段。</p>
    </div>
  );
}
