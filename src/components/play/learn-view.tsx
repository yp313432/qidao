import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  Eye,
  EyeOff,
  Languages,
  Library,
  RefreshCw,
  Volume2,
} from "lucide-react";
import { PlayHeader } from "@/components/play-header";
import { resolveAiName } from "@/lib/branding";
import { DICTIONARY, READINGS, WORDS } from "@/lib/learn-data";
import { useApp } from "@/lib/store";
import { speakText, warmUpVoices } from "@/lib/tts";
import { useActivity } from "@/lib/use-activity";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "words", label: "单词", icon: BookOpen },
  { id: "translate", label: "翻译", icon: Languages },
  { id: "reading", label: "阅读", icon: Library },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function LearnView() {
  useActivity("在学英语");
  const [tab, setTab] = useState<TabId>("words");
  // 他请求「打开某篇阅读」时用：tab 要切过去，具体哪一篇交给 ReadingTab
  const [readingJump, setReadingJump] = useState<{ index: number; at: number } | null>(null);

  const openPanel = useApp((s) => s.openPanel);
  useEffect(() => {
    if (openPanel?.id !== "learn_reading") return;
    useApp.getState().setPanel(null);
    setTab("reading");
    setReadingJump({ index: openPanel.index ?? 0, at: Date.now() });
  }, [openPanel]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PlayHeader title="英语学习" />
      <div className="px-4">
        <div className="grid grid-cols-3 gap-1 rounded-full bg-chip p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-full py-2 text-[12px] font-medium",
                  tab === t.id ? "bg-elevated text-fg shadow-sm" : "text-muted",
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.9} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-above-nav">
        {tab === "words" && <WordsTab />}
        {tab === "translate" && <TranslateTab />}
        {tab === "reading" && <ReadingTab jump={readingJump} />}
      </div>
    </div>
  );
}

/* ---------------------------------- 单词 ---------------------------------- */

function WordsTab() {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // 读不出来时的原因（设备没装语音包之类），显示出来而不是静默失败
  const [ttsMsg, setTtsMsg] = useState<string | null>(null);
  const customWords = useApp((s) => s.customWords);
  // 他给你加的生词排在最前面
  const list = useMemo(() => [...customWords, ...WORDS], [customWords]);
  const card = list[index % list.length]!;

  // 先把语音包叫醒 —— 否则用户第一次点那个喇叭常常是哑的
  useEffect(() => {
    warmUpVoices();
  }, []);

  function go(delta: number) {
    setFlipped(false);
    setIndex((i) => (i + delta + list.length) % list.length);
  }

  function shuffle() {
    setFlipped(false);
    setIndex(Math.floor(Math.random() * list.length));
  }

  function speak() {
    if (typeof window === "undefined") return;
    // 走 lib/tts：语音包没加载、cancel 抢跑、卡在 paused 都由它处理；
    // 实在读不出来（比如设备没装语音包）就把原因显示出来，别让按钮白点。
    const r = speakText(card.word, { lang: "en-US" });
    setTtsMsg(r.ok ? null : r.reason);
  }

  return (
    <div className="flex flex-col items-center">
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!flipped) useApp.getState().recordWord(card.word);
          setFlipped((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!flipped) useApp.getState().recordWord(card.word);
            setFlipped((v) => !v);
          }
        }}
        className="relative mt-2 w-full max-w-sm cursor-pointer select-none text-left"
      >
        <div
          className="rounded-3xl border border-line bg-surface px-6 py-10 shadow-[var(--aster-shadow)] transition-transform duration-300"
          style={{ minHeight: 220 }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] tracking-wide text-muted">
              {index + 1} / {WORDS.length}
            </span>
            <button
              type="button"
              aria-label="发音"
              onClick={(e) => {
                e.stopPropagation();
                speak();
              }}
              className="flex size-9 items-center justify-center rounded-full bg-chip text-fg"
            >
              <Volume2 className="size-5" strokeWidth={1.7} />
            </button>
          </div>

          {/* 读不出来时如实说，而不是让按钮静默失败 */}
          {ttsMsg && <p className="mt-2 text-right text-[11px] leading-4 text-warn">{ttsMsg}</p>}

          {!flipped ? (
            <div className="mt-6">
              <h2 className="text-3xl font-medium tracking-tight">{card.word}</h2>
              <p className="mt-1 text-sm text-muted">{card.phonetic}</p>
              <p className="mt-1 text-[13px] text-subtle">{card.pos}</p>
              <p className="mt-6 text-[13px] text-subtle">轻点卡片查看释义</p>
            </div>
          ) : (
            <div className="mt-6">
              <p className="text-lg font-medium">{card.meaning}</p>
              <p className="mt-5 text-[15px] leading-6">{card.example}</p>
              <p className="mt-1 text-[13px] text-muted">{card.exampleZh}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          aria-label="上一个"
          onClick={() => go(-1)}
          className="flex size-11 items-center justify-center rounded-full bg-chip text-fg"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          aria-label="随机"
          onClick={shuffle}
          className="flex size-11 items-center justify-center rounded-full bg-chip text-fg"
        >
          <RefreshCw className="size-5" strokeWidth={1.7} />
        </button>
        <button
          type="button"
          aria-label="下一个"
          onClick={() => go(1)}
          className="flex size-11 items-center justify-center rounded-full bg-ink text-ink-fg"
        >
          <ArrowRight className="size-5" />
        </button>
      </div>
      <p className="mt-3 text-[12px] text-subtle">共 {WORDS.length} 词 · 支持发音</p>
    </div>
  );
}

/* ---------------------------------- 翻译 ---------------------------------- */

function TranslateTab() {
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const [en2zh, setEn2zh] = useState(true);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const results = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return DICTIONARY.filter((d) =>
      en2zh ? d.en.includes(q) || q.includes(d.en) : d.zh.includes(q) || q.includes(d.zh),
    );
  }, [text, en2zh]);

  function copy() {
    const joined = results.map((d) => `${d.en} — ${d.zh}`).join("\n");
    if (!joined) return;
    void navigator.clipboard?.writeText(joined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setEn2zh((v) => !v)}
          className="flex items-center gap-2 rounded-full bg-chip px-4 py-2 text-[13px] font-medium"
        >
          <ArrowLeftRight className="size-4" strokeWidth={1.7} />
          {en2zh ? "英 → 中" : "中 → 英"}
        </button>
        <button type="button" onClick={copy} className="text-[13px] text-muted">
          {copied ? "已复制" : "复制结果"}
        </button>
      </div>

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={en2zh ? "输入英文单词或短语…" : "输入中文词语…"}
        className="mt-3 h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none placeholder:text-subtle"
        autoCapitalize="none"
        autoCorrect="off"
      />

      {text.trim() && (
        <ul className="mt-3 space-y-2">
          {results.length === 0 ? (
            <li className="rounded-2xl border border-line bg-surface px-4 py-5 text-center text-sm text-muted">
              词库未收录这个词，可以到「对话」里让{aiName}帮你翻。
            </li>
          ) : (
            results.map((d) => (
              <li
                key={d.en}
                className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3"
              >
                <span className="font-medium">{en2zh ? d.en : d.zh}</span>
                <span className="text-muted">{en2zh ? d.zh : d.en}</span>
              </li>
            ))
          )}
        </ul>
      )}

      <p className="mt-3 text-[12px] leading-5 text-subtle">
        内置常用词库离线匹配；长句翻译建议在「对话」里直接说：把这句话翻成中文。
      </p>
    </div>
  );
}

/* ---------------------------------- 阅读 ---------------------------------- */

function ReadingTab({ jump }: { jump: { index: number; at: number } | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = READINGS.find((r) => r.id === openId);

  // 他挑了一篇
  useEffect(() => {
    if (!jump) return;
    const passage = READINGS[Math.min(Math.max(jump.index, 0), READINGS.length - 1)];
    if (passage) setOpenId(passage.id);
  }, [jump]);

  if (open) {
    return <ReadingDetail passage={open} onBack={() => setOpenId(null)} />;
  }

  return (
    <ul className="space-y-2">
      {READINGS.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => setOpenId(r.id)}
            className="flex w-full items-center justify-between rounded-3xl border border-line bg-surface px-4 py-4 text-left"
          >
            <span>
              <span className="block font-medium">{r.title}</span>
              <span className="mt-0.5 block text-[13px] text-muted">
                阅读 · {r.level}
              </span>
            </span>
            <ArrowRight className="size-5 text-subtle" strokeWidth={1.8} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ReadingDetail({ passage, onBack }: { passage: (typeof READINGS)[number]; onBack: () => void }) {
  const [showZh, setShowZh] = useState(false);
  const paragraphs = passage.en.split(/\n\n+/);
  const zhParagraphs = passage.zh.split(/\n\n+/);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-[13px] text-muted">
          <ChevronLeft className="size-4" />
          全部文章
        </button>
        <button
          type="button"
          onClick={() => setShowZh((v) => !v)}
          className="flex items-center gap-1.5 rounded-full bg-chip px-3.5 py-1.5 text-[13px] font-medium"
        >
          {showZh ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {showZh ? "隐藏译文" : "显示译文"}
        </button>
      </div>

      <div className="rounded-3xl border border-line bg-surface px-5 py-6">
        <p className="text-[12px] tracking-wide text-muted">阅读 · {passage.level}</p>
        <h2 className="mt-1 font-serif text-2xl font-medium">{passage.title}</h2>
        <div className="mt-4 space-y-4">
          {paragraphs.map((p, i) => (
            <div key={i}>
              <p className="text-[15px] leading-7">{p}</p>
              {showZh && <p className="mt-2 text-[14px] leading-6 text-muted">{zhParagraphs[i]}</p>}
            </div>
          ))}
        </div>
        {showZh && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-[12px] text-muted">重点词汇</p>
            <div className="flex flex-wrap gap-2">
              {passage.glossary.map((g) => (
                <span key={g.w} className="rounded-full bg-chip px-3 py-1 text-[12px]">
                  {g.w} <span className="text-muted">· {g.zh}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}