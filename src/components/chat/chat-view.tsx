import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
import { ThinkingSheet } from "@/components/chat/thinking-sheet";
import { ToolProcess } from "@/components/chat/tool-process";
import { SummaryLine } from "@/components/chat/summary-line";
import { Ticker } from "@/components/chat/ticker";
import { DrawerSky, DrawerCosmos } from "@/components/chat/drawer-decor";
import { resolveAiName } from "@/lib/branding";
import { greetingFor } from "@/lib/greeting";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";
import type { Attachment } from "@/lib/types";
import { useChatStream } from "@/lib/use-chat";
import { useActivity } from "@/lib/use-activity";
import { chatFontPx } from "@/lib/ux";
import { cn, formatClock } from "@/lib/utils";

export function ChatView() {
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeId);
  const settings = useApp((s) => s.settings);
  const model = useApp((s) => s.model);
  const [menu, setMenu] = useState(false);
  /** 底部弹出的思考链（Claude 那种一层）—— null 表示没打开 */
  const [thinkSheet, setThinkSheet] = useState<{
    text: string;
    ms?: number;
    live?: boolean;
  } | null>(null);
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const conv = conversations.find((c) => c.id === activeId) ?? null;
  const empty = !conv || conv.messages.length === 0;
  const aiName = resolveAiName(settings.aiName);
  const hydrated = useApp((s) => s.hydrated);
  // 发送逻辑与语音页共用（见 lib/use-chat.ts）
  const { busy, liveId, step, send, regenerate } = useChatStream();
  // 感知层：告诉 AI 你此刻在干什么（上一条活动会留在轨迹里）
  useActivity("在和你聊天", conv?.title ?? "新对话");

  /*
    「他现在知道什么」——原来这句在 Composer（对话框里）占一行，
    现在挪到**顶部栏**（用户要求："不要放在对话框占地方"）。
    所以订阅提到这一层来，因为顶部栏在 ChatView 里。
  */
  const activity = useApp((s) => s.activity);
  const nowPlaying = usePlayer((s) => {
    const t = s.tracks.find((x) => x.id === s.currentId);
    return t ? `${t.name}${s.playing ? " · 播放中" : " · 暂停"}` : "";
  });

  // 他请求「打开对话列表」时，落到这一页
  const openPanel = useApp((s) => s.openPanel);
  useEffect(() => {
    if (openPanel?.id !== "chat_drawer") return;
    useApp.getState().setPanel(null);
    setMenu(true);
  }, [openPanel]);

  // 抽屉打开时把底部导航收起来（用户在抽屉里选完会关抽屉，导航就回来）
  useEffect(() => {
    const root = document.documentElement;
    if (menu) root.dataset.drawerOpen = "1";
    else delete root.dataset.drawerOpen;
    return () => {
      delete root.dataset.drawerOpen;
    };
  }, [menu]);

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
      <header className="flex items-center gap-1 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          aria-label="对话列表"
          className="flex size-11 shrink-0 items-center justify-center"
          onClick={() => setMenu(true)}
        >
          <Menu className="size-6" strokeWidth={1.6} />
        </button>

        {/*
          「他现在知道什么」挪到**顶部栏中间**了。
          用户："把小克现在知道那行字挪到顶边栏吧，不要放在对话框占地方
                这样显得界面更宽阔一点"
          放不下就自己往左滚（Ticker），不用点。
        */}
        {(activity || nowPlaying) && (
          <Ticker
            className="min-w-0 flex-1 px-1"
            prefix={`${aiName} 知道`}
            text={`${activity ? `${activity.label}${activity.detail ? ` · ${activity.detail}` : ""}` : ""}${
              nowPlaying ? `${activity ? " · " : ""}正在听 ${nowPlaying}` : ""
            }`}
          />
        )}

        <div className="flex shrink-0 items-center">
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
            {/*
              px-2（原来 px-5）：用户说气泡"缩在中间看着太局促"，要求往两边展开。
              实测（屏宽 390）：
                px-5   + max-w-[86%] → 他的气泡只占屏宽 79%，右边距 27px
                px-2   + max-w-[99%] → 他的气泡占满内容列（左右差 0/3px），右边距 10px
              注意：**我的气泡窄是因为我字少**（气泡宽度跟着文字走），不是被挤住了。
            */}
            <ol
              className="space-y-5 px-2 py-4 pb-8"
              style={{ fontSize: `${chatFontPx(settings.chatFontSize)}px` }}
            >
            {/* 「更早的对话（摘要）」那条线 —— 只在这条对话真有摘要时出现（P4b） */}
            <SummaryLine conversationId={conv!.id} />
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
                    {/*
                      名字 + 时间那一行。
                      用户那侧要**整体靠右**，所以用 justify-end。
                      ⚠️ 不能同时写 flex-row-reverse —— 它会把主轴翻过去，
                         justify-end 于是又变回"靠左"，两者互相抵消（我踩过）。
                      名字在 DOM 里的顺序本来就是「名字、时间」，用 justify 控制位置就够了。
                    */}
                    <div
                      className={cn(
                        "mb-1 flex items-baseline gap-2",
                        mine ? "justify-end" : "justify-start",
                      )}
                    >
                      <span className="text-[13px] font-medium text-fg">
                        {mine ? settings.displayName : aiName}
                      </span>
                      {/*
                        来源徽章：定时任务和主动唤醒**共用** `scheduled` 这个标记，
                        所以要看 `origin` 分开说（用户要求）：
                          · origin === "wake" → 「他主动说的」
                          · 其余（"cron" 或老消息没这个字段）→ 「定时 · 他自己说的」
                        ⚠️ 老消息没有 origin，必须保持原样显示，不能因为"读不到来源"就不显示。
                      */}
                      {m.scheduled && (
                        <span className="rounded-full bg-chip px-1.5 py-0.5 text-[10px] text-muted">
                          {m.origin === "wake" ? "他主动说的" : "定时 · 他自己说的"}
                        </span>
                      )}
                      <span className="text-[11px] text-subtle">{formatClock(m.createdAt)}</span>
                    </div>

                    {mine ? (
                      <div className={cn("flex", "justify-end")}>
                        <div className="max-w-[99%] space-y-1.5 rounded-2xl bg-chip px-3.5 py-2.5 text-[1em] leading-[1.7]">
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
                        {/*
                          ⭐ agent loop 的进度：他现在走到第几步、正在执行哪个动作。
                          用户原话："这一轮我发出动作，成没成，要等下一轮结果回来才知道；
                          这一轮里我完全看不见。" —— 这一行 + 下面的「动手 N 次」明细
                          就是让他**在同一轮里**看得见。
                        */}
                        {streaming && step && (
                          <p className="mb-1.5 flex items-center gap-1.5 rounded-full bg-chip px-3 py-1 text-[11px] text-muted">
                            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                            {step.label}
                          </p>
                        )}
                        {/* 思考链不再占正文的地方 —— 点开从**底部弹一层**（Claude 那种）
                            （用户："改成 Claude 那种思考链，点开是从下面弹出来的那种，单独一层"） */}
                        {(streaming || (settings.showThinking && m.thinking)) && (
                          <button
                            type="button"
                            onClick={() =>
                              setThinkSheet({
                                text: m.thinking,
                                ms: m.thinkingDurationMs,
                                live: Boolean(streaming && !m.content),
                              })
                            }
                            className="mb-1.5 flex items-center gap-1.5 rounded-full bg-chip px-3 py-1 text-[11px] text-muted"
                          >
                            {streaming && !m.content ? "正在思考…" : "已思考"}
                            {m.thinkingDurationMs && !streaming ? (
                              <span className="text-subtle">
                                （{Math.max(1, Math.round(m.thinkingDurationMs / 1000))} 秒）
                              </span>
                            ) : null}
                            <span className="text-subtle">点开看</span>
                          </button>
                        )}
                        {/* 弹层本身挂在页面根节点（见文件下方 <ThinkingSheet>）——
                            原来写在 messages.map 里面，每条消息挂一个全屏浮层，
                            既冗余又容易被消息区的滚动/重渲染带歪。 */}
                        {/* 他的回复也用气泡 —— 跟用户那条同一个尺寸和圆角，
                            差别只在左右与一条细边框，一眼能分出谁说的。 */}
                        {m.content ? (
                          <div className="max-w-[99%] space-y-1.5 rounded-2xl border border-line bg-chip px-3.5 py-2.5 text-[1em] leading-[1.7]">
                            <Markdown text={m.content} />
                          </div>
                        ) : streaming ? (
                          <p className="thinking-shimmer text-sm">正在写回复…</p>
                        ) : null}
                        {/*
                          他这一轮真的动过手（原生 tools 的记录）—— 如实摆出来，失败不美化。
                          ⚠️ 不再要求 `!streaming`：每一步的结果**当场**就写进消息了
                          （见 use-chat 的 onRound），流式期间当然也要看得见 ——
                          这正是"执行结果那一栏永远有回话"。
                        */}
                        {m.rounds && m.rounds.length > 0 && <ToolProcess rounds={m.rounds} />}
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
                            {/*
                              缓存显示成**命中率**（用户："改成缓存命中率，
                              比如百分之多少，方便好看一点，不然我还得自己计算"）。
                              分母用输入 token —— 缓存本来就是"输入里有多少被命中了"。
                            */}
                            {typeof m.usage.cached === "number" &&
                            m.usage.cached > 0 &&
                            m.usage.prompt
                              ? ` · 缓存命中率 ${Math.round((m.usage.cached / m.usage.prompt) * 100)}%`
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

      {/* 思考链弹层：整个页面**只挂这一个**，内容跟着被点开的那条消息走 */}
      <ThinkingSheet
        open={thinkSheet !== null}
        text={thinkSheet?.text ?? ""}
        durationMs={thinkSheet?.ms}
        live={thinkSheet?.live}
        onClose={() => setThinkSheet(null)}
      />

      {menu && (
        /*
          抽屉 z-50。底部导航 z-[60] 比它高，但抽屉打开时**要把导航收起来** ——
          用户反馈："展开对话列表，导航栏就不留了吧，看看这怪怪的"
          （导航横在抽屉下沿，抽屉的圆角跟它叠在一起确实别扭）。
          做法：在 <html> 上挂 data-drawer-open，由 CSS 把导航藏掉。
          这样不用把 menu 状态提到 AppShell，也不用每帧重渲染。
        */
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 bg-fg/20"
            onClick={() => setMenu(false)}
          />
          <aside className="glass-panel relative z-10 flex h-full w-[84%] max-w-sm flex-col pt-[max(0.75rem,env(safe-area-inset-top))]">
            {/* 上：整片星野铺在抽屉顶部（标题和按钮浮在它上面）。
                用户："上面那个从顶部开始，不是从我画的框开始" */}
            <DrawerSky />

            <div className="relative z-10 flex items-center justify-between px-4 pb-3">
              <p className="font-serif text-lg">对话</p>
              <button type="button" aria-label="关闭" onClick={() => setMenu(false)} className="size-10">
                <X className="size-5" />
              </button>
            </div>
            <button
              type="button"
              className="relative z-10 mx-4 mb-1 flex items-center gap-2 rounded-full bg-chip px-4 py-3 text-sm font-medium"
              onClick={() => {
                useApp.getState().newChat();
                setMenu(false);
              }}
            >
              <Plus className="size-4" />
              新对话
            </button>

            <ul className="relative z-10 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pt-1">
              {conversations.filter((c) => !c.incognito).length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-muted">还没有保存的对话</li>
              )}
              {conversations
                .filter((c) => !c.incognito)
                .slice()
                .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
                .map((c) => (
                  <li key={c.id}>
                    {/*
                      对话条目：用户反馈"这一整个大方块，改成柔和一点，带着边框，
                      上下留白一些，材质要统一"。
                      · 圆角从 rounded-full（整条胶囊，太"实"）收到 rounded-2xl
                      · 补一条 border-line 边框 —— 跟 App 里其它卡片同一套材质
                      · 左右内边距对称（原来左边 pl-6、右边 pr-1，文字被挤在左边）
                      · 上下用 space-y-2.5 留白，不再一条贴一条
                    */}
                    <div
                      className={cn(
                        "flex items-center gap-0.5 rounded-2xl border border-line bg-chip py-1 pr-0.5 pl-3.5",
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

            {/*
              下：小宇宙（带星环的行星 + 小卫星 + 碎钻粒子），跟上面的星月呼应。
              · 这里原来是给底部导航让位的留白（h-[4.5rem]）——
                但抽屉一打开导航就收走了，那段留白只是空着，显得像"大方块"，
                所以让装饰接管它
              · 用户："下面……不要有线，看着割裂" → 去掉那条分隔线
            */}
            <DrawerCosmos />
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
