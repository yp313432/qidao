import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Mic, PhoneOff } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/avatar";
import { VoiceWave } from "@/components/voice-wave";
import { resolveAiName } from "@/lib/branding";
import { createSentenceStreamer, createSpeechQueue, type SpeechQueue } from "@/lib/speech-queue";
import { keepScreenAwake, type WakeLockHandle } from "@/lib/wake-lock";
import { useApp } from "@/lib/store";
import { useChatStream } from "@/lib/use-chat";
import { useActivity } from "@/lib/use-activity";
import { cn } from "@/lib/utils";
import {
  resolveVoiceLang,
  startListening,
  sttSupported,
  stopSpeaking,
  VOICE_LANGS,
  type ListenHandle,
} from "@/lib/voice";

type Phase = "idle" | "listening" | "thinking" | "speaking" | "unsupported";

const PHASE_TEXT: Record<Phase, string> = {
  idle: "准备好了",
  listening: "听你说…",
  thinking: "他在想…",
  speaking: "他在说…",
  unsupported: "这个外壳没有语音输入功能",
};

/**
 * 语音对话页（独立页面，不是浮层）。
 *
 * **2026-10 起是"边说边念"**：模型的话一出来就按句子送去合成，成一句念一句，
 * 不再等整段回完（原来"到听见第一个字"要等转写 + 整段生成 + 合成）。
 * 配上"说完自动停"（`lib/vad.ts`），一轮的等待从十几秒压到几秒。
 *
 * 仍然是**回合制**（半双工）：他说话时不听，念完/说完再听下一句。
 * 为什么不做"边说边听"：浏览器里程序化播放的音频不能当作回声消除的参考信号
 * （见 MDN 的 echoCancellation 定义 + sokuji issue #55），外放时会自问自答。
 * 戴耳机时才可能安全地做双向。
 */
export function VoiceView() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const aiName = resolveAiName(settings.aiName);
  const { busy, send } = useChatStream();
  useActivity("在语音对话");

  /**
   * ⚠️ `send` 必须用 ref 取**最新**的那个 —— 这是实测复现过的真 bug。
   *
   * 免提循环是**进页面那一刻**（mount effect）就开始的，那个闭包里的 `send`
   * 捕获的是**首帧渲染**的 settings。如果这一页是直接打开的（深链、刷新、
   * 或者 hydration 稍慢），首帧的 settings 还是默认值 ——
   * 于是整场语音对话都在发"空的自定义上游"，用户明明配了却看到
   * 「还没接模型：去「我的 → 自定义上游」填地址和密钥」。
   *
   * 实测：直接在 /voice 上打开能稳定复现；从对话页点进去就正常
   * （那时已经 hydrate 完了）—— 所以这种 bug 藏得很深，只有脚本能抓。
   */
  const sendRef = useRef(send);
  sendRef.current = send;

  /**
   * 取「此刻」的语言设置。
   *
   * 免提循环和播放队列都是回调驱动的，闭包里的值会是旧的 —— 所以每次都现读，
   * 否则你中途换语言，下一句还在用上一个。
   */
  function currentLang() {
    return resolveVoiceLang(useApp.getState().settings.voiceLang);
  }

  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [notice, setNotice] = useState("");
  /** 实时麦克风音量（0-1）—— 只用来画波形，不参与判定 */
  const [level, setLevel] = useState(0);
  /** 通话时握着"屏幕别自动锁"的锁 */
  const wakeRef = useRef<WakeLockHandle | null>(null);

  const listenRef = useRef<ListenHandle | null>(null);
  const baselineRef = useRef("");
  const phaseRef = useRef<Phase>("idle");
  const aliveRef = useRef(true);
  /** 句子级播放队列 + 句子切分器（都在挂载时建一次） */
  const queueRef = useRef<SpeechQueue | null>(null);
  const streamerRef = useRef<ReturnType<typeof createSentenceStreamer> | null>(null);
  /** 流式文本已经念到第几个字（按消息 id 分开记，换一轮就重置） */
  const streamRef = useRef<{ id: string; chars: number }>({ id: "", chars: 0 });
  /**
   * 这一轮"文本流完了"没有。
   *
   * 为什么要它：队列**每播完一批**都会喊 onIdle，如果一喊就回去听下一句，
   * 那他说第一句的间隙（等第二句从模型出来）就会被打断成两个回合。
   * 所以只有"文本流结束 + 队列也空了"才算一轮结束。
   */
  const turnDoneRef = useRef(false);
  phaseRef.current = phase;

  const lastAssistantId = useApp((s) => {
    const c = s.conversations.find((x) => x.id === s.activeId);
    const m = c ? [...c.messages].reverse().find((x) => x.role === "assistant") : undefined;
    return m?.id ?? "";
  });
  const lastAssistantText = useApp((s) => {
    const c = s.conversations.find((x) => x.id === s.activeId);
    const m = c ? [...c.messages].reverse().find((x) => x.role === "assistant") : undefined;
    return m?.content ?? "";
  });

  function stopListen() {
    listenRef.current?.stop();
    listenRef.current = null;
  }

  function beginListen() {
    if (!aliveRef.current) return;
    stopSpeaking();
    // 队列也要停：不然上一轮的尾巴会跟这一轮的你说话叠在一起
    queueRef.current?.stop();
    setHeard("");
    setNotice("");
    setPhase("listening");
    let got = false;
    /**
     * 出过错就别让 onEnd 再改提示。
     *
     * 用户实测："报错一闪就没了，我看不到" ——
     * 原因是 onError 刚写下真正的报错，紧接着 onEnd 就把提示**覆盖**成
     * "没听到你说什么"，等于把诊断信息擦掉了 ✅
     */
    let errored = false;
    listenRef.current = startListening({
      lang: currentLang(),
      onPartial: (t) => setHeard(t),
      // 真实音量 → 波形（说话时柱子跟着跳）
      onLevel: (rms) => setLevel(rms),
      onFinal: (t) => {
        got = true;
        setHeard(t);
        baselineRef.current = lastAssistantId;
        setPhase("thinking");
        // 用 ref 里的最新 send（首帧那个闭包里的 settings 可能还没 hydrate）
        void sendRef.current(t);
      },
      onError: (e) => {
        errored = true;
        if (e === "not-allowed" || e === "service-not-allowed") {
          setPhase("unsupported");
          setNotice("麦克风权限被拒了 —— 要在浏览器/系统设置里允许。");
        } else if (e === "audio-capture") {
          setNotice("没找到麦克风设备。");
        } else if (e === "network") {
          setNotice("识别服务连不上（语音识别要联网）。");
        } else if (e !== "no-speech" && e !== "aborted") {
          // 原来的报错**原样留着**，不再覆盖 —— 这是唯一能帮人定位的信息
          setNotice(`识别出错：${e}`);
        }
      },
      onEnd: () => {
        listenRef.current = null;
        if (!got && !errored && aliveRef.current && phaseRef.current === "listening") {
          setPhase("idle");
          setNotice("没听到你说什么，点麦克风继续。");
        }
      },
    });
    if (!listenRef.current) setPhase("unsupported");
  }

  // 进页面就开始听；离开时全部停掉
  useEffect(() => {
    aliveRef.current = true;
    streamerRef.current = createSentenceStreamer();
    queueRef.current = createSpeechQueue({
      lang: currentLang,
      // 一轮真的结束（文本流完了、队列也空了）才回去听下一句
      onIdle: () => {
        if (aliveRef.current && turnDoneRef.current) beginListen();
      },
    });
    /**
     * 通话期间别让屏幕自己锁掉。
     * 不 await：拿不到锁（省电模式 / 不支持）也不能耽误开始听。
     */
    void keepScreenAwake().then((h) => {
      if (aliveRef.current) wakeRef.current = h;
      else h.release();
    });
    if (!sttSupported()) {
      setPhase("unsupported");
      return;
    }
    beginListen();
    return () => {
      aliveRef.current = false;
      stopListen();
      stopSpeaking();
      queueRef.current?.stop();
      queueRef.current = null;
      wakeRef.current?.release();
      wakeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * **他说一句，我们念一句** —— 不再等整段回完。
   *
   * 流式文本是每 100ms 左右刷进 store 的，所以这里只处理"新长出来的那一段"，
   * 凑满一句就送进队列（合成 + 播放）。`streamRef` 记着已经念到第几个字，
   * 避免同一句被念两遍。
   */
  useEffect(() => {
    if (phaseRef.current !== "thinking") return;
    if (!lastAssistantId || lastAssistantId === baselineRef.current) return;
    const text = lastAssistantText;

    if (streamRef.current.id !== lastAssistantId) {
      // 新的一轮：清空上轮的缓冲和"停用"状态
      streamRef.current = { id: lastAssistantId, chars: 0 };
      turnDoneRef.current = false;
      streamerRef.current?.reset();
      queueRef.current?.reset();
    }

    const fresh = text.slice(streamRef.current.chars);
    if (!fresh) return;
    streamRef.current.chars = text.length;
    setSaid(text);

    const sentences = streamerRef.current?.push(fresh) ?? [];
    if (sentences.length > 0) {
      if (phaseRef.current === "thinking") setPhase("speaking");
      for (const s of sentences) queueRef.current?.push(s);
    }
  }, [lastAssistantId, lastAssistantText]);

  // 文本流结束 → 把最后一句（常常没有标点）也念掉，念完再回去听
  useEffect(() => {
    if (busy) return;
    const st = phaseRef.current;
    if (st !== "thinking" && st !== "speaking") return;
    if (!lastAssistantId || lastAssistantId === baselineRef.current) return;
    if (streamRef.current.id !== lastAssistantId) return;

    turnDoneRef.current = true;
    const rest = streamerRef.current?.flush() ?? "";
    if (rest) {
      if (phaseRef.current === "thinking") setPhase("speaking");
      queueRef.current?.push(rest);
      return;
    }
    // 这轮什么都没念（空回复 / 没装语音包）→ 别卡在"他在说"，直接继续听
    if (!queueRef.current?.speaking() && aliveRef.current) beginListen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, lastAssistantId]);

  const subtitles = settings.voiceSubtitles;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/*
        返回目标交给 nav-tree 算（/voice → /me）。
        原来这里硬写着 `to="/"` + "返回对话" —— 但语音设置是从
        **「我的 → 系统 → 语音」**进去的，回对话首页就跳过了一整级。
        这正是"返回只能返回上一级"要治的那类 bug，脚本查出来的。
      */}
      <PageHeader
        title="语音对话"
        right={<span className="px-3 text-[11px] text-muted">{aiName}</span>}
      />

      {/* 语言与字幕 */}
      <div className="mx-4 mt-2 flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-chip px-3.5 py-2">
          <span className="shrink-0 text-[11px] text-muted">语言</span>
          <select
            aria-label="语音语言"
            value={settings.voiceLang}
            onChange={(e) => patch({ voiceLang: e.target.value })}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none"
          >
            {VOICE_LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={subtitles}
          aria-label="显示字幕"
          onClick={() => patch({ voiceSubtitles: !subtitles })}
          className={cn(
            "shrink-0 rounded-full px-3.5 py-2 text-[12px] font-medium",
            subtitles ? "bg-fg/10 text-fg" : "bg-chip text-muted",
          )}
        >
          字幕{subtitles ? "开" : "关"}
        </button>
      </div>

      {/* 主体：头像 + 光环 + 波形（头像本身就是"重新开始听"的按钮） */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8 text-center">
        <button
          type="button"
          aria-label="开始聆听"
          onClick={beginListen}
          disabled={phase === "thinking" || phase === "unsupported"}
          className="relative flex size-40 items-center justify-center rounded-full transition-transform active:scale-[0.97]"
        >
          {/*
            两层光环：
              · 内层跟着**真实音量**胀缩（安静时收成很小的一圈）
              · 外层固定慢呼吸 —— 只有内层的话，静音时画面像死机
            数值直接写 inline：20Hz 的采样用 class 切换会跟不上。
          */}
          <span
            className="voice-halo"
            style={{
              opacity: 0.22 + Math.min(level * 7, 0.7),
              transform: `scale(${1 + Math.min(level * 1.6, 0.24)})`,
            }}
          />
          <span className="voice-halo voice-halo-slow" style={{ inset: "-12%" }} />
          <Avatar role="ai" size={104} className="relative shadow-lg" />
        </button>

        <p className="text-[15px] font-medium text-fg">{PHASE_TEXT[phase]}</p>
        <VoiceWave level={level} phase={phase} />

        {subtitles ? (
          <div className="w-full max-w-sm space-y-2">
            {heard && (
              <p className="rounded-2xl bg-chip px-4 py-2.5 text-[13px] leading-6 text-muted">
                <span className="mr-1 text-subtle">你说</span>
                {heard}
              </p>
            )}
            {said && phase !== "listening" && (
              <p className="rounded-2xl bg-chip px-4 py-2.5 text-[13px] leading-6 text-fg">
                <span className="mr-1 text-subtle">{aiName}</span>
                {said.slice(0, 200)}
                {said.length > 200 ? "…" : ""}
              </p>
            )}
            {!heard && !said && (
              <p className="text-[12px] text-subtle">字幕开着 —— 你和他的原话会显示在这里</p>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-subtle">字幕已关（只有声音）</p>
        )}

        {phase === "unsupported" && (
          <p className="max-w-sm text-[12px] leading-5 text-warn">
            这个外壳没提供语音输入接口（安卓 App 里的 WebView 不提供；桌面 Chrome / Edge 可以）。
            你也可以只在「我的 → 语音」里开「朗读回复」，让他念给你听。
          </p>
        )}
        {notice && phase !== "unsupported" && (
          <p className="max-w-sm text-[12px] leading-5 text-warn">{notice}</p>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={beginListen}
          disabled={phase === "thinking" || phase === "unsupported"}
          className="flex items-center gap-1.5 rounded-full bg-chip px-5 py-3 text-[13px] font-medium text-fg disabled:opacity-50"
        >
          <Mic className="size-4" strokeWidth={1.8} />
          再说一次
        </button>
        <Link
          to="/"
          className="flex items-center gap-1.5 rounded-full bg-warn px-6 py-3 text-[13px] font-medium text-white"
        >
          <PhoneOff className="size-4" strokeWidth={1.8} />
          挂断
        </Link>
      </div>

      <p className="px-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-center text-[11px] leading-4 text-subtle">
        你停下来他就接（静音 0.7 秒判定）；他一边想一边念。
        半双工：他说话时不听你的 —— 不然外放会自问自答（浏览器里没有可靠的回声消除）。
      </p>
    </div>
  );
}
