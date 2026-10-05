import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Mic } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { resolveAiName } from "@/lib/branding";
import { useApp } from "@/lib/store";
import { useChatStream } from "@/lib/use-chat";
import { useActivity } from "@/lib/use-activity";
import { cn } from "@/lib/utils";
import {
  resolveVoiceLang,
  speak,
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
 * 说清楚它是什么：**回合制语音** —— 说话 → 转文字 → 他回 → 朗读 → 继续听。
 * 不是把音频发给他听（那需要支持音频的模型 + 实时通道）。
 */
export function VoiceView() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const aiName = resolveAiName(settings.aiName);
  const { busy, send } = useChatStream();
  useActivity("在语音对话");

  const lang = resolveVoiceLang(settings.voiceLang);

  /**
   * 取「此刻」的语言设置。
   * 免提循环是靠回调驱动的，闭包里的 lang 会是旧的 —— 所以每次都现读，
   * 否则你中途换语言，下一轮还在用上一个。
   */
  function currentLang() {
    return resolveVoiceLang(useApp.getState().settings.voiceLang);
  }

  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [notice, setNotice] = useState("");

  const listenRef = useRef<ListenHandle | null>(null);
  const baselineRef = useRef("");
  const phaseRef = useRef<Phase>("idle");
  const aliveRef = useRef(true);
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
      onFinal: (t) => {
        got = true;
        setHeard(t);
        baselineRef.current = lastAssistantId;
        setPhase("thinking");
        void send(t);
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
    if (!sttSupported()) {
      setPhase("unsupported");
      return;
    }
    beginListen();
    return () => {
      aliveRef.current = false;
      stopListen();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 他的回复到了就朗读，念完继续听
  useEffect(() => {
    if (phaseRef.current !== "thinking") return;
    if (busy) return;
    if (!lastAssistantId || lastAssistantId === baselineRef.current) return;
    const text = lastAssistantText.trim();
    if (!text) return;
    setSaid(text);
    setPhase("speaking");
    speak(text, {
      lang: currentLang(),
      onEnd: () => {
        if (aliveRef.current) beginListen();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, lastAssistantId, lastAssistantText]);

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

      {/* 主体 */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8 text-center">
        <button
          type="button"
          aria-label="开始聆听"
          onClick={beginListen}
          disabled={phase === "thinking" || phase === "unsupported"}
          className={cn(
            "flex size-32 items-center justify-center rounded-full border border-line bg-surface text-fg shadow-sm transition-transform active:scale-95",
            phase === "listening" && "voice-pulse",
          )}
        >
          <Mic className="size-10" strokeWidth={1.5} />
        </button>

        <p className="text-[15px] font-medium text-fg">{PHASE_TEXT[phase]}</p>

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
          className="rounded-full bg-chip px-5 py-3 text-[13px] font-medium text-fg disabled:opacity-50"
        >
          再说一次
        </button>
        <Link
          to="/"
          className="rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-ink-fg"
        >
          结束
        </Link>
      </div>

      <p className="px-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-center text-[11px] leading-4 text-subtle">
        这是回合制语音：说话 → 转文字 → 他回 → 朗读。不是把音频发给他听。
      </p>
    </div>
  );
}
