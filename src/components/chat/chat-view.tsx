import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Ghost, Menu, Mic, Paperclip, Pause, Pin, Play, Plus, Trash2, X } from "lucide-react";
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
import { cn, formatClock } from "@/lib/utils";

export function ChatView() {
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeId);
  const settings = useApp((s) => s.settings);
  const model = useApp((s) => s.model);
  const [menu, setMenu] = useState(false);
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
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <ol className="space-y-5 px-4 py-4 pb-8">
            {conv!.messages.map((m) => {
              const mine = m.role === "user";
              const streaming = liveId === m.id;
              return (
                <li
                  key={m.id}
                  className={cn("flex gap-2.5", mine ? "flex-row-reverse" : "flex-row")}
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
                      <span className="text-[11px] text-subtle">{formatClock(m.createdAt)}</span>
                    </div>

                    {mine ? (
                      <div className={cn("flex", "justify-end")}>
                        <div className="max-w-[88%] space-y-1.5 rounded-2xl bg-chip px-3.5 py-2.5 text-[15px] leading-6">
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
                        {(streaming || (settings.showThinking && m.thinking)) && (
                          <ThinkingBlock
                            thinking={m.thinking}
                            durationMs={m.thinkingDurationMs}
                            live={streaming && !m.content}
                          />
                        )}
                        {m.content ? (
                          <Markdown text={m.content} />
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
