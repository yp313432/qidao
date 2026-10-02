import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  Ghost,
  Menu,
  Mic,
  Paperclip,
  Pause,
  Pin,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { prettySize } from "@/lib/attachments";
import { Avatar } from "@/components/avatar";
import { Markdown } from "@/components/markdown";
import { Composer } from "@/components/chat/composer";
import { MessageActions } from "@/components/chat/message-actions";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { resolveAiName } from "@/lib/branding";
import { greetingFor } from "@/lib/greeting";
import { useApp } from "@/lib/store";
import type { Attachment } from "@/lib/types";
import { useChatStream } from "@/lib/use-chat";
import { useActivity } from "@/lib/use-activity";
import { MAIN_TABS } from "@/lib/tabs";
import { chatFontPx } from "@/lib/ux";
import { cn, formatClock } from "@/lib/utils";

export function ChatView() {
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeId);
  const settings = useApp((s) => s.settings);
  const model = useApp((s) => s.model);
  const [menu, setMenu] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const conv = conversations.find((c) => c.id === activeId) ?? null;
  const empty = !conv || conv.messages.length === 0;
  const aiName = resolveAiName(settings.aiName);
  const hydrated = useApp((s) => s.hydrated);
  // 发送逻辑与语音页共用（见 lib/use-chat.ts）
  const { busy, liveId, send, regenerate } = useChatStream();

  // 感知层：告诉 AI 你此刻在干什么（上一条活动会留在轨迹里）
  useActivity("在和你聊天", conv?.title ?? "新对话");

  // 他请求「打开对话列表」时，落到这一页
  const openPanel = useApp((s) => s.openPanel);
  useEffect(() => {
    if (openPanel?.id !== "chat_drawer") return;
    useApp.getState().setPanel(null);
    setMenu(true);
  }, [openPanel]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [conv?.messages, liveId]);

  /** 翻上去超过一屏半就浮出「回到最新」 */
  const [showJump, setShowJump] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJump(gap > 420);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [conv?.id]);

  /**
   * 对话内搜索。
   *
   * 用户："对话长了，最上面的消息不好翻了…塞一个简单的信息翻找"。
   * 做法：搜正文 + 思考过程，命中数显示成 i/N，上下键逐条跳，
   * 跳过去的那条闪一下（不然不知道跳到哪了）。
   */
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hitIndex, setHitIndex] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !conv) return [] as string[];
    return conv.messages
      .filter((m) => `${m.content}\n${m.thinking}`.toLowerCase().includes(q))
      .map((m) => m.id);
  }, [query, conv]);
  const hitKey = hits.join(",");

  /** 命中集合或游标一变，就滚过去并闪一下 */
  useEffect(() => {
    if (!hitKey) {
      setFlashId(null);
      return;
    }
    const ids = hitKey.split(",");
    const id = ids[Math.min(hitIndex, ids.length - 1)]!;
    const el = document.getElementById(`msg-${id}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(id);
    const timer = window.setTimeout(() => setFlashId(null), 1700);
    return () => window.clearTimeout(timer);
  }, [hitKey, hitIndex]);

  // 换关键词时游标回到第一条
  useEffect(() => {
    setHitIndex(0);
  }, [query]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          aria-label="对话列表"
          className="flex size-11 items-center justify-center"
          onClick={() => setMenu(true)}
        >
          <Menu className="size-6" strokeWidth={1.6} />
        </button>
        <div className="flex items-center">
          <button
            type="button"
            aria-label="搜索对话内容"
            className="flex size-11 items-center justify-center"
            onClick={() => {
              setFindOpen((v) => !v);
              if (findOpen) {
                setQuery("");
                setFlashId(null);
              }
            }}
          >
            <Search className="size-5" strokeWidth={1.7} />
          </button>
          <button
            type="button"
            aria-label="语音模式"
            className="flex size-11 items-center justify-center"
            onClick={() => void navigate({ to: "/voice" })}
          >
            <Mic className="size-6" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            aria-label="临时对话"
            className="flex size-11 items-center justify-center"
            onClick={() => useApp.getState().newChat({ incognito: true })}
          >
            <Ghost className="size-6" strokeWidth={1.6} />
          </button>
        </div>
      </header>

      {/* 搜索条：命中数 + 上下切换（像浏览器里那个 2/2） */}
      {findOpen && (
        <div className="flex items-center gap-2 px-4 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-chip px-3">
            <Search className="size-3.5 shrink-0 text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits.length > 0) {
                  setHitIndex((i) => (i + 1) % hits.length);
                }
                if (e.key === "Escape") setFindOpen(false);
              }}
              placeholder="在这段对话里找…（正文和思考过程都搜）"
              className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
            {query.trim() && (
              <span className="shrink-0 text-[11px] text-muted" suppressHydrationWarning>
                {hits.length === 0 ? "没找到" : `${Math.min(hitIndex + 1, hits.length)}/${hits.length}`}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="上一条"
            disabled={hits.length === 0}
            onClick={() => setHitIndex((i) => (i - 1 + hits.length) % Math.max(1, hits.length))}
            className="flex size-9 items-center justify-center rounded-full bg-chip disabled:opacity-35"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            aria-label="下一条"
            disabled={hits.length === 0}
            onClick={() => setHitIndex((i) => (i + 1) % Math.max(1, hits.length))}
            className="flex size-9 items-center justify-center rounded-full bg-chip disabled:opacity-35"
          >
            <ChevronDown className="size-4" />
          </button>
          <button
            type="button"
            aria-label="关闭搜索"
            onClick={() => {
              setFindOpen(false);
              setQuery("");
              setFlashId(null);
            }}
            className="flex size-9 items-center justify-center rounded-full bg-chip"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* 临时对话不在抽屉里，所以这里必须给一条明确的退路 */}
      {conv?.incognito && (
        <div className="mx-4 mt-1 flex items-center gap-2.5 rounded-2xl border border-line bg-chip px-3.5 py-2.5">
          <Ghost className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 text-[11px] leading-4 text-muted">
            临时对话 · 不写进本地记录，也不出现在对话列表
          </span>
          <button
            type="button"
            onClick={() => useApp.getState().exitIncognito()}
            className="shrink-0 rounded-full bg-surface px-3.5 py-1.5 text-[12px] font-medium text-fg"
          >
            退出
          </button>
        </div>
      )}

      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
          <Avatar role="ai" size={48} />
          <h1 className="mt-6 font-serif text-[1.85rem] font-medium tracking-tight text-fg">
            {/* 问候语按「现在是几点」算 —— 服务端和客户端算出来可能不同
                （部署到 UTC 服务器时必然不同），所以挂载后再显示。 */}
            {hydrated ? greetingFor(settings.displayName) : "\u00A0"}
          </h1>
          {conv?.incognito && (
            <p className="mt-2 text-sm text-muted">临时对话不会写入本地记录</p>
          )}
        </div>
      ) : (
        /**
         * 消息区外面包一层 relative：这样「回到最新」按钮能贴在这块区域的底部
         * （= 输入框上方），而不是飘到输入框上面去压住它。
         */
        <div className="relative min-h-0 flex-1">
          <div ref={scroller} className="h-full overflow-y-auto">
            <ol
              className="space-y-5 px-5 py-4 pb-8"
              style={{ fontSize: `${chatFontPx(settings.chatFontSize)}px` }}
            >
            {conv!.messages.map((m) => {
              const mine = m.role === "user";
              const streaming = liveId === m.id;
              return (
                <li
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={cn(
                    "flex gap-2.5 rounded-3xl transition",
                    mine ? "flex-row-reverse" : "flex-row",
                    // 搜索跳过来的那条闪一圈，不然不知道跳到哪了
                    flashId === m.id && "aster-highlight",
                  )}
                >
                  <Avatar role={mine ? "user" : "ai"} size={30} className="mt-0.5" />

                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "mb-1 flex items-baseline gap-2",
                        mine && "flex-row-reverse",
                      )}
                    >
                      <span className="text-[13px] font-medium text-fg">
                        {mine ? settings.displayName : aiName}
                      </span>
                      {m.scheduled && (
                        <span className="rounded-full bg-chip px-1.5 py-0.5 text-[10px] text-muted">
                          定时 · 他自己说的
                        </span>
                      )}
                      <span className="text-[11px] text-subtle">{formatClock(m.createdAt)}</span>
                    </div>

                    {mine ? (
                      <div className={cn("flex", "justify-end")}>
                        <div className="max-w-[86%] space-y-1.5 rounded-2xl bg-chip px-3.5 py-2.5 text-[1em] leading-[1.7]">
                          {m.attachments?.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {m.attachments.map((a) =>
                                a.kind === "audio" && a.dataUrl ? (
                                  <VoiceBubble key={a.id} att={a} />
                                ) : a.dataUrl ? (
                                  <img
                                    key={a.id}
                                    src={a.dataUrl}
                                    alt={a.name}
                                    className={cn(
                                      "rounded-xl object-contain",
                                      // 表情固定尺寸；普通图片给小图一个最小可见尺寸
                                      a.kind === "sticker"
                                        ? "size-24"
                                        : "max-h-56 min-h-16 w-auto min-w-16 max-w-full",
                                    )}
                                  />
                                ) : (
                                  <span
                                    key={a.id}
                                    className="flex items-center gap-1.5 rounded-xl bg-surface px-2.5 py-1.5 text-[12px]"
                                  >
                                    <Paperclip className="size-3.5 text-muted" />
                                    <span className="max-w-40 truncate">{a.name}</span>
                                    <span className="text-[10px] text-subtle">
                                      {a.text ? "已读正文" : prettySize(a.size)}
                                    </span>
                                  </span>
                                ),
                              )}
                            </div>
                          ) : null}
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        {/* 思考链跟气泡用**同一个宽度上限**，否则右边缘对不齐
                            （用户画了红线指出来的） */}
                        {(streaming || (settings.showThinking && m.thinking)) && (
                          <div className="max-w-[86%]">
                            <ThinkingBlock
                              thinking={m.thinking}
                              durationMs={m.thinkingDurationMs}
                              live={streaming && !m.content}
                            />
                          </div>
                        )}
                        {/* 他的回复也用气泡 —— 跟用户那条同一个尺寸和圆角，
                            差别只在左右与一条细边框，一眼能分出谁说的。 */}
                        {m.content ? (
                          <div className="max-w-[86%] space-y-1.5 rounded-2xl border border-line bg-chip px-3.5 py-2.5 text-[1em] leading-[1.7]">
                            <Markdown text={m.content} />
                          </div>
                        ) : streaming ? (
                          <p className="thinking-shimmer text-sm">正在写回复…</p>
                        ) : null}
                        {m.content && !streaming && (
                          <MessageActions
                            content={m.content}
                            feedback={m.feedback}
                            busy={busy}
                            saved={m.savedToDocs}
                            onFeedback={(fb) =>
                              useApp.getState().patchMessage(conv!.id, m.id, {
                                feedback: m.feedback === fb ? undefined : fb,
                              })
                            }
                            onRegenerate={() => void regenerate(m.id)}
                            onSaveDoc={() => {
                              useApp.getState().saveDoc({
                                title: conv!.title,
                                content: m.thinking
                                  ? `## 思考\n\n${m.thinking}\n\n## 回复\n\n${m.content}`
                                  : m.content,
                                source: "chat",
                                conversationId: conv!.id,
                              });
                              useApp.getState().markSavedToDocs(conv!.id, m.id);
                            }}
                          />
                        )}
                        {m.usage && (m.usage.prompt || m.usage.completion) && (
                          <p className="mt-1 px-1 text-[10px] text-subtle">
                            {m.usage.prompt ? `输入 ${m.usage.prompt}` : ""}
                            {m.usage.completion ? ` · 输出 ${m.usage.completion}` : ""}
                            {typeof m.usage.cached === "number" && m.usage.cached > 0
                              ? ` · 缓存命中 ${m.usage.cached}`
                              : ""}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
            </ol>
          </div>

          {/* 长对话翻上去之后，回到底部要有一键（用户："最上面的消息不好翻"）。
              贴在消息区底部 = 输入框上方，不会压住输入框。 */}
          {showJump && (
            <button
              type="button"
              onClick={() => {
                const el = scroller.current;
                el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
              }}
              className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-line bg-surface/92 px-3.5 py-2 text-[12px] text-fg shadow-sm backdrop-blur"
            >
              ↓ 回到最新
            </button>
          )}
        </div>
      )}

      <Composer onSend={send} disabled={busy} streaming={busy} />

      {menu && (
        <div className="fixed inset-0 z-40 flex">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 bg-fg/20"
            onClick={() => setMenu(false)}
          />
          <aside className="glass-panel relative z-10 flex h-full w-[84%] max-w-sm flex-col pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="flex items-center justify-between px-4 pb-3">
              <p className="font-serif text-lg">对话</p>
              <button type="button" aria-label="关闭" onClick={() => setMenu(false)} className="size-10">
                <X className="size-5" />
              </button>
            </div>
            <button
              type="button"
              className="mx-4 mb-3 flex items-center gap-2 rounded-full bg-chip px-4 py-3 text-sm font-medium"
              onClick={() => {
                useApp.getState().newChat();
                setMenu(false);
              }}
            >
              <Plus className="size-4" />
              新对话
            </button>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {conversations.filter((c) => !c.incognito).length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-muted">还没有保存的对话</li>
              )}
              {conversations
                .filter((c) => !c.incognito)
                .slice()
                .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
                .map((c) => (
                  <li key={c.id}>
                    <div
                      className={cn(
                        "flex items-center gap-1 rounded-full border border-line bg-chip py-0.5 pr-1 pl-6",
                        c.id === activeId && "glass-active",
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate py-3 text-left text-sm"
                        onClick={() => {
                          useApp.getState().setActive(c.id);
                          setMenu(false);
                        }}
                      >
                        <span className="font-medium">{c.title}</span>
                        <span className="text-muted">
                          {" · "}
                          {c.messages.at(-1)?.content.slice(0, 24) || "空对话"}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="置顶"
                        className="size-9 text-muted"
                        onClick={() => useApp.getState().pinChat(c.id)}
                      >
                        <Pin className={cn("mx-auto size-4", c.pinned && "text-accent")} />
                      </button>
                      <button
                        type="button"
                        aria-label="删除"
                        className="size-9 text-muted"
                        onClick={() => useApp.getState().deleteChat(c.id)}
                      >
                        <Trash2 className="mx-auto size-4" />
                      </button>
                    </div>
                  </li>
                ))}
            </ul>

            {/* 导航搬进抽屉底部（用户："上面留对话列表，下面显示导航栏"）
                —— 有了它，聊天页的漂浮导航就能撤掉，消息区多出 76px ✅ */}
            <nav
              aria-label="主导航（抽屉）"
              className="mt-auto flex items-center gap-1 border-t border-line px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            >
              {MAIN_TABS.map((tab) => {
                const Icon = tab.icon;
                const active =
                  tab.to === "/" ? pathname === "/" : pathname === tab.to || pathname.startsWith(`${tab.to}/`);
                return (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    onClick={() => setMenu(false)}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-1 rounded-2xl py-2",
                      active ? "text-fg" : "text-muted",
                    )}
                  >
                    <Icon className="size-5" strokeWidth={1.7} />
                    <span className="text-[11px]">{tab.label}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}
    </div>
  );
}


/** 语音消息气泡：放的是真录音，不是合成音。 */
function VoiceBubble({ att }: { att: Attachment }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const secs = Math.max(1, Math.round((att.durationMs ?? 0) / 1000));

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (playing) el.pause();
    else void el.play().catch(() => setPlaying(false));
  }

  return (
    <span className="flex max-w-full items-center gap-2.5 rounded-2xl bg-surface px-3 py-2">
      <audio
        ref={ref}
        src={att.dataUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          // MediaRecorder 录出来的 webm 不带时长元数据，el.duration 会是 Infinity；
          // 拿它当分母进度条永远不动 —— 用我们录的时候自己量的秒数。
          const total = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : secs;
          setProgress(Math.min(1, el.currentTime / total));
        }}
        className="hidden"
      />
      <button
        type="button"
        aria-label={playing ? "暂停语音" : "播放语音"}
        onClick={toggle}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-ink-fg"
      >
        {playing ? (
          <Pause className="size-3.5 fill-current" />
        ) : (
          <Play className="size-3.5 fill-current" />
        )}
      </button>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1">
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "w-0.5 rounded-full transition-colors",
                i / 14 <= progress ? "bg-accent" : "bg-fg/25",
              )}
              style={{ height: `${6 + ((i * 7) % 13)}px` }}
            />
          ))}
        </span>
        <span className="text-[10px] text-muted">
          {secs} 秒{att.text ? " · 已转成文字，他看得懂" : " · 没转成文字，他只能看到提示"}
        </span>
      </span>
    </span>
  );
}
