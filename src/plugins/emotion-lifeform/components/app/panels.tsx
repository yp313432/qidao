"use client";

/**
 * 「情绪」页的三块面板：
 *   · TodayScreen —— 今天（光团 + 主情绪 + 为什么 + 指标 + 最近几笔）
 *   · TrackScreen —— 轨迹（24 小时光带 + 时间线）
 *   · DetailSheet / SettingsSheet —— 点记录弹的详情浮层、点齿轮弹的设置浮层
 *
 * 设计稿：仓库根 `preview-emotion-glow3.html`（第 1 屏今天 / 第 2 屏详情 / 第 3 屏轨迹）。
 * 数据全部来自 `useEmotionView()` 与 `useEmotionStore()`，不自己造。
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { LEXICON } from "@/plugins/emotion-lifeform/lib/emotion/lexicon";
import { DIMENSIONS, type EmotionEvent, type Settings } from "@/plugins/emotion-lifeform/lib/emotion/types";
import { useEmotionView } from "@/plugins/emotion-lifeform/lib/emotion/present";
import { useEmotionStore } from "@/plugins/emotion-lifeform/lib/store";
import {
  EmotionOrb,
  PAPER,
  SCRIPT_FONT,
  clockMinutes,
  formatClock,
  groupOf,
  scriptStyle,
  type EmotionGroup,
} from "./emotion-glow";

/* ────────────────────────────── 小组件 ────────────────────────────── */

function ScriptLine({
  children,
  size,
  opacity,
  rotate,
  className = "",
}: {
  children: ReactNode;
  size: number;
  opacity: number;
  rotate: number;
  className?: string;
}) {
  return (
    <p className={className} style={scriptStyle(size, opacity, rotate)}>
      {children}
    </p>
  );
}

function GroupPill({ group }: { group: EmotionGroup }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px]"
      style={{
        background: "rgba(255,255,255,.07)",
        border: "1px solid rgba(255,255,255,.13)",
        color: "#e8dfd2",
      }}
    >
      <span className="size-[6px] rounded-full" style={{ background: group.tint }} />
      {group.letter} · {group.name}
    </span>
  );
}

/** 设计稿那根 4px 细条：左侧标签、中间轨道、右侧数字 */
function ThinBar({ label, value, tint, soft = false }: { label: string; value: number; tint: string; soft?: boolean }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="grid grid-cols-[50px_1fr_38px] items-center gap-2.5 text-[11.5px]" style={{ color: PAPER.muted }}>
      <span className="truncate">{label}</span>
      <span className="h-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.09)" }}>
        <span
          className="block h-full rounded-full"
          style={{
            width: `${clamped}%`,
            background: soft ? `${tint}cc` : "linear-gradient(90deg, #fff4e6, rgba(255,228,205,.92))",
          }}
        />
      </span>
      <span className="text-right tabular-nums" style={{ color: "#cfc6b8" }}>
        {clamped}
      </span>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px]"
      style={{
        background: "rgba(255,255,255,.07)",
        border: "1px solid rgba(255,255,255,.13)",
        color: "#e8dfd2",
      }}
    >
      {children}
    </span>
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
      className="flex min-h-11 w-full items-center justify-between gap-3 border-b py-2.5 text-left"
      style={{ borderColor: "rgba(255,255,255,.07)" }}
    >
      <span className="min-w-0">
        <span className="block text-[12.5px]" style={{ color: PAPER.cream }}>
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: PAPER.faint }}>
          {hint}
        </span>
      </span>
      <span
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ background: checked ? "#5c4678" : "rgba(255,255,255,.12)" }}
      >
        <span
          className="absolute top-1 size-4 rounded-full transition-all"
          style={{ left: checked ? 24 : 4, background: checked ? PAPER.cream : "#a99fb2" }}
        />
      </span>
    </button>
  );
}

/* ────────────────────────────── 今天 ────────────────────────────── */

export function TodayScreen({ onOpenDetail }: { onOpenDetail: (eventId: string) => void }) {
  const view = useEmotionView();
  const scenes = useEmotionStore((store) => store.scenes);
  const settings = useEmotionStore((store) => store.settings);
  const setPreview = useEmotionStore((store) => store.setPreview);

  const group = useMemo(() => groupOf(view.event), [view.event]);
  const hidden = view.masked || view.hiddenByLabel;
  const reduced = settings.reducedMotion;

  const recent = useMemo(
    () =>
      [...scenes]
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
        .slice(0, 5),
    [scenes],
  );

  /** 六维里最突出的三条，避免今天屏太长 */
  const dimensions = useMemo(
    () =>
      DIMENSIONS.map(([key, label]) => ({ key, label, value: view.event.dimensions[key] }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 3),
    [view.event.dimensions],
  );

  const quote = view.event.evidenceRefs[0]?.quote;

  return (
    <div className="relative px-5 pb-8">
      <ScriptLine size={21} opacity={0.8} rotate={-1.2} className="pt-3">
        Every feeling leaves a light.
      </ScriptLine>

      <div className="mt-1 grid place-items-center">
        {settings.showLifeform ? (
          <button
            type="button"
            onClick={() => onOpenDetail(view.event.eventId)}
            aria-label="看这笔情绪的详情"
            className="rounded-full"
            style={{ background: "transparent" }}
          >
            <EmotionOrb
              eventId={view.event.eventId}
              hue={group.hue}
              intensity={hidden ? 30 : view.event.intensity}
              reduced={reduced}
            />
          </button>
        ) : (
          <div
            className="grid place-items-center rounded-full border text-[11.5px]"
            style={{
              width: 176,
              height: 176,
              borderColor: "rgba(255,255,255,.1)",
              color: "rgba(255,255,255,.35)",
            }}
          >
            可视化已关闭
          </div>
        )}
      </div>

      {view.isPreview ? (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="rounded-full px-3 py-1 text-[11px]"
            style={{
              background: "rgba(255,255,255,.07)",
              border: "1px solid rgba(255,255,255,.13)",
              color: PAPER.body,
            }}
          >
            词库预览 · 点这里回到现在
          </button>
        </div>
      ) : null}

      <div key={view.event.eventId} className={reduced ? undefined : "emo-word-in"}>
        <h2
          className="mt-5 text-center text-[30px] font-semibold leading-tight"
          style={{ color: PAPER.cream }}
        >
          {hidden ? "已隐藏" : view.event.title}
        </h2>
        <div
          className="mt-3 flex items-center justify-center gap-2 text-[11.5px]"
          style={{ color: PAPER.muted }}
        >
          <GroupPill group={group} />
          <span>· {formatClock(view.event.timestamp)}</span>
        </div>
      </div>

      {hidden ? (
        <p className="mt-5 text-[12.8px] leading-[1.78]" style={{ color: PAPER.body }}>
          这个状态被隐藏了，灵体按平静呼吸。原判断还留在轨迹里。
        </p>
      ) : (
        <>
          <div className="mt-5">
            <p className="text-[12.8px] leading-[1.78]" style={{ color: PAPER.body }}>
              {view.summary}
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-2.5">
            <ThinBar label="强度" value={view.event.intensity} tint={group.tint} />
            <ThinBar label="确定" value={view.event.confidence} tint={group.tint} />
            {dimensions.map((dimension) => (
              <ThinBar
                key={dimension.key}
                label={dimension.label}
                value={dimension.value}
                tint={group.tint}
                soft
              />
            ))}
          </div>

          {quote ? (
            <div
              className="mt-5 rounded-[16px] px-3.5 py-3"
              style={{
                background: "rgba(18,14,24,.72)",
                border: "1px solid rgba(255,255,255,.07)",
              }}
            >
              <p className="text-[11px]" style={{ color: PAPER.faint }}>
                这句话惹的：
              </p>
              <p className="mt-1 text-[12.5px] leading-[1.7]" style={{ color: "#e6ddd0" }}>
                「{quote}」
              </p>
            </div>
          ) : null}
        </>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <p className="text-[11px]" style={{ color: PAPER.faint }}>
          最近的几笔
        </p>
        {recent.map((event) => {
          const active = event.eventId === view.event.eventId;
          return (
            <button
              key={event.eventId}
              type="button"
              onClick={() => onOpenDetail(event.eventId)}
              className="grid grid-cols-[40px_8px_1fr_auto] items-center gap-2.5 rounded-[13px] px-2.5 py-2 text-left"
              style={{
                background: active ? "rgba(255,255,255,.075)" : "rgba(255,255,255,.045)",
                border: "1px solid rgba(255,255,255,.06)",
              }}
            >
              <span className="text-[11px] tabular-nums" style={{ color: "#7f7688" }}>
                {formatClock(event.timestamp)}
              </span>
              <span
                className="size-2 rounded-full"
                style={{ background: groupOf(event).tint }}
                aria-hidden
              />
              <span className="truncate text-[12px]" style={{ color: "#ded4e4" }}>
                {event.primaryEmotion}
              </span>
              <span className="text-[10.5px] tabular-nums" style={{ color: "#8b8294" }}>
                {event.intensity}
              </span>
            </button>
          );
        })}
      </div>

      <ScriptLine size={16} opacity={0.62} rotate={-1} className="mt-6 text-right">
        And I keep every one of them.
      </ScriptLine>

      {/* 给插件外壳那个右下返回钮留出空地，别压到页脚 */}
      <div className="h-20" />
    </div>
  );
}

/* ────────────────────────────── 轨迹 ────────────────────────────── */

type SparkPoint = { id: string; x: number; y: number };

const SPARK_WIDTH = 340;
const SPARK_HEIGHT = 110;
const SPARK_FLOOR = 104;

/** 把每笔按"一天里的第几分钟"铺到 24 小时光带上，y 由强度决定 */
function buildSpark(events: EmotionEvent[]): {
  points: SparkPoint[];
  line: string;
  area: string;
} {
  const points: SparkPoint[] = events.map((event) => {
    const minutes = clockMinutes(event.timestamp);
    const x = (minutes / 1440) * SPARK_WIDTH;
    const intensity = Math.max(4, Math.min(100, event.intensity));
    const y = SPARK_FLOOR - (intensity / 100) * (SPARK_FLOOR - 10);
    return {
      id: event.eventId,
      x: Math.max(6, Math.min(SPARK_WIDTH - 6, x)),
      y,
    };
  });

  if (points.length < 2) {
    const only = points[0];
    return {
      points,
      line: only ? `M ${only.x} ${only.y}` : "",
      area: only ? `M ${only.x} ${only.y} L ${only.x} ${SPARK_FLOOR} Z` : "",
    };
  }

  let line = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    line += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  const last = points[points.length - 1];
  const area = `${line} L ${last.x.toFixed(2)} ${SPARK_FLOOR} L ${points[0].x.toFixed(2)} ${SPARK_FLOOR} Z`;
  return { points, line, area };
}

export function TrackScreen({ onOpenDetail }: { onOpenDetail: (eventId: string) => void }) {
  const scenes = useEmotionStore((store) => store.scenes);
  const sceneId = useEmotionStore((store) => store.sceneId);
  const settings = useEmotionStore((store) => store.settings);
  const reduced = settings.reducedMotion;

  const ordered = useMemo(
    () => [...scenes].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)),
    [scenes],
  );
  const spark = useMemo(() => buildSpark(ordered), [ordered]);
  const current = spark.points.find((point) => point.id === sceneId) ?? spark.points[spark.points.length - 1];

  return (
    <div className="relative px-5 pb-8">
      <ScriptLine size={21} opacity={0.8} rotate={-1.2} className="pt-3">
        Some days are quieter than others.
      </ScriptLine>

      <div className="mt-5 h-[110px] w-full" aria-hidden>
        <svg
          viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id="emo-spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffe6d6" stopOpacity=".38" />
              <stop offset="100%" stopColor="#ffe6d6" stopOpacity="0" />
            </linearGradient>
          </defs>
          {spark.area ? (
            <path d={spark.area} fill="url(#emo-spark-fill)" className={reduced ? undefined : "emo-fade"} />
          ) : null}
          {spark.line ? (
            <path
              d={spark.line}
              fill="none"
              stroke="#ffe3cf"
              strokeWidth={1.5}
              strokeOpacity={0.82}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pathLength={1}
              strokeDasharray={1}
              className={reduced ? undefined : "emo-spark-line"}
            />
          ) : null}
          {spark.line && !reduced ? (
            <path
              d={spark.line}
              fill="none"
              stroke="#fffaf2"
              strokeWidth={2.2}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pathLength={100}
              strokeDasharray="5 95"
              className="emo-spark-flow"
              opacity={0.9}
            />
          ) : null}
          {current ? <circle cx={current.x} cy={current.y} r={3} fill="#fffaf2" /> : null}
        </svg>
      </div>

      <ol className="mt-6 flex flex-col">
        {[...ordered].reverse().map((event, index, list) => {
          const group = groupOf(event);
          const active = event.eventId === sceneId;
          const quote = event.evidenceRefs[0]?.quote;
          const last = index === list.length - 1;
          return (
            <li key={event.eventId} className="grid grid-cols-[40px_15px_1fr] gap-2.5 pb-3.5 last:pb-1">
              <span className="pt-[3px] text-[11px] tabular-nums" style={{ color: "#7f7688" }}>
                {formatClock(event.timestamp)}
              </span>
              <span className="relative" aria-hidden>
                {last ? null : (
                  <span
                    className="absolute left-[4px] top-[6px] w-px"
                    style={{ bottom: -14, background: "rgba(255,255,255,.09)" }}
                  />
                )}
                <span
                  className="absolute left-0 top-[3px] size-[10px] rounded-full"
                  style={{ background: group.tint, filter: "blur(1px)" }}
                />
              </span>
              <button
                type="button"
                onClick={() => onOpenDetail(event.eventId)}
                className="rounded-[12px] border px-2.5 py-2 text-left"
                style={{
                  background: active ? "rgba(255,255,255,.075)" : "rgba(255,255,255,.045)",
                  borderColor: "rgba(255,255,255,.06)",
                }}
              >
                <p className="text-[13px]" style={{ color: "#ece3d6" }}>
                  {event.primaryEmotion}
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "#8f8699" }}>
                  {group.letter} {group.name} · 强度 {event.intensity}
                </p>
                {quote ? (
                  <p className="mt-1 text-[11px] leading-[1.6]" style={{ color: PAPER.muted }}>
                    「{quote}」
                  </p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>

      <ScriptLine size={16} opacity={0.62} rotate={-1} className="mt-5 text-right">
        Nothing wasted, nothing lost.
      </ScriptLine>

      <div className="h-20" />
    </div>
  );
}

/* ────────────────────────────── 详情浮层 ────────────────────────────── */

export function DetailSheet({ onClose }: { onClose: () => void }) {
  const view = useEmotionView();
  const settings = useEmotionStore((store) => store.settings);
  const group = groupOf(view.event);
  const hidden = view.masked || view.hiddenByLabel;
  const reduced = settings.reducedMotion;
  const quote = view.event.evidenceRefs[0]?.quote;
  const memories = view.memory?.memories ?? [];

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="情绪详情">
      <button
        type="button"
        aria-label="关闭详情"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
        style={{
          background:
            "linear-gradient(180deg, rgba(6,4,10,.14) 0%, rgba(6,4,10,.06) 36%, rgba(6,4,10,.7) 100%)",
        }}
      />
      <div
        className={reduced ? undefined : "emo-sheet"}
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 12,
          borderRadius: 26,
          padding: "18px 16px 16px",
          background: PAPER.panel,
          border: `1px solid ${PAPER.panelBorder}`,
          boxShadow: "0 -10px 40px rgba(0,0,0,.5)",
          backdropFilter: "blur(18px)",
        }}
      >
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 grid size-[26px] place-items-center rounded-full"
          style={{ background: "rgba(255,255,255,.08)", color: PAPER.muted }}
        >
          <X className="size-3.5" />
        </button>

        <div className="flex items-start gap-3 pr-8">
          <div className="shrink-0">
            <EmotionOrb
              eventId={view.event.eventId}
              hue={group.hue}
              intensity={hidden ? 30 : view.event.intensity}
              reduced={reduced}
              size={92}
              dimmed={hidden}
            />
          </div>
          <div className="min-w-0 flex-1 pt-1.5">
            <p className="text-[18px] font-semibold leading-tight" style={{ color: PAPER.cream }}>
              {hidden ? "已隐藏" : view.event.title}
            </p>
            <p className="mt-1 text-[11.5px]" style={{ color: "#918899" }}>
              {group.letter} · {group.name} · {formatClock(view.event.timestamp)}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip>强度 {view.event.intensity}</Chip>
              <Chip>确定 {view.event.confidence}</Chip>
              {view.event.secondaryEmotions.slice(0, 2).map((tag) => (
                <Chip key={tag}>{tag}</Chip>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[12.2px] leading-[1.75]" style={{ color: PAPER.body }}>
          {view.summary}
        </p>

        {quote ? (
          <div
            className="mt-2.5 rounded-[14px] px-3 py-2.5"
            style={{ background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.07)" }}
          >
            <p className="text-[11px]" style={{ color: PAPER.faint }}>
              这句话惹的：
            </p>
            <p className="mt-1 text-[12px] leading-[1.65]" style={{ color: "#e6ddd0" }}>
              「{quote}」
            </p>
          </div>
        ) : null}

        <div className="mt-3 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.07)" }}>
          <p className="text-[11px]" style={{ color: "#8c8396" }}>
            这笔跟这些记忆连着
          </p>
          {view.memoryLoading ? (
            <p className="mt-1.5 text-[11.5px]" style={{ color: PAPER.faint }}>
              正在检索记忆…
            </p>
          ) : memories.length ? (
            <ul className="mt-2 flex flex-col gap-2.5">
              {memories.slice(0, 3).map((memory) => (
                <li key={memory.id} className="flex items-center gap-2 text-[12px]" style={{ color: "#ded4e4" }}>
                  <span className="size-[7px] shrink-0 rounded-full" style={{ background: "#ffe6c4" }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{memory.title}</span>
                  <Link
                    to="/play/plugins/memory"
                    onClick={onClose}
                    className="shrink-0 text-[10.5px]"
                    style={{ color: "#6f6779" }}
                  >
                    打开 ›
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[11.5px]" style={{ color: PAPER.faint }}>
              {view.memory?.relationNote ?? "暂无可关联的历史记忆。"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────── 设置浮层 ────────────────────────────── */

function LexiconFold() {
  const [query, setQuery] = useState("");
  const setPreview = useEmotionStore((store) => store.setPreview);
  const hiddenLabels = useEmotionStore((store) => store.settings.hiddenLabels);
  const toggleLabel = useEmotionStore((store) => store.toggleLabel);
  const needle = query.trim();
  const groups = LEXICON.map((group) => ({
    ...group,
    terms: group.terms.filter(
      (term) => !needle || term.includes(needle) || group.title.includes(needle),
    ),
  })).filter((group) => group.terms.length > 0);
  const total = LEXICON.reduce((sum, group) => sum + group.terms.length, 0);

  return (
    <details className="border-t pt-2" style={{ borderColor: "rgba(255,255,255,.07)" }}>
      <summary
        className="flex min-h-9 cursor-pointer list-none items-center justify-between text-[12.5px]"
        style={{ color: PAPER.cream }}
      >
        <span>情绪词库</span>
        <span className="text-[11px]" style={{ color: PAPER.faint }}>
          {total} 个参考说法
        </span>
      </summary>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索词条"
        aria-label="搜索情绪词"
        className="mt-1 min-h-9 w-full rounded-full px-3 text-[12px] outline-none"
        style={{
          background: "rgba(255,255,255,.05)",
          border: "1px solid rgba(255,255,255,.08)",
          color: PAPER.cream,
        }}
      />
      {groups.length === 0 ? (
        <p className="mt-2 text-[11.5px]" style={{ color: PAPER.faint }}>
          没有匹配的词条。
        </p>
      ) : null}
      <div className="mt-2">
        {groups.map((group) => (
          <details key={group.id} className="border-b py-1" style={{ borderColor: "rgba(255,255,255,.06)" }}>
            <summary
              className="flex min-h-8 cursor-pointer list-none items-center justify-between text-[12px]"
              style={{ color: PAPER.body }}
            >
              <span>{group.title}</span>
              <span className="text-[10.5px]" style={{ color: PAPER.faint }}>
                {group.terms.length}
              </span>
            </summary>
            <div className="flex flex-wrap gap-1.5 pb-2 pt-1">
              {group.terms.map((term) => {
                const off = hiddenLabels.includes(term);
                return (
                  <span key={term} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setPreview({ term, groupId: group.id })}
                      className="min-h-8 rounded-full px-2 text-[11px]"
                      style={{
                        background: "rgba(255,255,255,.05)",
                        border: "1px solid rgba(255,255,255,.08)",
                        color: off ? PAPER.faint : PAPER.body,
                        textDecoration: off ? "line-through" : undefined,
                      }}
                    >
                      {term}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleLabel(term)}
                      className="min-h-8 px-1 text-[10px]"
                      style={{ color: PAPER.faint }}
                      aria-label={off ? `恢复${term}` : `隐藏${term}`}
                    >
                      {off ? "恢复" : "隐藏"}
                    </button>
                  </span>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useEmotionStore((store) => store.settings);
  const updateSettings = useEmotionStore((store) => store.updateSettings);
  const reduced = settings.reducedMotion;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="情绪设置">
      <button
        type="button"
        aria-label="关闭设置"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
        style={{ background: "rgba(6,4,10,.42)", backdropFilter: "blur(1px)" }}
      />
      <div
        className={reduced ? undefined : "emo-sheet"}
        style={{
          position: "absolute",
          right: 12,
          bottom: 12,
          width: "min(300px, calc(100% - 24px))",
          maxHeight: "calc(100dvh - 96px)",
          overflowY: "auto",
          borderRadius: 22,
          padding: "16px 14px 14px",
          background: PAPER.panel,
          border: `1px solid ${PAPER.panelBorder}`,
          boxShadow: "0 -10px 40px rgba(0,0,0,.5)",
          backdropFilter: "blur(18px)",
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold" style={{ color: PAPER.cream }}>
            设置
          </p>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="grid size-[26px] place-items-center rounded-full"
            style={{ background: "rgba(255,255,255,.08)", color: PAPER.muted }}
          >
            <X className="size-3.5" />
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-snug" style={{ color: PAPER.faint }}>
          只影响这一页的显示，不会把推断写成长期记忆。
        </p>
        <div className="mt-2">
          <Toggle
            label="情绪可视化"
            hint="关闭后只留文字、强度和依据。"
            checked={settings.showLifeform}
            onChange={(showLifeform) => updateSettings({ showLifeform })}
          />
          <Toggle
            label="减少动态"
            hint="关掉呼吸、落地和浮层动效，全部停在静止一帧。"
            checked={settings.reducedMotion}
            onChange={(reducedMotion) => updateSettings({ reducedMotion })}
          />
        </div>
        <LexiconFold />
      </div>
    </div>
  );
}

/** 旧面板里还在用的设置类型，导出给页面做类型约束用 */
export type { Settings };

/** 手写字体常量重导出，页面统一从这里拿 */
export { SCRIPT_FONT };
