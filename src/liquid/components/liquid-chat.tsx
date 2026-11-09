import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Ghost,
  Mic,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Smile,
  X,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Avatar } from "@/components/shared/avatar";
import { Markdown } from "@/components/shared/markdown";
import { ThinkingSheet } from "@/components/chat/thinking-sheet";
import { Ticker } from "@/components/chat/ticker";
import { LiquidDrawer } from "@/liquid/components/liquid-drawer";
import { LiquidSettings } from "@/liquid/components/liquid-settings";
import { useLiquidShell } from "@/liquid/lib/drawer-state";
import { stripInvisible } from "@/lib/segment";
import { useApp } from "@/lib/store";
import { useChatStream } from "@/lib/use-chat";
import type { ChatMessage, ChatStep } from "@/lib/types";

/**
 * 液态对话页。**结构和交互照纯色**，只换壳
 * （用户 m07832 / m07934："我没说要改的，就和纯色一样懂吗"）。
 *
 * 与 `src/components/chat/chat-view.tsx` 的对应关系：
 *   740-843   顶栏：目录符 / 「讯」+ 电讯行 / 搜索 / 语音 / 临时对话
 *   846-880   搜索条：命中数 + 上下切换
 *   1014-1064 消息头：头像(26) + 名字 + 状态胶囊 + 时间
 *   1286-1309 思考入口：细竖线 +「想了 N 秒」→ 底部弹层
 *   1443-1474 用量行：输入（工具）· 输出 · 缓存命中率
 *   1481-1540 长按菜单：引用这一句 / 复制 / 修改 / 重新生成
 *   388       引用条
 * 纯色没有的（用户点名删的）：底部导航栏。
 *
 * 数据一律走真实 store（`conversations` / `activeId`）与 `useChatStream().send`，
 * 不再是预览用的种子消息 —— 用户 m08214："OK可以接吧，就把之前那些东西放到现在该放的位置"。
 */

const WIRE = "你说的、他记得的、还没做完的，都在这里";

function clockOf(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

/** 用量行：输入（工具）· 输出 · 缓存命中率（照纯色 `chat-view.tsx:1443-1474`） */
function usageLine(usage: ChatMessage["usage"]) {
  if (!usage) return "";
  const out: string[] = [];
  if (usage.prompt) {
    out.push(`输入 ${usage.prompt}${usage.tools ? `（工具 ${usage.tools}）` : ""}`);
  }
  if (usage.completion) out.push(`输出 ${usage.completion}`);
  if (usage.cached && usage.prompt) {
    out.push(`缓存命中率 ${Math.round((usage.cached / usage.prompt) * 100)}%`);
  }
  return out.join(" · ");
}

export function LiquidChat() {
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeId);
  const settings = useApp((s) => s.settings);
  const conv = conversations.find((c) => c.id === activeId) ?? conversations[0];
  const messages = conv?.messages ?? [];
  const { busy, liveId, send, regenerate } = useChatStream();

  const [draft, setDraft] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [menu, setMenu] = useState<ChatMessage | null>(null);
  const [think, setThink] = useState<{
    text: string;
    ms?: number;
    steps?: ChatStep[];
    live?: boolean;
  } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const [thinkOpen, setThinkOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const aiName = settings.aiName || "小克";
  const myName = settings.displayName || "我";
  const { setOpen } = useLiquidShell();
  const navigate = useNavigate();

  const matched = query
    ? messages.filter((m) => stripInvisible(m.content ?? "").includes(query))
    : [];
  const current = matched.length ? matched[Math.min(hit, matched.length - 1)] : null;

  useEffect(() => {
    setHit(0);
  }, [query]);

  useEffect(() => {
    if (!current) return;
    const node = document.getElementById(`lq-msg-${current.id}`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current]);

  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const startPress = (message: ChatMessage) => {
    clearPress();
    pressTimer.current = window.setTimeout(() => setMenu(message), 480);
  };

  const doSend = () => {
    const text = draft.trim();
    if (!text || busy) return;
    const body = quote ? `> 引用：${quote}\n\n${text}` : text;
    setDraft("");
    setQuote(null);
    void send(body);
  };

  return (
    <>
      <main className="lq-page">
        <header className="lq-top">
          <button
            type="button"
            className="lq-ico lq-glass lq-glass--chip"
            aria-label="对话列表"
            onClick={() => setOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 8h16" />
              <path d="M4 14h11" />
              <path d="M4 20h6" />
            </svg>
          </button>

          <div className="lq-top__wire">
            <span className="lq-stamp">讯</span>
            <Ticker prefix={`${aiName} 知道`} text={WIRE} />
          </div>

          <button
            type="button"
            className="lq-ico lq-glass lq-glass--chip"
            aria-label="搜索"
            onClick={() => setFindOpen((v) => !v)}
          >
            <Search />
          </button>
          <button
            type="button"
            className="lq-ico lq-glass lq-glass--chip"
            aria-label="语音"
            onClick={() => void navigate({ to: "/voice" })}
          >
            <Mic />
          </button>
          <button
            type="button"
            className="lq-ico lq-glass lq-glass--chip"
            aria-label="临时对话"
            onClick={() => useApp.getState().newChat({ incognito: true })}
          >
            <Ghost />
          </button>
        </header>

        {findOpen ? (
          <div className="lq-find">
            <div className="lq-find__box">
              <Search />
              <input
                className="lq-find__input"
                placeholder="在对话里找…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <span className="lq-find__count">
              {matched.length ? `${Math.min(hit + 1, matched.length)}/${matched.length}` : "0/0"}
            </span>
            <button
              type="button"
              className="lq-find__nav"
              aria-label="上一处"
              onClick={() => setHit((v) => (v - 1 + matched.length) % Math.max(1, matched.length))}
            >
              <ChevronUp />
            </button>
            <button
              type="button"
              className="lq-find__nav"
              aria-label="下一处"
              onClick={() => setHit((v) => (v + 1) % Math.max(1, matched.length))}
            >
              <ChevronDown />
            </button>
            <button
              type="button"
              className="lq-ico"
              aria-label="收起搜索"
              onClick={() => {
                setFindOpen(false);
                setQuery("");
              }}
            >
              <X />
            </button>
          </div>
        ) : null}

        <div className="lq-thread">
          <ul className="lq-thread__list">
            {messages.length === 0 ? (
              <li className="lq-empty">还没有开口。{aiName}在这儿。</li>
            ) : null}

            {messages.map((message) => {
              const mine = message.role === "user";
              const text = stripInvisible(message.content ?? "");
              const streaming = liveId === message.id;
              if (!mine && !text && !streaming) return null;
              const thinkingMs = message.thinkingDurationMs || 0;
              const usage = usageLine(message.usage);
              return (
                <li
                  key={message.id}
                  id={`lq-msg-${message.id}`}
                  className="lq-msg"
                  data-mine={mine}
                >
                  <div className="lq-msg__head">
                    {mine ? (
                      <>
                        <span className="lq-msg__time">{clockOf(message.createdAt)}</span>
                        <span className="lq-msg__name">{myName}</span>
                        <Avatar role="user" size={26} />
                      </>
                    ) : (
                      <>
                        <Avatar role="ai" size={26} />
                        <span className="lq-msg__name">{aiName}</span>
                        <span className="lq-msg__time">{clockOf(message.createdAt)}</span>
                      </>
                    )}
                  </div>

                  {!mine && (message.thinking || streaming) ? (
                    <button
                      type="button"
                      className="lq-proc"
                      onClick={() => {
                        setThink({
                          text: message.thinking || "他在想，但这次没留下过程。",
                          ms: thinkingMs,
                          steps: message.steps,
                          live: Boolean(streaming && !message.content),
                        });
                        setThinkOpen(true);
                      }}
                    >
                      <i className="lq-proc__bar" aria-hidden="true" />
                      <span>
                        {thinkingMs ? `想了 ${Math.round(thinkingMs / 100) / 10} 秒` : "想了想"}
                      </span>
                      <span className="lq-proc__sub">点开看</span>
                    </button>
                  ) : null}

                  <div
                    className="lq-bubble"
                    onPointerDown={() => startPress(message)}
                    onPointerUp={clearPress}
                    onPointerLeave={clearPress}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu(message);
                    }}
                  >
                    {text ? (
                      streaming ? (
                        <p className="lq-bubble__live">{text}</p>
                      ) : (
                        <Markdown text={text} />
                      )
                    ) : (
                      <p className="lq-bubble__ghost">正在写回复…</p>
                    )}
                  </div>

                  {usage ? <p className="lq-meta">{usage}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="lq-composer">
          {quote ? (
            <div className="lq-quote">
              <span className="lq-quote__text">{quote}</span>
              <button
                type="button"
                className="lq-quote__x"
                aria-label="取消引用"
                onClick={() => setQuote(null)}
              >
                <X />
              </button>
            </div>
          ) : null}

          <div className="lq-composer__inputwrap">
            <textarea
              ref={inputRef}
              className="lq-composer__input"
              rows={1}
              placeholder={`和${aiName}说点什么…`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  doSend();
                }
              }}
            />
          </div>

          <div className="lq-composer__row">
            <button type="button" className="lq-composer__btn" aria-label="加东西">
              ＋
            </button>
            <button type="button" className="lq-composer__model">
              {settings.aiName || "克"} · 均衡
            </button>
            <button type="button" className="lq-composer__btn" aria-label="表情包">
              <Smile />
            </button>
            <span className="lq-composer__grow" />
            <button type="button" className="lq-composer__btn" aria-label="语音">
              <Mic />
            </button>
            <button
              type="button"
              className="lq-composer__btn"
              data-tone="send"
              aria-label="发送"
              onClick={doSend}
            >
              <Send />
            </button>
          </div>
        </div>
      </main>

      <LiquidDrawer />
      <LiquidSettings />

      {menu ? (
        <div className="lq-menu-wrap" onClick={() => setMenu(null)}>
          <div className="lq-menu lq-glass" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="lq-menu__item"
              onClick={() => {
                setQuote(stripInvisible(menu.content ?? "").slice(0, 60));
                setMenu(null);
              }}
            >
              引用这一句
            </button>
            <button
              type="button"
              className="lq-menu__item"
              onClick={() => {
                void navigator.clipboard?.writeText(stripInvisible(menu.content ?? ""));
                setMenu(null);
              }}
            >
              <Copy />
              复制
            </button>
            {menu.role === "user" ? (
              <button
                type="button"
                className="lq-menu__item"
                onClick={() => {
                  setDraft(stripInvisible(menu.content ?? ""));
                  setMenu(null);
                  inputRef.current?.focus();
                }}
              >
                <Pencil />
                修改
              </button>
            ) : (
              <button
                type="button"
                className="lq-menu__item"
                onClick={() => {
                  void regenerate(menu.id);
                  setMenu(null);
                }}
              >
                <RefreshCw />
                重新生成
              </button>
            )}
            <button type="button" className="lq-menu__item" onClick={() => setMenu(null)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      <ThinkingSheet
        open={thinkOpen}
        onClose={() => setThinkOpen(false)}
        text={think?.text ?? ""}
        steps={think?.steps}
        durationMs={think?.ms}
        live={think?.live}
      />
    </>
  );
}
