import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  Mic,
  Paperclip,
  Plus,
  Smile,
  Square,
  X,
} from "lucide-react";
import { FileButton } from "@/components/file-button";
import { filesToAttachments, prettySize } from "@/lib/attachments";
import { isOwnApi, QUOTA_LIMIT } from "@/lib/models";
import { recordSupported, startRecording, type Recorder } from "@/lib/record";
import { startListening } from "@/lib/voice";
import { IS_APP } from "@/lib/platform";
import { resolveVoiceLang } from "@/lib/voice";
import { resolveAiName } from "@/lib/branding";
import { resetLabel } from "@/lib/greeting";
import type { Attachment } from "@/lib/types";
import { useDismissOutside } from "@/lib/ux";
import { cn, uid } from "@/lib/utils";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";

/** 常用表情（本地常量，不依赖任何接口） */
const EMOJI = [
  "😀", "🙂", "😌", "😴", "🤔", "😮", "🥹", "😭",
  "😂", "🙌", "👍", "👀", "✨", "🌙", "☁️", "🍃",
  "🔥", "💧", "🌸", "🫧", "🐈", "🐟", "🍵", "📎",
];

type Props = {
  onSend: (text: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
  streaming?: boolean;
};

export function Composer({ onSend, disabled, streaming }: Props) {
  const [value, setValue] = useState("");
  const activeChatId = useApp((s) => s.activeId);
  /**
   * 草稿保存。
   *
   * 原来输入框的字只存在组件里 —— 一跳到别的页面，组件卸载，字就没了，
   * 回来得重打。这里按对话存进 store（会跟着持久化），
   * 改动后 300ms 写一次，**卸载前再写一次**（这才是"跳页面也不丢"的关键）。
   */
  /**
   * 草稿用**固定键**。
   *
   * 早先按 activeId（对话 id）存，结果踩坑：新建对话时那个 id 会变，
   * 于是"存进去的键"和"回来取的键"不是一个 —— 字看起来还是丢了，
   * 而且卸载时还会把旧键擦成空。输入框只有一个，一份草稿就够了。
   */
  const draftKey = "composer";
  /** 最新值的镜像：卸载时要用它，不能用闭包里可能已经过期的 value */
  const valueRef = useRef("");
  valueRef.current = value;

  useEffect(() => {
    const saved = useApp.getState().chatDrafts[draftKey] ?? "";
    setValue(saved);
  }, [draftKey]);

  /**
   * 节流保存。
   *
   * ⚠️ 清理函数里**只停定时器、不写 store**：挂载那一刻 value 还是空的，
   * 早先版本在清理里写了一次，结果把刚存下的草稿又擦成空（实测踩过）。
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      // 空值不写 —— 否则"刚刷新、store 还没回填"的那一瞬会把草稿擦掉。
      // 真正清空草稿只有发送之后那一条显式路径（见 send）。
      if (value) useApp.getState().setChatDraft(draftKey, value);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [value, draftKey]);

  /** 卸载（跳到别的页面）时，用 ref 里的最新值补写一次 —— 这才是"字不丢"的关键 */
  useEffect(() => {
    const key = draftKey;
    return () => {
      /**
       * ⚠️ **不要用空值写**。
       *
       * React 开发模式（StrictMode）会把组件挂载两次：第一次挂载时草稿刚被
       * 恢复进 state，紧接着就被卸载 —— 这一刻 valueRef 还是空的，
       * 写下去就把草稿擦掉了（实测："读完立刻又被读成空"）。
       * 真正要清空草稿只有一条路：发送之后 setValue("")，那条由节流保存负责。
       */
      if (valueRef.current) useApp.getState().setChatDraft(key, valueRef.current);
    };
  }, [draftKey]);

  const [modelOpen, setModelOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [pending, setPending] = useState<Attachment[]>([]);
  /** 录音中：非空表示正在录，值是已录毫秒 */
  const [recMs, setRecMs] = useState<number | null>(null);
  const [recErr, setRecErr] = useState("");
  const recRef = useRef<Recorder | null>(null);
  /** App 里用原生识别时，这里是它的句柄（跟录音二选一） */
  const asrRef = useRef<{ stop: () => void } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const model = useApp((s) => s.model);
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const setModel = useApp((s) => s.setModel);
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const activity = useApp((s) => s.activity);
  const customStickers = useApp((s) => s.stickers);
  const nowPlaying = usePlayer((s) => {
    const t = s.tracks.find((x) => x.id === s.currentId);
    return t ? `${t.name}${s.playing ? " · 播放中" : " · 暂停"}` : "";
  });
  /**
   * 今天的**真实**用量（来自每条请求记录的 token）。
   *
   * 原来这里显示的是"本机计数已用 88%"——一个抄订阅制的假限制，
   * 跟用户自己的 API 花费毫无关系，还把他拦在门外过（真事）。
   * 现在只报真实数字：今天几次、输入/输出多少、缓存省了多少。
   */
  const requestLog = useApp((s) => s.requestLog);
  /** 打字中：藏掉"现在知道"和用量条，只留输入框（键盘已经占掉不少了） */
  const keyboardUp = useApp((s) => s.keyboardUp);
  /** 自己带 key = 花自己的钱 → 只统计；走服务端 → 才有窗口额度 */
  const ownApi = isOwnApi(settings);
  const quota = useApp((s) => s.quota);
  const resetAt = useApp((s) => s.quotaResetAt());
  const usedPct = Math.min(100, Math.round((quota.used / QUOTA_LIMIT) * 100));
  const showQuota = !ownApi && usedPct >= 70;
  const usageToday = (() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = requestLog.filter((r) => r.at >= start.getTime());
    if (today.length === 0) return null;
    const sum = (k: "prompt" | "completion" | "cached") =>
      today.reduce((n, r) => n + (r[k] ?? 0), 0);
    return {
      calls: today.length,
      prompt: sum("prompt"),
      completion: sum("completion"),
      cached: sum("cached"),
    };
  })();
  const fmtTokens = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  function submit() {
    const t = value.trim();
    if ((!t && pending.length === 0) || disabled) return;
    const atts = pending;
    setValue("");
    // 发出去了，草稿跟着清掉（这是唯一一条"主动清空草稿"的路径）
    useApp.getState().setChatDraft(draftKey, "");
    setPending([]);
    onSend(t, atts.length ? atts : undefined);
  }

  async function pickFiles(files: File[]) {
    setPlusOpen(false);
    const list = await filesToAttachments(files);
    if (list.length) setPending((p) => [...p, ...list].slice(0, 8));
  }

  async function addStickers(files: File[]) {
    const list = await filesToAttachments(files);
    for (const a of list) {
      if (a.kind === "image" && a.dataUrl) useApp.getState().addSticker(a.dataUrl);
    }
  }

  function sendSticker(dataUrl: string) {
    if (disabled) return;
    setStickerOpen(false);
    const att: Attachment = {
      id: uid("att"),
      kind: "sticker",
      name: "表情",
      mime: "image/png",
      size: 0,
      dataUrl,
    };
    onSend("", [att]);
  }

  /* ---------------- 语音消息 ---------------- */

  async function startRec() {
    if (disabled || recRef.current || asrRef.current) return;
    setRecErr("");
    setPlusOpen(false);

    /**
     * App 里走**原生语音识别**。
     *
     * 安卓 WebView 没有 SpeechRecognition，原来那条路永远拿不到文字 ——
     * 用户实测："语音条也不可以、转文字是空的"。
     * 另外安卓不允许"识别"和"录音"同时占麦克风，所以这里只做识别：
     * 识别出来的文字直接写进输入框，你确认（或改一下）再发。
     */
    if (IS_APP) {
      /**
       * 走 startListening（它内部会按情况选路）：
       *   配了语音服务 → 自己录音 + 上传转文字（**唯一在荣耀上真能用的路** ✅）
       *   没配 → 退回系统识别
       *
       * 之前这里直接调 startNativeListening，等于绕过了语音服务 ——
       * 用户实测："语音通话欧克了，但是对话框旁边那个还是不行，录不上语音，一直是零秒" ✅
       */
      const t0 = Date.now();
      const tick = window.setInterval(() => setRecMs(Date.now() - t0), 200);
      const handle = startListening({
        lang: resolveVoiceLang(settings.voiceLang),
        onPartial: (t) => {
          // 服务那条路会推一句"录音中…"，当提示显示；识别到的中间结果照常显示
          if (t && !t.startsWith("（")) setRecErr("");
        },
        onFinal: (text) =>
          setValue((v) => (v ? `${v}${/\s$/.test(v) ? "" : " "}${text}` : text)),
        onEnd: () => {
          window.clearInterval(tick);
          asrRef.current = null;
          setRecMs(null);
        },
        onError: (msg) => {
          window.clearInterval(tick);
          setRecErr(msg);
          asrRef.current = null;
          setRecMs(null);
        },
      });
      if (!handle) {
        window.clearInterval(tick);
        setRecErr("这个版本没接上语音，装最新版再试。");
        return;
      }
      asrRef.current = handle;
      setRecMs(0);
      return;
    }

    if (!recordSupported()) {
      setRecErr("这个浏览器不给录音。需要 https 或 localhost —— 局域网明文 http 下麦克风是被禁的。");
      return;
    }
    try {
      const rec = await startRecording((ms) => setRecMs(ms));
      recRef.current = rec;
      setRecMs(0);
    } catch (err) {
      const name = (err as { name?: string }).name;
      setRecErr(
        name === "NotAllowedError" || name === "SecurityError"
          ? "麦克风权限被拒了（也可能是 http 页面不给用）。要在浏览器设置里允许麦克风。"
          : name === "NotFoundError"
            ? "没找到麦克风设备。"
            : `录音起不来：${(err as Error).message || name || "未知原因"}`,
      );
      setRecMs(null);
    }
  }

  async function stopRec(send: boolean) {
    // App 里"停止"= 结束识别；文字已经写进输入框了，不用再发音频
    if (asrRef.current) {
      asrRef.current.stop();
      asrRef.current = null;
      setRecMs(null);
      return;
    }
    const rec = recRef.current;
    recRef.current = null;
    setRecMs(null);
    if (!rec) return;
    if (!send) {
      rec.cancel();
      return;
    }
    const att = await rec.stop();
    if (!att) {
      setRecErr("没录到声音，再试一次？");
      return;
    }
    onSend("", [att]);
  }

  useEffect(() => {
    // 卸载时必须停掉，否则麦克风指示灯一直亮着
    return () => {
      recRef.current?.cancel();
      recRef.current = null;
    };
  }, []);

  function attachNote() {
    setPlusOpen(false);
    const name = window.prompt("给这条上下文起个标题", "附注");
    const body = window.prompt("要附在下一条消息前的内容");
    if (!body?.trim()) return;
    setValue((v) => `${v}${v ? "\n\n" : ""}【${name || "附注"}】\n${body.trim()}`);
  }

  // 点弹层外面就收起（不用等抬手，手机上更顺手）
  const cardRef = useRef<HTMLDivElement>(null);
  const closeAll = useCallback(() => {
    setPlusOpen(false);
    setModelOpen(false);
    setStickerOpen(false);
  }, []);
  useDismissOutside(cardRef, closeAll, plusOpen || modelOpen || stickerOpen);

  return (
    <div className="px-4 pb-composer">
      <div ref={cardRef} className="aster-card rounded-3xl border border-line p-2">
        {(activity || nowPlaying) && !keyboardUp && (
          <p className="mb-1 line-clamp-1 px-1.5 text-[11px] leading-4 text-subtle">
            {aiName} 现在知道：
            {activity ? `${activity.label}${activity.detail ? ` · ${activity.detail}` : ""}` : ""}
            {nowPlaying ? `${activity ? " · " : ""}正在听 ${nowPlaying}` : ""}
          </p>
        )}
        {/* 自己带 key：显示真实 token 用量（本机不限制）—— 打字时先藏起来 */}
        {ownApi && usageToday && !keyboardUp && (
          <div className="mb-1 flex items-center justify-between gap-3 rounded-2xl bg-chip px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">
                今天 {usageToday.calls} 次 · 输入 {fmtTokens(usageToday.prompt)} / 输出{" "}
                {fmtTokens(usageToday.completion)}
              </p>
              <p className="text-[12px] text-muted">
                {usageToday.cached > 0
                  ? `缓存命中 ${fmtTokens(usageToday.cached)} tokens · 省钱的是这部分`
                  : "这是你自己的 API 用量，本机只统计不限制"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate({ to: "/me" })}
              className="shrink-0 rounded-full bg-elevated px-3.5 py-1.5 text-[13px] font-medium text-fg shadow-sm"
            >
              详情
            </button>
          </div>
        )}
        {/* 走内置服务端：这里才真的会拦（花的是服务端那把 key）—— 打字时也先藏起来 */}
        {showQuota && !keyboardUp && (
          <div className="mb-1 flex items-center justify-between gap-3 rounded-2xl bg-chip px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">本窗口已用 {usedPct}%</p>
              <p className="text-[12px] text-muted" suppressHydrationWarning>
                {resetAt <= Date.now() ? "窗口已过，下次发送重新计数" : resetLabel(resetAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate({ to: "/me" })}
              className="shrink-0 rounded-full bg-elevated px-3.5 py-1.5 text-[13px] font-medium text-fg shadow-sm"
            >
              详情
            </button>
          </div>
        )}
        {recMs !== null && (
          <div className="mb-1.5 flex items-center gap-2.5 rounded-2xl border border-warn/40 bg-warn/10 px-3 py-2.5">
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-warn" />
            <span className="min-w-0 flex-1 text-[12px] text-fg">
              正在录音 {Math.floor(recMs / 1000)} 秒
              <span className="ml-1 text-muted">· 边录边转文字，他就能听懂</span>
            </span>
            <button
              type="button"
              aria-label="取消录音"
              onClick={() => void stopRec(false)}
              className="shrink-0 rounded-full bg-chip px-3 py-1.5 text-[12px] text-muted"
            >
              取消
            </button>
            <button
              type="button"
              aria-label="发送语音"
              onClick={() => void stopRec(true)}
              className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-ink-fg"
            >
              发送
            </button>
          </div>
        )}
        {recErr && (
          <p className="mb-1.5 rounded-2xl bg-warn/10 px-3 py-2 text-[11px] leading-4 text-warn">
            {recErr}
          </p>
        )}
        {pending.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-2 px-1">
            {pending.map((a) => (
              <span
                key={a.id}
                className="relative flex items-center gap-2 rounded-2xl border border-line bg-chip px-2 py-1.5"
              >
                {a.dataUrl ? (
                  <img src={a.dataUrl} alt={a.name} className="size-10 rounded-xl object-cover" />
                ) : (
                  <Paperclip className="size-4 text-muted" />
                )}
                <span className="max-w-28 truncate text-[11px]">{a.name}</span>
                <span className="text-[10px] text-subtle">
                  {a.text ? "可读正文" : prettySize(a.size)}
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${a.name}`}
                  onClick={() => setPending((p) => p.filter((x) => x.id !== a.id))}
                  className="text-muted"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {stickerOpen && (
          <div className="glass-menu mb-1.5 rounded-2xl border border-line p-2">
            <div className="flex items-center justify-between px-1 pb-1.5">
              <span className="text-[11px] text-muted">表情</span>
              <div className="flex items-center gap-1">
                <FileButton
                  ariaLabel="上传表情图"
                  accept="image/*"
                  multiple
                  className="text-[11px] text-muted"
                  onPick={(files) => void addStickers(files)}
                >
                  ＋ 上传表情图
                </FileButton>
                <button
                  type="button"
                  aria-label="收起表情"
                  onClick={() => setStickerOpen(false)}
                  className="flex size-7 items-center justify-center rounded-full bg-chip text-muted"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto">
              {EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-label={`插入 ${e}`}
                  onClick={() => setValue((v) => v + e)}
                  className="rounded-xl py-1 text-xl leading-none"
                >
                  {e}
                </button>
              ))}
              {customStickers.map((s) => (
                <span key={s} className="relative">
                  <button
                    type="button"
                    aria-label="发送表情"
                    onClick={() => sendSticker(s)}
                    className="block"
                  >
                    <img src={s} alt="自定义表情" className="size-8 rounded-lg object-cover" />
                  </button>
                  <button
                    type="button"
                    aria-label="删除这个表情"
                    onClick={() => useApp.getState().removeSticker(s)}
                    className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-ink text-[9px] text-ink-fg"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <textarea
          ref={ta}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          /**
           * 聚焦 = 键盘要弹起来了：把底部导航收下去，给消息腾地方
           * （用户反馈：导航 + 输入框占了快半个屏幕，打字时看不到消息）。
           * 失焦时延迟一点再放回来 —— 点「发送」按钮的那一瞬也会失焦，
           * 不延迟的话导航会闪一下。
           */
          onFocus={() => useApp.getState().setKeyboardUp(true)}
          onBlur={() => window.setTimeout(() => useApp.getState().setKeyboardUp(false), 180)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length) {
              e.preventDefault();
              void pickFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={`和${aiName}聊聊…`}
          className="min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-[16px] text-fg outline-none placeholder:text-subtle"
        />
        <div className="flex items-center gap-2 px-1 pb-1">
          <div className="relative">
            <button
              type="button"
              aria-label="添加"
              onClick={() => {
                setPlusOpen((v) => !v);
                setModelOpen(false);
                setStickerOpen(false);
              }}
              className="flex size-11 items-center justify-center rounded-full bg-chip text-fg"
            >
              <Plus className="size-5" strokeWidth={1.75} />
            </button>
            {plusOpen && (
              <div className="glass-menu absolute bottom-13 left-0 z-20 w-44 overflow-hidden rounded-2xl border border-line py-1">
                <FileButton
                  ariaLabel="选择图片"
                  accept="image/*"
                  multiple
                  className="w-full justify-start px-3 py-2.5 text-sm"
                  onPick={(files) => void pickFiles(files)}
                >
                  图片
                </FileButton>
                <FileButton
                  ariaLabel="选择文件"
                  multiple
                  className="w-full justify-start px-3 py-2.5 text-sm"
                  onPick={(files) => void pickFiles(files)}
                >
                  文件
                </FileButton>
                <button
                  type="button"
                  aria-label="录一段语音"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
                  onClick={() => void startRec()}
                >
                  <Mic className="size-3.5" />
                  录音
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
                  onClick={() => {
                    setPlusOpen(false);
                    setModelOpen(false);
                    setStickerOpen((v) => !v);
                  }}
                >
                  <Smile className="size-3.5" />
                  表情
                </button>
                <button type="button" className="block w-full px-3 py-2.5 text-left text-sm" onClick={attachNote}>
                  附加说明
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2.5 text-left text-sm"
                  onClick={() => {
                    setPlusOpen(false);
                    void navigate({ to: "/tools" });
                  }}
                >
                  插件与 MCP
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2.5 text-left text-sm"
                  onClick={() => {
                    setPlusOpen(false);
                    void navigate({ to: "/tools" });
                  }}
                >
                  已保存文档
                </button>
              </div>
            )}
          </div>
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => {
                setModelOpen((v) => !v);
                setPlusOpen(false);
                setStickerOpen(false);
              }}
              className="flex h-11 w-full items-center justify-between gap-2 rounded-full bg-chip px-4 text-[13px] font-medium"
            >
              <span className="truncate font-mono text-[12px]">
                {settings.upstreamModel || "未选模型"}
              </span>
              <ChevronDown className="size-4 text-muted" />
            </button>
            {modelOpen && (
              <div className="glass-menu absolute bottom-13 left-0 z-20 w-full overflow-hidden rounded-2xl border border-line py-1">
                {settings.upstreamModels.length > 0 ? (
                  settings.upstreamModels.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        patch({ upstreamModel: m });
                        setModelOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left",
                        m === settings.upstreamModel && "bg-chip",
                      )}
                    >
                      <span className="truncate font-mono text-[13px]">{m}</span>
                      {m === settings.upstreamModel && <Check className="size-3.5 text-accent" />}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2.5">
                    <p className="text-[12px] leading-5 text-muted">
                      还没配模型 —— 要先告诉栖岛用哪家、用哪个模型。
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setModelOpen(false);
                        void navigate({ to: "/me" });
                      }}
                      className="mt-2 rounded-full bg-chip px-3 py-1.5 text-[12px] font-medium"
                    >
                      去「我的 → 自定义上游」配
                    </button>
                  </div>
                )}
                <p className="border-t border-line px-3 py-2 text-[11px] leading-4 text-muted">
                  这里列的是你上游真实可用的模型名（在「我的 → 自定义上游」里拉取或手填）。
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={
              recMs !== null ? "停止并发送语音" : value.trim() || pending.length ? "发送" : "录音"
            }
            disabled={disabled}
            onClick={() => {
              if (recMs !== null) void stopRec(true);
              else if (value.trim() || pending.length) submit();
              else void startRec();
            }}
            className={cn(
              "flex size-11 items-center justify-center rounded-full bg-ink text-ink-fg disabled:opacity-50",
              recMs !== null && "bg-warn",
            )}
          >
            {streaming ? (
              <span className="size-3.5 rounded-sm bg-ink-fg" />
            ) : recMs !== null ? (
              <Square className="size-4 fill-current" />
            ) : value.trim() || pending.length ? (
              <ArrowUp className="size-5" strokeWidth={2.2} />
            ) : (
              <Mic className="size-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null;
  start: () => void;
};
