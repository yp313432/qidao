import { listVoiceModels, voiceConfig, voiceProviderOf } from "@/lib/voice-service";
import { dsVoiceStatusHint, DS_SYSTEM_VOICES, DS_TTS_MODELS, designVoice } from "@/lib/dashscope";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight, Search, X } from "lucide-react";
import { BackupSection } from "@/components/shared/backup-section";
import {
  localNotify,
  PERMISSION_LABEL,
  permissionStateAsync,
  pushKeyConfigured,
  registerServiceWorker,
  requestPermission,
  secureContextOk,
  subscribePush,
  swRegistration,
  type SwStatus,
} from "@/lib/notify";
import { getModel, MODELS } from "@/lib/models";
import { probeEffortSupport, type EffortProbeResult } from "@/lib/effort-probe";
import { probeUpstreamModel, type UpstreamProbeResult } from "@/lib/upstream-probe";
import { refreshPlaceAndWeather } from "@/lib/where-am-i";
import { IS_APP, probeUpstreamModels } from "@/lib/platform";
import { failedProbeResult, probeToolCalling, type ToolProbeResult } from "@/lib/tool-probe";
import { toolProtocolLabel } from "@/lib/tool-protocol";
import { wakeSupported } from "@/lib/background-wake";
import { pingWake, readWakeLog, resetWake } from "@/lib/wake-sync";
import { speakTextAsync } from "@/lib/tts";
import { useApp } from "@/lib/store";
import { WAKE_LEVELS } from "@/lib/wake-schedule";
import { cn } from "@/lib/utils";
import { resolveAiName } from "@/lib/branding";

import type { MeTab } from "./me-types";
import { STYLES } from "./me-options";
import { SpacePage } from "./space-page";
import { relShort } from "./me-format";
import { KButton, KOpt, KOpts, KSlider } from "@/components/ui-kit";
import { ProbeLine, Section, Group, Sub, Row } from "./me-widgets";
import { isSolid } from "@/lib/material";

/**
 * 四个 tab 的区块 JSX（我的空间 / 模型与用量 / 数据 / 系统）。
 *
 * 四个 tab 共用**同一份状态与副作用**（都是 settings 里的字段），所以还是一个组件 —— 拆开就得把几十个状态用 props 传下去，更容易出错。
 * 想再拆，先把状态抽成一个 hook（见 design/ARCHITECTURE.md 的 D2 备注）。
 */

export function MeSections({ tab }: { tab: MeTab }) {
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoMsg, setGeoMsg] = useState("");
  /**
   * 语音服务的提示（用户 m10539："这个安卓底层的弹窗没做适配"）。
   *
   * 原来成功/失败都走 `window.alert()` —— 在 WebView 里它会被渲染成**安卓系统原生对话框**
   * （白色卡片 + OK），跟这个 App 的玻璃质感完全不搭，还挡内容。
   * 改成页内一行提示：不遮挡、可复制、失败时长文案能躺着读完。
   */
  const [voiceMsg, setVoiceMsg] = useState("");
  /** 浏览器里能选的音色（App 里由系统引擎决定，所以是空数组） */
  /**
   * 语音服务里"能被选"的模型（拉取后才有）。
   *
   * 用户 m10620："这个模型他自动就写上了，我也换不了" —— 一格纯文本输入框，
   * 手打一长串 `FunAudioLLM/CosyVoice2-0.5B` 在手机上很折磨。拉到清单后
   * 直接给一排可点的按钮，点一下就是换引擎。
   */
  const [voiceModels, setVoiceModels] = useState<string[]>([]);
  /**
   * **弹层选择器**（用户 m10646："拉取不要做成列出来的，改成弹层选择，就跟之前做的
   * 聊天页面的模型选择那种"）。`voicePick` 是正在挑哪一格。
   */
  const [voicePick, setVoicePick] = useState<null | "asr" | "tts" | "voice">(null);
  useBodyScrollLock(!!voicePick);
  /** 我的空间里哪一组是展开的（null = 全收起，一屏能看完） */
  const [voicePickQuery, setVoicePickQuery] = useState("");
  /** ElevenLabs 点「拉取音色」拉回来的 voice_id 清单 */
  const [elevenVoices, setElevenVoices] = useState<string[]>([]);
  /**
   * 百炼：拉回来的**自定义音色**（声音复刻 / 声音设计建的嗓子）。
   * 系统音色是固定的那几个，不在这里。
   */
  const [dsVoices, setDsVoices] = useState<string[]>([]);
  const [dsVoiceStatus, setDsVoiceStatus] = useState<Record<string, string>>({});
  /** 捏嗓子面板（用户 m10844："实际上我就想要自己捏得"） */
  const [designOpen, setDesignOpen] = useState(false);
  /** 百炼那一档的「转文字借别家」小面板 */
  const [asrOpen, setAsrOpen] = useState(false);
  const [designDesc, setDesignDesc] = useState("");
  const [designPreview, setDesignPreview] = useState("");
  const [designBusy, setDesignBusy] = useState(false);
  const [designMsg, setDesignMsg] = useState("");
  const [designUrl, setDesignUrl] = useState("");
  const settings = useApp((s) => s.settings);
  /* 纸世界 Step3 补：纯色材质下弹层全面纸化（用户 m00405），液态走自己的分支 */
  const solidPaper = isSolid(settings);
  /** 语音服务商（按地址认，和 voice-service 里同一套规则） */
  const voiceProvider = voiceProviderOf(settings.voiceBaseUrl ?? "");
  /** "听"单独配的那家有没有密钥（没有就跟随主配置） */
  const asrKey = (settings.voiceAsrApiKey ?? "").trim();
  // 记忆库 / 世界书的条数统计在「AI 概览」和它自己的页面里，这里不再订阅
  // （定时任务/闹钟的列表入口已经挪到「玩乐 → 小日子」，这一页不再订阅 tasks）
  /** 今天的真实用量（来自每条请求记录的 token），替代原来那个假的额度百分比 */
  const requestLog = useApp((s) => s.requestLog);
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
  const hydrationDone = useApp((s) => s.hydrated);
  // 配额重置时间是按「现在」算的 —— 服务端和客户端算出来必然不同，
  // 所以等服务端渲染过去之后再显示，避免水合失败。
  const hydrated = hydrationDone;
  const patch = useApp((s) => s.patchSettings);
  /**
   * 当前档位（会话级）跟聊天页那个「均衡 ⌄」是**同一个值**（store 的 `model`），
   * 在这儿点三档，聊天页立刻跟着变 —— 用户原话："在设置里配了哪个就用哪个，
   * 聊天页就显示当前那个"。`settings.defaultModel` 只决定新会话的初始档位。
   */
  const modelNow = useApp((s) => s.model);
  const setModel = useApp((s) => s.setModel);
  /** 这一轮对话实际走哪条通道（跟聊天那边**共用同一个判断**，别在这里再写一套） */
  const channel = toolProtocolLabel(settings);
  /** 上次探测是什么时候 —— 只在 hydration 之后显示（时间在服务端和客户端算出来不一样） */
  const probeAtText =
    hydrated && settings.toolProbeAt
      ? new Date(settings.toolProbeAt).toLocaleString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  // 通知相关状态（都在 effect 里读，避免 SSR / 客户端不一致）
  const [perm, setPerm] = useState<NotificationPermission | "unsupported" | "loading">("loading");
  const [secure, setSecure] = useState<boolean | null>(null);
  const [sw, setSw] = useState<SwStatus | null>(null);
  const [pushReady, setPushReady] = useState(false);
  const [toast, setToast] = useState("");
  // 背景那几个滑杆默认锁住 —— 手机上滑页面太容易误改
  // 拉取上游模型名：省得用户猜（猜错只会得到一句看不懂的英文报错）
  const [models, setModels] = useState<string[]>([]);
  const [modelMsg, setModelMsg] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  /**
   * 「拉取可用模型」的结果**不再平铺成一片胶囊**（用户：一次拉出 68 个，
   * 铺好几屏、滑不动，屏幕外那些点不到）。改成跟聊天页模型选择器一样的
   * **居中弹层**：搜索过滤 + 列表自己滚 + 当前项反色打勾。
   */
  const [modelPickOpen, setModelPickOpen] = useState(false);
  /** 弹层里的搜索词（几十个名字里一个个翻太累） */
  const [modelPickQuery, setModelPickQuery] = useState("");
  // 结果弹层：Esc 关掉（跟聊天页那个模型弹层同一个手感）
  useEffect(() => {
    if (!modelPickOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModelPickOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modelPickOpen]);
  // 「这把上游认不认原生 tools」—— 用户点一下，用他自己的地址 + key 直接问
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState<ToolProbeResult | null>(null);
  /**
   * 「用哪个上游」是**单选 + 点击展开**（用户要的两个交互）：
   * 一次只有一条通道在用，点哪条就展开哪条的参数，另一条收起。
   * 现在只有「自定义上游」是能用的；「ChatGPT 计划」占位（等 SIWC 接入）。
   */
  const [openChan, setOpenChan] = useState<"custom" | "gpt" | "">("custom");
  /**
   * 点一次展开、再点一次收起（用户 m14953："这个键没用，点了不能收起"）。
   * 原来只会 `setOpenChan("custom")`，于是永远打不开"关"这个状态。
   */
  const toggleChan = (id: "custom" | "gpt") => setOpenChan((c) => (c === id ? "" : id));
  /** 「检测强度支持」的进行中 / 结果（跟工具探测一个套路，见 lib/effort-probe） */
  const [effortBusy, setEffortBusy] = useState(false);
  const [effortResult, setEffortResult] = useState<EffortProbeResult | null>(null);
  /** 「体检这个上游」：五项（模型名/分词指纹/思考开关/tools/流式） */
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<UpstreamProbeResult | null>(null);
  /** 「他主动找你」的通道自检（见 lib/wake-sync）—— 安全：只 fetch Worker，不碰原生 */
  const [wakePinging, setWakePinging] = useState(false);
  const [wakePingMsg, setWakePingMsg] = useState("");
  /**
   * 「清空后台状态，重新来」（用户原话："你把他清空，重新来"）。
   * `armed` = 二次确认（页面上没有现成的确认弹窗，就沿用"再点一下"的老办法，不新做一套 UI）。
   */
  const [wakeResetBusy, setWakeResetBusy] = useState(false);
  const [wakeResetArmed, setWakeResetArmed] = useState(false);
  const [wakeResetMsg, setWakeResetMsg] = useState("");
  /** 后台最近几次醒来的记录（折叠的次要区域；null = 还没读过，[] = 有抽屉但没记录） */
  const [wakeLogOpen, setWakeLogOpen] = useState(false);
  const [wakeLogLines, setWakeLogLines] = useState<string[] | null | undefined>(undefined);
  /** 主路（直接问你的 AI）配好了没 —— 缺哪样都不能问 */
  const upstreamReady = () =>
    Boolean(
      (settings.customBaseUrl ?? "").trim() &&
      (settings.customApiKey ?? "").trim() &&
      (settings.upstreamModel ?? "").trim(),
    );
  /**
   * 他是不是正处于"我说了我在忙"的状态（`busyUntil` 是时间戳，过期自然失效）。
   * 这个判断只影响这一个块显示什么 —— 真正的"不打扰"是后台那段 JS 读抽屉里的
   * `cfg_busy_until` 做的（见 `wake.js` 的三道闸门）。
   */
  const busy = (settings.busyUntil ?? 0) > Date.now();

  async function probeModels() {
    setProbing(true);
    setModelMsg(null);
    setModels([]);
    // 走 lib/platform：App 里没有 /api/models 这个服务端接口，
    // 它会直接问上游（否则拿到 HTML，报一句看不懂的 Unexpected token '<'）。
    const json = await probeUpstreamModels(settings.customBaseUrl, settings.customApiKey);
    if (json.ok && json.models?.length) {
      setModels(json.models);
      // 存进设置里 —— 对话框那个模型选择器显示的就是这份列表
      patch({ upstreamModels: json.models });
      // 68 个名字平铺在页面上没法用，直接开居中弹层让他挑
      setModelPickQuery("");
      setModelPickOpen(true);
      setModelMsg(null);
    } else {
      setModelMsg(json.message ?? "没拉到模型列表，手动填吧");
    }
    setProbing(false);
  }

  /**
   * 探测上游认不认原生 `tools`（function calling）。
   *
   * 三条最小请求都在 `lib/tool-probe` 里，它自己吞掉所有失败
   * （超时 / 非 JSON / HTML 错误页），这里再兜一层 —— 万一它抛出来，
   * 这一页就白了，而这是用户唯一能自测上游的地方。
   */
  async function runToolProbe() {
    setProbeBusy(true);
    setProbeResult(null);
    try {
      const result = await probeToolCalling({
        baseUrl: settings.customBaseUrl,
        apiKey: settings.customApiKey,
        model: settings.upstreamModel,
      });
      setProbeResult(result);
      /**
       * ⭐ 结果要**存进设置**，不只是显示出来。
       *
       * 为什么：聊天那侧每次发请求前都要判断"这把上游能不能发 tools"，
       * 而探测结果原来只活在设置页的 useState 里 —— 一刷新就没了，
       * 于是聊天永远只能走文本协议（P2 接不上）。存进设置之后，
       * `shouldUseNativeTools()` 才读得到（见 lib/use-chat）。
       */
      patch({ toolProbeOk: result.ok, toolProbeAt: Date.now() });
    } catch (err) {
      setProbeResult(failedProbeResult(`探测没跑起来：${(err as Error).message || "未知错误"}`));
    } finally {
      setProbeBusy(false);
    }
  }

  /**
   * 检测「三档强度」是不是真的能调（开思考能开、关思考能关）。
   *
   * 结论写进设置（`effortProbeOk`）—— 聊天那侧只有测过才敢发 `thinking` /
   * `reasoning_effort`，不然老网关会因为多出来的字段整轮 400。
   * 跟上面的工具探测是同一个套路：用户自己点、自己看结论、结论落盘。
   */
  async function runEffortProbe() {
    setEffortBusy(true);
    setEffortResult(null);
    try {
      const result = await probeEffortSupport({
        baseUrl: settings.customBaseUrl,
        apiKey: settings.customApiKey,
        model: settings.upstreamModel,
      });
      setEffortResult(result);
      patch({ effortProbeOk: result.ok, effortProbeAt: Date.now() });
    } catch (err) {
      // effort-probe 自己吞掉所有失败，这里只兜它真抛出来的意外（别让整页白掉）
      setEffortResult({
        ok: false,
        httpOk: false,
        reasoningOn: false,
        reasoningOff: false,
        latencyMs: 0,
        error: `检测没跑起来：${(err as Error).message || "未知错误"}`,
        rawSnippet: "",
      });
    } finally {
      setEffortBusy(false);
    }
  }

  /**
   * **清空重来**（用户："你把他清空，重新来"）。
   *
   * 第一次点只是"装填"（把按钮变成"再点一下，确认清空"），第二次才真清 ——
   * 页面上没有现成的确认弹窗，就沿用最小的二次点击，不为此新做一套 UI。
   * 清空 → 立刻重新交一份配置（见 `lib/wake-sync.ts` 的 `resetWake`），
   * 返回的话**原样显示**（网页版会说"这台上没有抽屉"，真机失败会说失败原因）。
   */
  async function doWakeReset() {
    if (wakeResetBusy) return;
    if (!wakeResetArmed) {
      setWakeResetArmed(true);
      setWakeResetMsg(
        "再点一下确认：会清掉醒来次数、后台日志、上次说话时间、静音标记，还有交给后台的那份配置。",
      );
      return;
    }
    setWakeResetArmed(false);
    setWakeResetBusy(true);
    setWakeResetMsg("");
    try {
      const r = await resetWake();
      setWakeResetMsg(`${r.ok ? "🟢" : "🔴"} ${r.message}`);
      // 清完记录就没了 —— 正打开着的话跟着刷新一下，别显示上一轮的旧日志
      if (wakeLogOpen) setWakeLogLines(await readWakeLog(16));
    } catch (err) {
      // 不吞错误：这是用户手机上唯一能自救的入口
      setWakeResetMsg(`🔴 没跑起来：${(err as Error).message || "未知错误"}`);
    } finally {
      setWakeResetBusy(false);
    }
  }

  /** 展开/收起「后台最近几次醒来」（只在展开时读一次抽屉） */
  async function toggleWakeLog() {
    const next = !wakeLogOpen;
    setWakeLogOpen(next);
    if (!next) return;
    setWakeLogLines(undefined);
    try {
      setWakeLogLines(await readWakeLog(6));
    } catch {
      setWakeLogLines([]);
    }
  }

  useEffect(() => {
    // App 里权限要去问安卓系统，所以是异步的（同步版只会给个占位值）
    void permissionStateAsync().then(setPerm);
    setSecure(secureContextOk());
    void (async () => {
      const reg = await swRegistration();
      if (reg) setSw({ ok: true, message: "已注册（不缓存、不拦截请求）" });
      setPushReady(await pushKeyConfigured());
    })();
  }, []);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 5000);
  }

  async function testNotify() {
    if (!settings.notifications) patch({ notifications: true });
    const p = await requestPermission();
    setPerm(p);
    if (p !== "granted") {
      flash(p === "denied" ? "系统权限被拒绝了，需要去浏览器设置里手动打开" : "没能拿到通知权限");
      return;
    }
    setSw(await registerServiceWorker());
    const ok = await localNotify("栖岛", "这是一条测试通知 —— 收到了就说明本地通知这条链路通了。");
    flash(ok ? "已发出，看一下通知栏" : "发不出去（可能被系统或浏览器限制）");
  }

  async function doSubscribe() {
    const r = await subscribePush();
    setPushReady(await pushKeyConfigured());
    flash(r.message);
  }

  /* ── 我的空间 ── */

  /* ── 外观：材质 / 背景 / 字体 / 对话框配色（用户 m14333 定的版式）── */

  /**
   * 外观页（原「我的空间」）。
   *
   * 这是第一页按「标准件 + 一页一骨架」重做的设置页 —— 用户对着样张
   * `design/appearance-page.html` 说"欧克，动手吧"，长相照那张图来。
   *
   * 三条规矩（后面 5 页照这个来）：
   *   1. **只换骨架，逻辑一个不动**：`patch(...)` 的字段名、默认值、
   *      取值范围全照旧 —— 换的是 DOM 和外形，不是设置本身；
   *   2. 长相一律走 `.k-*`（KFold / KOpt / KOpts / KSlider / KButton），
   *      这一页里不再出现颜色、字号、圆角的具体数值；
   *   3. 每个展开区底部最多留**一句**说明（`.k-hint`）。
   *
   * 为什么原来的样子"没条理"：纯色下 `--aster-line` 是 transparent、
   * `--aster-surface` 就是页面底色 —— 卡片等于没有边界，整页只剩一片灰字
   * 加一堆长句。所以第一步不是加装饰，是**把每张卡变回一张纸**。
   */
  const spaceSections = <SpacePage />;

  /* ── 模型与用量 ── */

  /**
   * 这条通道配没配齐（三样都有才算）。
   * 现在一次只用一条通道 —— 用户原话："在设置里配了就哪个，聊天页就显示当前那个"。
   */
  const chanCustom = Boolean(
    (settings.customBaseUrl ?? "").trim() &&
    (settings.customApiKey ?? "").trim() &&
    (settings.upstreamModel ?? "").trim(),
  );
  /** 设置页显示的档位 = 聊天页当前用的那档（同一个 `model`） */
  const curModel = getModel(
    modelNow ?? "sonnet",
  ); /** 三档是不是"测过且真能调" —— 决定下面那句提示是"已确认"还是"还没测" */
  const effortOk = settings.effortProbeOk === true;
  /** 缓存命中率：命中数 / 输入总数（DeepSeek 的 prompt_tokens 已包含命中的部分） */
  const cacheHitRate =
    usageToday && usageToday.prompt > 0
      ? Math.round((usageToday.cached / usageToday.prompt) * 100)
      : 0;

  const usageSections = (
    <>
      <Section title="用哪个">
        {/*
          B 档玻璃（总则 §3 两层）：外层 = L2 主卡（rounded-[var(--k-card-radius)] + border-line + bg-surface），
          里面两条通道 = L3 控件（bg-chip）。原来两张卡平铺在同一层，看不出"这是一组二选一"。
        */}
        <div className="overflow-hidden">
          <div>
            {/* ① 自定义上游 —— 现在唯一能真用的通道 */}
            <div className="border-b border-line/60">
              <button
                type="button"
                onClick={() => toggleChan("custom")}
                className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
              >
                {/*
                  选中点用 fg 不用 accent：跟 .choice-on 是同一套"选中 = 黑底白字"的语义，
                  三套主题下都会跟着反色（accent 在 dawn 是砖红，点一下就一片红不好看）。
                */}
                <span
                  className={cn(
                    "mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border",
                    chanCustom ? "border-fg" : "border-line",
                  )}
                >
                  {chanCustom && <span className="size-[7px] rounded-full bg-fg" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">自定义上游</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted">
                    {chanCustom
                      ? `${settings.upstreamModel} · ${curModel.label}`
                      : "还没配：填地址 / 密钥 / 模型名"}
                  </span>
                </span>
                <ChevronRight
                  className={cn(
                    "mt-[3px] size-4 shrink-0 text-muted transition-transform",
                    openChan === "custom" && "rotate-90",
                  )}
                />
              </button>
              {openChan === "custom" && (
                <div className="bubble-in px-4 pb-4">
                  <p className="mb-2 text-[11px] leading-4 text-muted">
                    接哪家都行（DeepSeek、智谱、通义，或任何 OpenAI 兼容接口）。
                  </p>
                  <input
                    value={settings.customBaseUrl}
                    onChange={(e) => patch({ customBaseUrl: e.target.value })}
                    placeholder="https://your-proxy/v1"
                    className="k-input mb-2"
                  />
                  <input
                    type="password"
                    value={settings.customApiKey}
                    onChange={(e) => patch({ customApiKey: e.target.value })}
                    placeholder="API Key"
                    className="k-input"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={settings.upstreamModel}
                      onChange={(e) => patch({ upstreamModel: e.target.value.trim() })}
                      placeholder="上游模型名，例如 deepseek-v4-pro"
                      aria-label="上游模型名"
                      className="h-11 min-w-0 flex-1 rounded-[var(--k-card-radius)] border border-line/70 bg-transparent px-3 text-[13px] outline-none"
                    />
                    {/* 次级操作：不是"主按钮"，所以用 chip 底 + 边线，别跟三档抢视觉 */}
                    <button
                      type="button"
                      disabled={
                        !settings.customBaseUrl.trim() || !settings.customApiKey.trim() || probing
                      }
                      onClick={probeModels}
                      data-opt=""
                      className="h-11 shrink-0 rounded-[var(--k-card-radius)] border border-line/70 px-3.5 text-[12px] font-medium disabled:opacity-40"
                    >
                      {probing ? "问上游…" : "拉取可用模型"}
                    </button>
                  </div>
                  {modelMsg && <p className="mt-1.5 text-[11px] leading-4 text-warn">{modelMsg}</p>}
                  {models.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setModelPickQuery("");
                        setModelPickOpen(true);
                      }}
                      data-opt=""
                      className="mt-2 flex w-full items-center justify-between gap-2 rounded-[var(--k-card-radius)] border border-line/70 px-3 py-2.5 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block text-[12px] font-medium">
                          拉到 {models.length} 个模型 —— 点这里挑一个
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">
                          当前：{settings.upstreamModel || "还没选"}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted" />
                    </button>
                  )}

                  {/*
                    结果弹层：**居中模态**（跟聊天页那个模型选择器同一套交互）。
                    原来是把 68 个名字平铺成胶囊墙 —— 铺满好几屏、滑不动，
                    屏幕外那些根本点不到。现在：搜索过滤 + 列表自己滚 + 当前项反色打勾。
                    ⚠️ portal 到 body：这一页的内容区有滚动容器，
                    fixed 留在里面会跟着滚、也会被祖先的 filter/transform 拽偏。
                  */}
                  {modelPickOpen &&
                    (() => {
                      const q = modelPickQuery.trim().toLowerCase();
                      const shown = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
                      return createPortal(
                        <div
                          className="fixed inset-0 z-[120] flex items-center justify-center px-4"
                          role="dialog"
                          aria-modal="true"
                          aria-label="选择上游模型"
                        >
                          <button
                            type="button"
                            aria-label="关闭"
                            onClick={() => setModelPickOpen(false)}
                            className="absolute inset-0 bg-black/45"
                          />
                          <div
                            data-contrast=""
                            className={cn(
                              "aster-pop relative flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-[var(--k-card-radius)] border border-line shadow-[0_20px_60px_rgba(30,20,12,.35)] backdrop-blur-2xl",
                              solidPaper && "paper-card",
                            )}
                          >
                            <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-3.5">
                              <div className="min-w-0">
                                <p className="text-[14px] font-semibold text-fg">用哪个模型</p>
                                <p className="mt-0.5 text-[11px] text-muted">
                                  上游列了 {models.length} 个 · 点一行就用它
                                </p>
                              </div>
                              <button
                                type="button"
                                aria-label="关闭"
                                onClick={() => setModelPickOpen(false)}
                                data-opt=""
                                className="flex size-7 shrink-0 items-center justify-center rounded-full"
                              >
                                <X className="size-4" />
                              </button>
                            </div>

                            <div className="px-4 pb-2">
                              <div
                                data-opt=""
                                className="flex h-9 items-center gap-1.5 rounded-xl border border-line px-2.5"
                              >
                                <Search className="size-3.5 shrink-0 text-muted" />
                                <input
                                  value={modelPickQuery}
                                  onChange={(e) => setModelPickQuery(e.target.value)}
                                  placeholder="搜索模型名…"
                                  aria-label="搜索模型"
                                  className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-subtle"
                                />
                                {modelPickQuery.trim() && (
                                  <button
                                    type="button"
                                    aria-label="清空搜索"
                                    onClick={() => setModelPickQuery("")}
                                    className="shrink-0 text-muted"
                                  >
                                    <X className="size-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* min-h-0 + flex-1 + overflow-y-auto：只有列表滚，头尾固定 */}
                            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-1">
                              {shown.length === 0 ? (
                                <p className="py-6 text-center text-[12px] text-subtle">
                                  没有匹配「{modelPickQuery.trim()}」的模型
                                </p>
                              ) : (
                                shown.map((m) => {
                                  const active = m === settings.upstreamModel;
                                  return (
                                    <button
                                      key={m}
                                      type="button"
                                      onClick={() => {
                                        patch({ upstreamModel: m });
                                        setModelPickOpen(false);
                                        setModelPickQuery("");
                                        setModels([]);
                                        setModelMsg(`已选 ${m}`);
                                      }}
                                      className={cn(
                                        "flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                                        active ? "data-pill" : "text-fg active:bg-chip",
                                      )}
                                    >
                                      <span className="truncate font-mono text-[12.5px]">{m}</span>
                                      {active && <Check className="size-3.5 shrink-0" />}
                                    </button>
                                  );
                                })
                              )}
                            </div>

                            <p className="border-t border-line px-4 py-2 text-[10.5px] leading-4 text-muted">
                              选完会存进设置 —— 聊天页那个模型选择器用的是同一份列表。
                            </p>
                          </div>
                        </div>,
                        document.body,
                      );
                    })()}

                  {/*
                    推理强度：**点选**，不是滑杆（用户："要不改成点的，不然不好适配"）。
                    三个点背后是真参数（thinking 开关 + reasoning_effort），
                    但只有测过（effortProbeOk）才真发 —— 见 lib/effort-probe.ts。
                  */}
                  <p className="mt-3 mb-1.5 text-[12px] text-muted">推理强度</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        data-opt={modelNow === m.id ? undefined : ""}
                        onClick={() => setModel(m.id)}
                        className={cn(
                          "rounded-[var(--k-card-radius)] border py-2.5 text-[13px] font-medium transition-colors",
                          modelNow === m.id ? "choice-on data-pill" : "choice-off",
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p
                    className={cn(
                      "mt-1.5 text-[11px] leading-4",
                      effortOk ? "text-ok" : "text-warn",
                    )}
                  >
                    {effortOk
                      ? "已确认：这台上游支持调强度，三档会真的改变推理深度。"
                      : settings.effortProbeOk === false
                        ? "这台上游不支持调强度 —— 只按默认深度回答，所以这里不摆档位。"
                        : "还没测过：点一下「检测强度支持」，测过三档才真的生效。"}
                  </p>

                  {/* 这一页真正要用户点的那一下 —— 主按钮，跟全局一致用黑底白字 */}
                  <button
                    type="button"
                    disabled={!chanCustom || effortBusy}
                    onClick={runEffortProbe}
                    className="k-btn k-btn--primary k-btn--block mt-2 disabled:border-line/70 disabled:bg-transparent disabled:text-subtle"
                  >
                    {effortBusy ? "正在试着开关思考，稍等…" : "检测强度支持"}
                  </button>
                  {effortResult && !effortBusy && (
                    <div className="mt-2 flex flex-col gap-2">
                      <ProbeLine label="能开思考（回了思考内容）" pass={effortResult.reasoningOn} />
                      <ProbeLine
                        label="能关思考（关了就不思考）"
                        pass={effortResult.reasoningOff}
                      />
                      <p
                        className={cn(
                          "mt-1.5 text-[11px] leading-4",
                          effortResult.ok ? "text-ok" : "text-warn",
                        )}
                      >
                        {effortResult.ok
                          ? "三档真能拉开差距，已经按档位发了。"
                          : (effortResult.error ?? "没测出结果，换个模型再试试。")}
                      </p>
                    </div>
                  )}
                  <p className="mt-2 text-[11px] leading-4 text-subtle">
                    密钥只存在这台设备里，不进代码、不进仓库。
                  </p>

                  {/*
                    体检这个上游（用户 2026-11-01："我比较害怕这种，比如我接 Claude opus
                    他给我用其他模型代替了"）。五项检查，结果直接列出来。
                    「看签名」不靠得住（model 字段、system_fingerprint 都是字符串，代理想抄就抄），
                    真正难抄的是分词指纹。
                  */}
                  <button
                    type="button"
                    disabled={!chanCustom || verifyBusy}
                    onClick={async () => {
                      setVerifyBusy(true);
                      setVerifyResult(null);
                      try {
                        const result = await probeUpstreamModel({
                          base: settings.customBaseUrl ?? "",
                          key: settings.customApiKey ?? "",
                          model: settings.upstreamModel ?? "",
                        });
                        setVerifyResult(result);
                      } catch (err) {
                        setVerifyResult({
                          ok: false,
                          items: [],
                          verdict: [],
                          error: (err as Error).message,
                        });
                      } finally {
                        setVerifyBusy(false);
                      }
                    }}
                    className="k-btn k-btn--block mt-2 disabled:border-line/70 disabled:text-subtle"
                  >
                    {verifyBusy ? "正在体检，会连发几个请求，稍等…" : "体检这个上游（五项）"}
                  </button>
                  {verifyResult && !verifyBusy && (
                    <div className="mt-2 flex flex-col gap-2">
                      {verifyResult.items.map((it) => (
                        <div key={it.key} className="flex items-start gap-2 py-0.5">
                          <span
                            className={cn(
                              "mt-[5px] size-1.5 shrink-0 rounded-full",
                              it.pass === true
                                ? "bg-ok"
                                : it.pass === false
                                  ? "bg-warn"
                                  : "bg-subtle",
                            )}
                          />
                          <span className="min-w-0 flex-1 text-[11.5px] leading-4">
                            <span className="block text-fg">{it.label}</span>
                            <span className="block break-all text-subtle">{it.detail}</span>
                          </span>
                        </div>
                      ))}
                      {verifyResult.verdict.map((v) => (
                        <p key={v} className="mt-1.5 text-[11px] leading-4 text-warn">
                          {v}
                        </p>
                      ))}
                      {verifyResult.error && (
                        <p className="mt-1.5 text-[11px] leading-4 text-warn">
                          {verifyResult.error}
                        </p>
                      )}
                      <p className="mt-1.5 text-[10.5px] leading-4 text-subtle">
                        「分词指纹」这一行请记下来：换站或换模型时再跑一次，数一样才说明是同一个模型。
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ② ChatGPT 计划 —— 占位（SIWC 还没接），先把位置留出来 */}
            <div>
              <button
                type="button"
                onClick={() => toggleChan("gpt")}
                className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
              >
                <span className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border border-line" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-muted">ChatGPT 计划</span>
                  <span className="mt-0.5 block text-[11px] text-subtle">未开通</span>
                </span>
                <ChevronRight
                  className={cn(
                    "mt-[3px] size-4 shrink-0 text-muted transition-transform",
                    openChan === "gpt" && "rotate-90",
                  )}
                />
              </button>
              {openChan === "gpt" && (
                <div className="bubble-in px-4 pb-4">
                  <button type="button" disabled className="k-btn k-btn--block mt-2.5 text-subtle">
                    登录 ChatGPT（还没接）
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </Section>

      <Section title="今天用掉的">
        <div className="flex flex-col gap-1 py-1">
          {usageToday ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[15px] font-medium">今天 {usageToday.calls} 次请求</p>
                <p className="shrink-0 text-[12px] text-muted">
                  输入 {usageToday.prompt.toLocaleString()} · 输出{" "}
                  {usageToday.completion.toLocaleString()}
                </p>
              </div>
              <p className="mt-1.5 text-[12px] text-muted">
                缓存命中 {usageToday.cached.toLocaleString()}（{cacheHitRate}%）
              </p>
            </>
          ) : (
            <p className="text-[13px] text-subtle">今天还没发过消息。</p>
          )}
          <p className="mt-2 text-[12px] leading-5 text-muted">
            花的是你自己的 key，本机不做任何限制，只如实记录上游返回的用量。
          </p>
        </div>
      </Section>

      {/*
        「当前模型」那一块**已删除**（用户要求）。
        原因：对话框里已经加了推理档位选择器（快答/均衡/深思），这里再放一套就是重复的
        —— 两处都能改，改哪儿都容易漏，而且用户根本不知道以哪个为准。
        现在**唯一入口在对话框**（输入框右边那个「均衡 ⌄」）。
        注意：`settings.defaultModel` 这个字段还留着（新会话会读它做默认），
              只是不再有界面去改它；对话框改变的是当前会话用的 model。
      */}

      <Section title="上下文与内存">
        <Link
          to="/memory"
          className="flex items-center justify-between gap-3 rounded-[var(--k-card-radius)] px-3.5 py-3"
        >
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">预算 · 缓存 · 存储</span>
            <span className="mt-0.5 block text-[11px] text-muted">
              上下文 {settings.contextBudget} tokens · 保留最近 {settings.keepRecent} 条
            </span>
            <span className="mt-0.5 block text-[11px] text-subtle">
              缓存命中率、思考链保留、本地占用都在这一页
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted" />
        </Link>
      </Section>

      {/* 工具调用探测：下一版要用原生 tools 干活，先得知道这把上游认不认 */}
      <Section title="工具调用（原生 tools）">
        <p className="mb-2 text-[12px] leading-5 text-muted">
          栖岛用「原生工具调用」干活 —— 但这件事实在取决于上游：有的中转会把工具调用
          吞掉、变成一坨普通文字，有的直接报错（还有的只跟流式一起给）。点一下测出来，再决定怎么接。
          <br />
          用的就是上面那三格（地址 / 密钥 / 模型名），密钥只在本机这次请求里用。
        </p>
        {/* 现在到底走哪条通道 —— 不写清楚的话，用户永远不知道自己处在哪个状态 */}
        <div className="mb-2 flex flex-col gap-2">
          <p className="text-[12px] leading-5">
            现在走的是：
            <span className="font-medium">
              {channel.native ? "原生工具调用" : "正文里的动作块（保底那套）"}
            </span>
          </p>
          <p className="mt-1 text-[11px] leading-4 text-muted">
            {channel.text}
            {!channel.native && probeAtText ? `（上次测于 ${probeAtText}）` : ""}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {(
              [
                ["auto", "自动"],
                ["native", "原生"],
                ["text", "保底"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-opt={(settings.toolProtocol ?? "auto") === id ? undefined : ""}
                onClick={() => patch({ toolProtocol: id })}
                className={cn(
                  "rounded-full px-3 py-2 text-[12px] font-medium",
                  (settings.toolProtocol ?? "auto") === id && "data-pill",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/*
          发多少动作：按需（P3）/ 全发。
          用户原话："就是根据对话判断我需要什么样的工具才会调用，其他的就不每一轮都发给它"
          —— 61 个动作的定义每轮 ≈ 4007 token，按需能砍到 1/3 左右。
        */}
        <div className="mb-2 flex flex-col gap-2">
          <p className="text-[12px] leading-5">每次发多少工具</p>
          <div className="mt-2 grid grid-cols-2 gap-1">
            {(
              [
                ["auto", "按需（推荐）"],
                ["all", "全部发"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-opt={
                  ((settings.toolCatalog ?? "auto") === "auto" ? "auto" : "all") === id
                    ? undefined
                    : ""
                }
                onClick={() => patch({ toolCatalog: id })}
                className={cn(
                  "rounded-full px-3 py-2 text-[12px] font-medium",
                  ((settings.toolCatalog ?? "auto") === "auto" ? "auto" : "all") === id &&
                    "data-pill",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          disabled={
            !settings.customBaseUrl.trim() ||
            !settings.customApiKey.trim() ||
            !settings.upstreamModel.trim() ||
            probeBusy
          }
          onClick={runToolProbe}
          data-opt=""
          className="h-11 w-full rounded-[var(--k-card-radius)] px-3.5 text-[13px] font-medium disabled:opacity-40"
        >
          {probeBusy ? "正在问上游，稍等…（最多 20 秒）" : "测一测这个上游支不支持工具调用"}
        </button>
        {probeResult && !probeBusy && (
          <div className="mt-2 flex flex-col gap-2">
            <ProbeLine label="认 tools 参数" pass={probeResult.nonStreamToolCall} />
            <ProbeLine label="流式下能识别到工具调用" pass={probeResult.streamToolCall} />
            <ProbeLine label="一次能返回多个工具调用" pass={probeResult.multiToolCall} />
            <p className="mt-1.5 text-[12px] text-muted">耗时 {probeResult.latencyMs} ms</p>
            <p
              className={cn(
                "mt-1.5 text-[12px] leading-5",
                probeResult.ok ? "text-muted" : "text-warn",
              )}
            >
              {probeResult.ok
                ? probeResult.error
                  ? `整体能用，但有一处要留意：${probeResult.error}`
                  : "整体能用 —— 可以按原生工具调用来做。"
                : (probeResult.error ?? "没测出结果，换个地址或模型再试试。")}
            </p>
            {probeResult.rawSnippet && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-subtle">看原始返回片段</summary>
                <pre className="mt-1.5 max-h-56 overflow-auto rounded-xl bg-elevated p-2 text-[11px] leading-4 whitespace-pre-wrap text-muted">
                  {probeResult.rawSnippet}
                </pre>
              </details>
            )}
          </div>
        )}
      </Section>
    </>
  );

  /* ── 数据（备份 / 恢复） ── */

  /**
   * 这一页**只有**备份恢复。
   *
   * 记忆库、世界书已经归到「AI 概览」那一层了（`/core` 的「往下看」四项），
   * 这里不再放一份 —— 同一个入口出现两次，用户会以为是两个不同的地方。
   */
  const dataSections = <BackupSection bare />;

  /* ── 系统 ── */

  <div className="sys-list">
    {/*
        「定时任务」那一段**已挪到「玩乐 → 小日子 → 定时任务」**
        （跟闹钟一起挪的，用户要求，理由是"这样看着分类更准一点"）。
        这一页不再重复。
      */}
  </div>;
  /**
   * 「系统」原页里的五块，抽成对象：现在它们分别属于新的五个二级页
   * （对话 / 主动与通知 / 语音 / 隐私与数据 / 关于与高级）。
   * 分派在文件最末尾，旧 tab 仍在，改完页面后可以整块删掉。
   */
  /**
   * 「系统」原页里的五块，现在分别是五个二级页的正文。
   *
   * 为什么拆成 `{ title, value, order, body }` 而不是整块 JSX：
   * 用户要求「对话 / 主动与通知 / 语音 点进去直接把里面的东西铺开」——
   * 整块 JSX 没法去掉外壳再复用内容，所以把标题和正文分开，壳由页面自己拼：
   * 对话页三个分类各一张卡，其他页把正文直接摆进一张卡。
   * 旧 tab `/system` 仍然把它们还原成可折叠的 Group，等旧页删掉一起走。
   */
  const sysGroups = {
    chat: {
      title: "聊天",
      value: "思考链 · 说话方式 · 表情包",
      order: 4,
      body: (
        <>
          <Sub title="思考链">
            {/* 只留「显示」—— 「保存思考链」已去掉：
            思考过程回复时你当场就能看到，再存一份纯占地方（用户明确要求删）。 */}
            <Row
              label="显示思考过程"
              checked={settings.showThinking}
              onChange={(v) => patch({ showThinking: v })}
            />
            {/*
          这两项原来在「我的空间 → 个性化」里（最大输出长度 + 回复风格），
          用户要求挪到思考链这边：
          "思考链的最大输出长度和模型回复风格放思考链那里，不要放在个性化那里"。
          它们本来就跟"思考多深 / 回答多长"是一回事，放这儿更贴。
        */}
            <p className="k-sect__title mt-4">最大输出长度</p>
            <KOpts cols={2}>
              {[
                { v: 0, label: "跟随档位" },
                { v: 8192, label: "8192" },
                { v: 16384, label: "16384" },
                { v: 32768, label: "32768" },
              ].map((o) => (
                <KOpt
                  key={o.v}
                  active={settings.maxTokens === o.v}
                  onClick={() => patch({ maxTokens: o.v })}
                >
                  {o.label}
                </KOpt>
              ))}
            </KOpts>

            <p className="k-sect__title mt-4">回复风格</p>
            <KOpts cols={4}>
              {STYLES.map((s) => (
                <KOpt
                  key={s.id}
                  active={settings.replyStyle === s.id}
                  onClick={() => patch({ replyStyle: s.id })}
                >
                  {s.label}
                </KOpt>
              ))}
            </KOpts>
          </Sub>

          {/*
        ── 说话方式：**分段回复**（2026-11 用户要的）─────────────────────
        用户原话："他这个回复只能我回一句，他回一句，就感觉不像真人；
        能不能他分段回呢？一句就跟发消息似的，可以发好几条那种。"
        以及："分段做成可调节的吧，就是我自己设置最多几句。"

        所以四个旋钮都摆在这儿，**不写死在代码里** —— 效果不对他自己拧，
        不用等我改代码重新打包。切分逻辑见 `lib/segment.ts`。
      */}
          <Sub title="说话方式">
            <Row
              label="分段回复"
              checked={settings.segmentReply !== false}
              onChange={(v) => patch({ segmentReply: v })}
            />
            {settings.segmentReply !== false && (
              <>
                <p className="k-sect__title mt-4">段间延迟</p>
                <KOpts cols={3}>
                  {[400, 800, 1200, 1800, 2500].map((v) => (
                    <KOpt
                      key={v}
                      active={(settings.segmentDelayMs ?? 1200) === v}
                      onClick={() => patch({ segmentDelayMs: v })}
                    >
                      {(v / 1000).toFixed(1)} 秒
                    </KOpt>
                  ))}
                </KOpts>
              </>
            )}
          </Sub>

          {/*
        ── 表情包（2026-11 用户要的"他自己会发表情"）─────────────────
        两块：① 入库时**去白底**（照片/白底截图 → 真正的透明表情）
             ② 他能**自己决定发一张**（动作 `sticker.send`，挑哪张由客户端定）
        "按情绪挑"要等"给表情打标签"那一步，所以这里先不给它编不存在的开关。
      */}
          <Sub title="表情包">
            <Row
              label="传表情时自动去白底"
              checked={settings.stickerRemoveWhite !== false}
              onChange={(v) => patch({ stickerRemoveWhite: v })}
            />
          </Sub>
        </>
      ),
    },
    notify: {
      title: "通知",
      value: "本地通知 · 测试通知",
      order: 1,
      body: (
        <>
          <Sub title="允许通知">
            <Row
              label="允许通知"
              checked={settings.notifications}
              onChange={(v) => {
                patch({ notifications: v });
                if (!v) return;
                void (async () => {
                  const p = await requestPermission();
                  setPerm(p);
                  setSw(await registerServiceWorker());
                  setPushReady(await pushKeyConfigured());
                })();
              }}
            />

            <div className="k-inset">
              <p>
                系统权限：
                <span className={perm === "granted" ? "text-ok" : "text-warn"}>
                  {perm === "loading" ? "读取中…" : (PERMISSION_LABEL[perm] ?? perm)}
                </span>
              </p>
              <p>
                HTTPS 环境：
                <span className={secure ? "text-ok" : "text-warn"}>
                  {secure === null ? "读取中…" : secure ? "满足" : "不满足（SW 与推送都用不了）"}
                </span>
              </p>
              <p>
                Service Worker：
                <span className={sw?.ok ? "text-ok" : "text-warn"}>{sw?.message ?? "未注册"}</span>
              </p>
              <p>
                后台推送：
                <span className={IS_APP || pushReady ? "text-ok" : "text-warn"}>
                  {IS_APP
                    ? "App 里用安卓系统通知，不用它"
                    : pushReady
                      ? "服务端已配好，可订阅"
                      : "服务端还没配 VAPID 密钥"}
                </span>
              </p>
            </div>

            <div className="k-hstack">
              <KButton onClick={() => void testNotify()}>发一条测试通知</KButton>
              <KButton onClick={() => void doSubscribe()}>订阅后台推送</KButton>
            </div>
            {toast && <p className="k-hint">{toast}</p>}
          </Sub>

          {/*
          **「他主动找你」的说明卡**（2026-10 加）。
          用户的诉求："定时任务还是只有点开 app 才可以发消息" / "不要再留网页的设计思路了"
          —— 原来的定时任务靠页面里每 30 秒查一次，一关 App 就没了。
          新的做法是交给安卓系统定时叫醒一段跑在网页外面的 JS（见 public/runners/wake.js）。

          ⚠️ 这里**故意没有按钮** —— 曾经有个「现在试一次」，它调插件的 `dispatchEvent`，
          而那个方法在安卓侧用 `runBlocking` 挡住**主线程**、再无限期等 JS 回调（没有超时）
          → 主线程等 JS、JS 等主线程 → **死锁**。
          用户真机实测：点一下之后"一直写着正在叫他"，**整个 App 卡住不动**。
          那条路已经拿掉；要验"通道通不通"用下面的**通道自检**（它只是 fetch，安全）。

          ⚠️ 两个排版坑都踩过（用户截图反馈"跟下面的按钮叠在一起了"）：
            · 卡片原来只写了 `mt-2`、后面那排按钮只写了 `mb-2` → 上下间距**恰好 0**
              （量过：卡片底边 1036、按钮顶边 1036）→ 看起来像叠在一起。现在给足 mb-4。
            · JSX 里**不能写 `**粗体**`**（markdown 语法在网页里不渲染，会原样显示星号）
              —— 用户截图里那句就带着两个星号。要强调就直接说，或用 <b>。
        */}
          <Sub title="让他主动找你">
            {/*
            **总开关**（用户原话："这个定时唤醒要做个开关，哪一天我不想他跑了，可以一键关闭"）。
            关掉之后：Worker 一次 AI 都不问、不弹通知；后台那段 JS 还会把"静音"记下来，
            接下来 4 小时连请求都不发（省电）。
            唯一关不掉的是"系统每 1 小时来一次"这个节拍 —— 它写在打包配置里。
          */}
            <Row
              label="让他主动找我"
              checked={settings.wakeEnabled ?? true}
              onChange={(v) => patch({ wakeEnabled: v })}
            />

            {!wakeSupported() && (
              <p className="mt-1 text-[11px] leading-4 text-warn">（网页版没有后台任务）</p>
            )}

            {(settings.wakeEnabled ?? true) && (
              <>
                {/*
            用户最后拍板的规矩（原话）：
              "每隔一小时系统起程序，叫 ai 概率各一半，这次没叫就下次，
               然后 ai 说话也是说不说各 50，这次没说下次必定说，
               这样最少四小时也会说一次对吧"
            → 两个 50%，各自"没中就下次必定" → 最坏 4 小时一定有一句。他算的是对的。
          */}
                {/*
            通道状态。现在**主路是"直接问你的 AI"**（甲）：
            后台那段 JS 醒来 → 从 App 交给它的抽屉里读配置 → 直接打你的上游（国内、不用梯、不用域名）。
            Worker（乙）只是备路，只有配了地址才会用。
          */}
                <p className="mt-2 text-[11px] leading-4">
                  通道：
                  <span className={upstreamReady() ? "text-ok" : "text-warn"}>
                    {upstreamReady()
                      ? "直接问你的 AI（不用梯、不用域名）"
                      : "还没配自定义上游（地址 / 密钥 / 模型）"}
                  </span>
                </p>

                {/* 夜间不打扰 */}
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-muted">夜间不打扰</span>
                  <select
                    value={settings.wakeQuietStart ?? 1}
                    onChange={(e) => patch({ wakeQuietStart: Number(e.target.value) })}
                    className="k-input w-16"
                    aria-label="夜间从不打扰开始的小时"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {h}:00
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-muted">→</span>
                  <select
                    value={settings.wakeQuietEnd ?? 8}
                    onChange={(e) => patch({ wakeQuietEnd: Number(e.target.value) })}
                    className="k-input w-16"
                    aria-label="夜间不打扰结束的小时"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {h}:00
                      </option>
                    ))}
                  </select>
                </div>

                {/*
            ── 主动说话的三个闸门（2026-11 用户要的）────────────────────
            用户原话："设置一个回复的约定或按钮，我主动说忙，他自动调低，否则原来就行。"
            ＋ "他自己情绪到了，也可以发吧……或者你给情绪那个加个按钮，只单独管情绪发消息这个。"
            ＋ "降频那个不用"（所以**没有**"你不理他就自动降频"）。
            默认值：最短 40 分钟、每天最多 8 条 —— 这两条是防骚扰的地板。
          */}
                <div className="k-inset">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-[12px] leading-5">
                      {busy ? (
                        <>
                          <span className="text-warn">我现在忙</span>
                          <br />
                          <span className="text-subtle">
                            他不会再主动说话，到{" "}
                            {new Date(settings.busyUntil ?? 0).toLocaleTimeString("zh-CN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            自动恢复
                          </span>
                        </>
                      ) : (
                        <>
                          我没在忙
                          <br />
                          <span className="text-subtle">他还是按下面那两条频率规矩来找你</span>
                        </>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        patch({ busyUntil: busy ? 0 : Date.now() + 2 * 60 * 60 * 1000 })
                      }
                      className="shrink-0 rounded-[var(--k-card-radius)] border border-line px-3 py-2 text-[12px]"
                    >
                      {busy ? "取消" : "我在忙（2 小时）"}
                    </button>
                  </div>
                </div>

                <Row
                  label="心情可以单独让他开口"
                  checked={settings.emotionSpeak !== false}
                  onChange={(v) => patch({ emotionSpeak: v })}
                />

                <p className="k-row__title">最短间隔（两次主动说话之间）</p>
                <KOpts cols="wrap">
                  {[30, 40, 60, 90, 120].map((v) => (
                    <KOpt
                      key={v}
                      active={(settings.wakeMinGapMin ?? 40) === v}
                      onClick={() => patch({ wakeMinGapMin: v })}
                    >
                      {v} 分钟
                    </KOpt>
                  ))}
                </KOpts>

                <p className="k-row__title">每天最多主动说几条</p>
                <KOpts cols="wrap">
                  {[4, 6, 8, 12].map((v) => (
                    <KOpt
                      key={v}
                      active={(settings.wakeDailyMax ?? 8) === v}
                      onClick={() => patch({ wakeDailyMax: v })}
                    >
                      {v} 条
                    </KOpt>
                  ))}
                </KOpts>

                {/*
            通道自检：安全，只是 fetch 一下 Worker。
            ⚠️ 绝不调插件的 dispatchEvent（那个会让整个 App 卡死）。
          */}
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={wakePinging}
                    onClick={() => {
                      setWakePinging(true);
                      setWakePingMsg("");
                      void pingWake()
                        .then((r) => setWakePingMsg(`${r.ok ? "🟢" : "🔴"} ${r.message}`))
                        .finally(() => setWakePinging(false));
                    }}
                    data-opt=""
                    className="rounded-full px-4 py-2 text-[12px] font-medium disabled:opacity-40"
                  >
                    {wakePinging ? "正在试…" : "通道自检"}
                  </button>
                  {/*
              「清空重来」（用户："你把他清空，重新来"）。
              连点两下才真清（页面上没有现成的确认弹窗，就沿用"再点一次"的老办法）。
              网页版没有抽屉 → lib 里会如实说"这台上没有抽屉"，不装成功。
            */}
                  <button
                    type="button"
                    disabled={wakeResetBusy}
                    onClick={() => void doWakeReset()}
                    data-opt=""
                    className="rounded-full px-4 py-2 text-[12px] font-medium disabled:opacity-40"
                  >
                    {wakeResetBusy
                      ? "正在清…"
                      : wakeResetArmed
                        ? "再点一下，确认清空"
                        : "清空后台状态，重新来"}
                  </button>
                </div>
                {wakePingMsg && (
                  <p className="mt-1.5 text-[11px] leading-4 text-subtle">{wakePingMsg}</p>
                )}
                {wakeResetMsg && (
                  <p className="mt-1.5 text-[11px] leading-4 text-subtle">{wakeResetMsg}</p>
                )}

                {/*
            后台记录（只读、折叠的次要区域）—— 用户手机上这块原来是黑盒：
            连续失败 90 次他也只能看到通知里那一句英文报错。这里直接把 `wake_log` 摊开，
            里面就带着后台**自己诊断出来的结论**（后台没网 / 只有你的上游解析不出来 / 上游连不上）。
            ⚠️ 抽屉读回来的 key 被原生打码成「已设置」；日志里也从不写 key。
          */}
                <button
                  type="button"
                  onClick={() => void toggleWakeLog()}
                  aria-expanded={wakeLogOpen}
                  className="mt-2 text-[11px] leading-4 text-subtle underline decoration-dotted underline-offset-2"
                >
                  {wakeLogOpen ? "收起后台记录" : "看后台记录（最近 16 条）"}
                </button>
                {wakeLogOpen && (
                  <div className="k-inset k-inset--flat">
                    {wakeLogLines === undefined ? (
                      <p className="text-[11px] leading-4 text-subtle">正在读后台的记录…</p>
                    ) : wakeLogLines && wakeLogLines.length > 0 ? (
                      <>
                        <p className="text-[11px] leading-4 text-subtle">
                          后台最近 {wakeLogLines.length} 条记录（最近的在最上面）：
                        </p>
                        <ul className="mt-1 space-y-1">
                          {wakeLogLines.map((line, i) => (
                            <li key={i} className="text-[11px] leading-4 break-all text-muted">
                              {line}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="text-[11px] leading-4 text-subtle">
                        {wakeLogLines === null
                          ? "后台还没有记录（这台上没有抽屉，网页版没有后台任务）。"
                          : "后台还没有记录。"}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </Sub>

          {/*
        额度提醒（40 次 / 5 小时的窗口配额）**整套删掉了** —— 2026-11 用户定了产品边界：
        其他用户一律自带自己的 key/地址（"不能把我的 Key 给他们"），「内置服务端 + 内置额度」
        这条路不走。自己 key 花自己的钱、永不拦（`bumpQuota` 里早就是这个逻辑），这个开关和
        服务端配额一起失去意义，留着只会是死开关。
        字段 `quotaAlerts` / `quota` 仍留在 types 与 store 里：老档案里可能存过，删字段会让
        迁移与恢复变复杂，留着无害。
      */}
          {/*
          「日记提醒」原来是**提醒用户**写日记（弹一条"今天还没写日记"）——
          2026-10 用户纠正："日记是让他写，不是提醒给我写。" 所以改成：
          **他每天写一篇（到点还没写就唤醒他补）**，不再打扰用户。
          （用户定的参数：保底时间晚上八点半；日记不弹通知。）
        */}
          <Sub title="日记">
            <Row
              label="日记（他每天写一篇）"
              checked={settings.diaryReminders}
              onChange={(v) => patch({ diaryReminders: v })}
            />
          </Sub>

          {/*
          **活跃度**（2026-10 用户定的"他自己的日子"第一批）。
          用户原话："每天他不定时唤醒，做他自己想能做的……" —— 这一档决定他一天自己动几次。
        */}
          <Sub title="他自己的日子">
            <Row
              label="他自己的日子"
              checked={settings.autonomyEnabled !== false}
              onChange={(v) => patch({ autonomyEnabled: v })}
            />

            <p className="k-row__title">他的活跃度（一天自己动几次）</p>
            <KOpts cols={3}>
              {WAKE_LEVELS.map((lv) => (
                <KOpt
                  key={lv.id}
                  active={(settings.wakeLevel ?? "daily") === lv.id}
                  onClick={() => patch({ wakeLevel: lv.id })}
                >
                  {lv.label}
                </KOpt>
              ))}
            </KOpts>
          </Sub>

          {/*
          「闹钟 / 提醒」的列表入口**已挪到「玩乐 → 小日子 → 闹钟」**
          （用户："把闹钟和定时任务都挪到小日子这个组件里面呗，
                 然后我的区里面就删掉就不用重复了"）。
          这里只留上面那个"日记提醒时间"的开关 —— 它属于通知设置，不是闹钟。
        */}
        </>
      ),
    },
    weather: {
      title: "天气与定位",
      value: "自动定位 · 城市 · 单位",
      order: 3,
      body: (
        <>
          <Sub title="天气与定位">
            <Row
              label="让他知道你在哪、外面什么天气"
              checked={settings.geoEnabled}
              onChange={(v) => patch({ geoEnabled: v })}
            />

            {settings.geoEnabled && (
              <>
                {/* ── 手动指定地点：不依赖任何服务，永远可用 ── */}
                <p className="k-sect__title mt-4">你常待的地方</p>
                <input
                  value={settings.manualPlace}
                  onChange={(e) => patch({ manualPlace: e.target.value })}
                  placeholder="例如 北京市朝阳区"
                  aria-label="手动指定地点"
                  className="k-input"
                />

                {/* ── 和风天气：一次配好，定位（反查地名）和天气都能用 ── */}
                <p className="k-sect__title mt-4">和风天气</p>
                <input
                  value={settings.qweatherHost}
                  onChange={(e) => patch({ qweatherHost: e.target.value.trim() })}
                  placeholder="API Host · abcd1234.re.qweatherapi.com"
                  aria-label="和风 API Host"
                  className="k-input mb-2 font-mono"
                />
                <input
                  type="password"
                  value={settings.qweatherKey}
                  onChange={(e) => patch({ qweatherKey: e.target.value.trim() })}
                  placeholder="API Key"
                  aria-label="和风 API Key"
                  className="k-input font-mono"
                />

                {/* ── 现在在哪 / 什么天气 ── */}
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-[12px] leading-5">
                      {settings.manualPlace.trim() ? (
                        <>
                          用手动地点：<span className="text-fg">{settings.manualPlace.trim()}</span>
                        </>
                      ) : settings.geoLabel ? (
                        <>
                          现在在<span className="text-fg">{settings.geoLabel}</span>
                          {/*
                        ⚠️ **来源必须写在脸上**（2026-11 用户原话："点刷新还是刷到了海南"）。
                        IP 猜的城市在国内移动网络下可能差几个省，不标明就会让人以为"定位坏了"，
                        而实际上"IP 猜的"和"系统定的"是两回事 —— 前者本来就不该当事实用。
                      */}
                          {settings.geoSource === "ip" ? (
                            <span className="text-warn">（按 IP 猜的，不可靠）</span>
                          ) : settings.geoSource === "system" ? (
                            <span className="text-subtle">（系统定的）</span>
                          ) : null}
                          {settings.geoAt ? ` · ${relShort(settings.geoAt)}` : ""}
                        </>
                      ) : (
                        "还没定位过"
                      )}
                      {settings.weatherText && (
                        <>
                          <br />
                          外面：<span className="text-fg">{settings.weatherText}</span>
                          {settings.weatherAt ? ` · ${relShort(settings.weatherAt)}` : ""}
                        </>
                      )}
                    </span>
                    <KButton
                      disabled={geoBusy}
                      onClick={() => {
                        /*
                      开关关着的时候**必须明说**，不能什么都不发生。
                      用户实测："天气也是填完之后也没有动静，能不能调用，
                      不清楚，也没有保存和错误提示" —— 就是这里的锅：
                      原来 refreshPlaceAndWeather 直接返回一个 ok:false，
                      而按钮那边对"没反应"没有任何提示，看起来就像坏了。
                    */
                        if (!settings.geoEnabled) {
                          setGeoMsg(
                            "上面那个开关是关着的 —— 先打开它，地点和天气才会去查。（关着的时候不会发任何请求）",
                          );
                          return;
                        }
                        if (!settings.manualPlace.trim() && !settings.qweatherKey.trim()) {
                          setGeoMsg(
                            "还没有可用的方式：要么在「你常待的地方」填一个（最简单、不用联网），要么填上和风天气的 Key 和 API Host 用自动定位。",
                          );
                          return;
                        }
                        setGeoBusy(true);
                        setGeoMsg("");
                        void refreshPlaceAndWeather(true).then((r) => {
                          setGeoBusy(false);
                          if (r.ok) {
                            setGeoMsg(
                              r.weather
                                ? `已更新：${r.label} · ${r.weather}`
                                : `已更新地点：${r.label}${r.note ? `（${r.note}）` : ""}`,
                            );
                          } else {
                            setGeoMsg(r.reason);
                          }
                        });
                      }}
                      className="shrink-0"
                    >
                      {geoBusy ? "刷新中…" : "刷新"}
                    </KButton>
                  </div>
                  {geoMsg && <p className="mt-2 text-[11px] leading-4 text-subtle">{geoMsg}</p>}
                </div>
              </>
            )}
          </Sub>
        </>
      ),
    },
    voice: {
      title: "语音",
      value: "服务商 · 模型 · 音色",
      order: 2,
      body: (
        <>
          <Sub title="朗读回复">
            <Row
              label="朗读回复"
              checked={settings.voiceReplies}
              onChange={(v) => patch({ voiceReplies: v })}
            />
          </Sub>

          {/*
          语音服务：两家分开（用户 m10646 要求的分法）。
          ⚠️ 安卓系统 TTS 已删 —— "试听像手机自带的 YOYO"就是它顶着，
          删掉之后合成失败会直说，不再冒充。
        */}
          <Sub title="语音服务">
            <div className="k-tabs">
              {[
                { k: "openai" as const, label: "1 · OpenAI 兼容" },
                { k: "elevenlabs" as const, label: "2 · ElevenLabs" },
                /*
                百炼（阿里）：不是 OpenAI 形状，但音质和"自己捏嗓子"是这几家里最好的。
                用户 m10841："这个百炼这个是千问的语音模型对吗，那音色呢，能自己捏吗"。
              */
                { k: "dashscope" as const, label: "3 · 百炼" },
              ].map((tab) => (
                <button
                  key={tab.k}
                  type="button"
                  data-active={tab.k === voiceProvider ? "true" : undefined}
                  onClick={() => {
                    if (tab.k === voiceProvider) return;
                    patch({
                      voiceBaseUrl:
                        tab.k === "elevenlabs"
                          ? "https://api.elevenlabs.io/v1"
                          : tab.k === "dashscope"
                            ? "https://dashscope.aliyuncs.com"
                            : "https://api.siliconflow.cn/v1",
                      /* 换家时把不通用的小格子清掉，免得带着上家的模型名去请求 */
                      ...(tab.k === "dashscope"
                        ? {
                            voiceTtsModel: "qwen-audio-3.1-tts-flash",
                            voiceTtsVoice: "longanhuan_v3.1",
                            voiceAsrModel: "",
                          }
                        : {}),
                    });
                    setVoiceModels([]);
                    setElevenVoices([]);
                    setDsVoices([]);
                    setDsVoiceStatus({});
                    setDesignMsg("");
                    setVoiceMsg("");
                  }}
                  className="k-tab"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {[
              { k: "voiceBaseUrl" as const, label: "地址", ph: "https://api.siliconflow.cn/v1" },
              { k: "voiceApiKey" as const, label: "密钥", ph: "sk-…", secret: true },
            ].map((f) => (
              <div key={f.k} className="mt-2 block">
                <span className="mb-1 block text-[11px] text-muted">{f.label}</span>
                <input
                  type={f.secret ? "password" : "text"}
                  value={(settings[f.k] as string | undefined) ?? ""}
                  onChange={(e) => patch({ [f.k]: e.target.value } as Partial<typeof settings>)}
                  placeholder={f.ph}
                  className="k-input"
                />
              </div>
            ))}

            {[
              { k: "voiceAsrModel" as const, label: "转文字", pick: "asr" as const },
              { k: "voiceTtsModel" as const, label: "合成", pick: "tts" as const },
              { k: "voiceTtsVoice" as const, label: "音色", pick: "voice" as const },
            ]
              /* 百炼只接"说"，不接"听"：它那套转文字是另一个接口，这里不硬凑 */
              .filter((f) => !(voiceProvider === "dashscope" && f.k === "voiceAsrModel"))
              .map((f) => {
                const cur = (settings[f.k] as string | undefined) ?? "";
                return (
                  <div key={f.k} className="mt-2 block">
                    <span className="mb-1 block text-[11px] text-muted">{f.label}</span>
                    <button
                      type="button"
                      data-opt=""
                      onClick={() => {
                        setVoicePick(f.pick);
                        setVoicePickQuery("");
                      }}
                      className="flex h-10 w-full items-center gap-2 rounded-[var(--k-card-radius)] px-3 text-left text-[12px] text-fg"
                    >
                      <span className="flex-1 truncate font-mono text-[11px]">
                        {cur || "（点这里选）"}
                      </span>
                      <ChevronRight className="size-3.5 shrink-0 text-subtle" />
                    </button>
                  </div>
                );
              })}

            <p className="mt-2 flex items-center gap-1.5 text-[11px] leading-4 text-subtle">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              正在用 {(settings.voiceTtsModel ?? "").split("/").pop() || "—"} ·{" "}
              {(settings.voiceTtsVoice ?? "").trim() || "—"}
              {(() => {
                /**
                 * 音色状态（用户 m11120 的「合成失败」最可能就是它）：
                 * 刚用声音设计造出来的嗓子先是 DEPLOYING，要等几分钟才能合成。
                 * 不在这儿说，用户只会以为是我写坏了。
                 */
                const hint = dsVoiceStatusHint(
                  dsVoiceStatus[(settings.voiceTtsVoice ?? "").trim()],
                );
                return hint ? <span className="text-accent"> · {hint}</span> : null;
              })()}
            </p>

            <button
              type="button"
              data-opt=""
              className="k-input mt-2"
              onClick={async () => {
                setVoiceMsg(voiceProvider === "openai" ? "正在拉取…" : "正在拉取音色…");
                const r = await listVoiceModels();
                if (!r.ok) {
                  setVoiceMsg(r.reason);
                  return;
                }
                setVoiceModels(r.models);
                setElevenVoices(r.voices);
                /**
                 * **百炼**：`models` 是它固定的几个合成模型，
                 * `voices` 是你在控制台 / App 里捏出来的自定义音色（绑在这个模型上的）。
                 */
                if (voiceProvider === "dashscope") {
                  setDsVoices(r.voices);
                  setDsVoiceStatus(r.voiceStatus ?? {});
                  setVoiceMsg(
                    r.voices.length > 0
                      ? `这个模型下有你建的 ${r.voices.length} 个音色：点上面「音色」那一格挑一个。\n（系统音色也在那格里，和自定义的一起列。）`
                      : "没拉到自定义音色：系统音色照样能用，想捏一个就点下面的「捏一个嗓子」。",
                  );
                  return;
                }
                if (voiceProvider === "elevenlabs") {
                  setVoiceMsg(
                    r.voices.length > 0
                      ? `拉到 ${r.voices.length} 个音色：点上面「音色」那一格挑一个。`
                      : "一家音色都没拉到：这个 key 可能还没建过声音。",
                  );
                  return;
                }
                const pick = (re: RegExp) => r.models.find((m) => re.test(m)) ?? "";
                const asr = pick(/sensevoice|whisper|asr|transcri/i);
                const tts = pick(/cosyvoice|tts|vits|speech/i);
                patch({
                  ...(asr ? { voiceAsrModel: asr } : {}),
                  ...(tts ? { voiceTtsModel: tts } : {}),
                } as Partial<typeof settings>);
                setVoiceMsg(
                  `拉到 ${r.models.length} 个语音相关的模型（聊天、画图的已滤掉）：\n` +
                    [asr && `· 转文字 → ${asr}`, tts && `· 合成 → ${tts}`]
                      .filter(Boolean)
                      .join("\n") +
                    "\n\n点上面那几格可以换；长名字不用手打。",
                );
              }}
            >
              {voiceProvider === "openai" ? "拉取可用模型" : "拉取音色"}
            </button>

            {voiceMsg && (
              <p
                className="mt-2 whitespace-pre-wrap break-all py-1 text-[11.5px] leading-5 text-muted"
                onClick={() => setVoiceMsg("")}
              >
                {voiceMsg}
              </p>
            )}

            {voiceProvider === "dashscope" && (
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setAsrOpen((v) => !v)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="flex-1 text-[12px] font-medium text-fg">
                    转文字（听）· 借别家
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[10.5px]",
                      asrKey ? "text-emerald-600" : "text-subtle",
                    )}
                  >
                    {asrKey ? "已接上" : "未配置"}
                  </span>
                  <ChevronRight
                    className={cn(
                      "size-3.5 shrink-0 text-subtle transition-transform",
                      asrOpen && "rotate-90",
                    )}
                  />
                </button>
                {asrOpen && (
                  <>
                    <div className="mt-2 space-y-2">
                      <input
                        value={settings.voiceAsrBaseUrl ?? ""}
                        onChange={(e) => patch({ voiceAsrBaseUrl: e.target.value })}
                        placeholder="地址，如 https://api.siliconflow.cn/v1"
                        className="h-9 w-full rounded-[var(--k-card-radius)] bg-surface px-3 text-[12px] outline-none"
                      />
                      <input
                        type="password"
                        value={settings.voiceAsrApiKey ?? ""}
                        onChange={(e) => patch({ voiceAsrApiKey: e.target.value })}
                        placeholder="这家的密钥（和上面那个可以不一样）"
                        className="h-9 w-full rounded-[var(--k-card-radius)] bg-surface px-3 text-[12px] outline-none"
                      />
                      <input
                        value={settings.voiceAsrModel ?? ""}
                        onChange={(e) => patch({ voiceAsrModel: e.target.value })}
                        placeholder="模型，如 FunAudioLLM/SenseVoiceSmall"
                        className="h-9 w-full rounded-[var(--k-card-radius)] bg-surface px-3 text-[12px] outline-none"
                      />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          patch({
                            voiceAsrBaseUrl: "https://api.siliconflow.cn/v1",
                            voiceAsrModel: "FunAudioLLM/SenseVoiceSmall",
                          })
                        }
                        data-opt=""
                        className="h-8 flex-1 rounded-xl border border-line text-[11.5px]"
                      >
                        填硅基流动的推荐值
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patch({ voiceAsrApiKey: "", voiceAsrBaseUrl: "", voiceAsrModel: "" })
                        }
                        data-opt=""
                        className="h-8 w-16 rounded-xl border border-line text-[11.5px]"
                      >
                        清空
                      </button>
                    </div>
                    {asrKey && (
                      <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-emerald-600">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        正在用 {(settings.voiceAsrModel ?? "").split("/").pop() || "默认模型"} 听
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {voiceProvider === "dashscope" && (
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setDesignOpen((v) => !v)}
                  className="flex w-full items-center gap-2 text-left text-[12px] font-medium text-fg"
                >
                  <span className="flex-1">捏一个嗓子</span>
                  <ChevronRight
                    className={cn(
                      "size-3.5 text-subtle transition-transform",
                      designOpen && "rotate-90",
                    )}
                  />
                </button>
                {designOpen && (
                  <>
                    <textarea
                      value={designDesc}
                      onChange={(e) => setDesignDesc(e.target.value)}
                      rows={3}
                      placeholder="比如：二十五六岁的女生，声音偏轻，说话不快，尾音带一点笑意，像在耳边说话。"
                      className="mt-2 w-full resize-none rounded-[var(--k-card-radius)] bg-surface px-3 py-2 text-[12px] outline-none"
                    />
                    <input
                      value={designPreview}
                      onChange={(e) => setDesignPreview(e.target.value)}
                      placeholder="试听用哪句话（留空用默认的一句）"
                      className="mt-2 h-9 w-full rounded-[var(--k-card-radius)] bg-surface px-3 text-[12px] outline-none"
                    />
                    <button
                      type="button"
                      disabled={designBusy}
                      onClick={async () => {
                        const cfg = voiceConfig();
                        if (!cfg) {
                          setDesignMsg("先在上面把密钥填上。");
                          return;
                        }
                        setDesignBusy(true);
                        setDesignMsg("正在造，十几秒；造好会自动换成它。");
                        const r = await designVoice(
                          {
                            baseUrl: cfg.baseUrl,
                            apiKey: cfg.apiKey,
                            model: cfg.ttsModel,
                            voice: cfg.voice,
                          },
                          {
                            description: designDesc,
                            previewText: designPreview || undefined,
                          },
                        );
                        setDesignBusy(false);
                        if (!r.ok) {
                          setDesignMsg(r.reason);
                          return;
                        }
                        setDesignUrl(r.previewUrl ?? "");
                        patch({ voiceTtsVoice: r.voiceId });
                        setDesignMsg(
                          `造好了：${r.voiceId}${r.status === "OK" ? "" : "（还在审核，可能要等一会儿才能用）"}\n已经切成它，先听一下；不满意就改描述再造一个。`,
                        );
                      }}
                      className="mt-2 h-9 w-full rounded-[var(--k-card-radius)] bg-fg text-[12px] font-medium text-bg disabled:opacity-50"
                    >
                      {designBusy ? "正在造…" : "造一个，先听听"}
                    </button>
                    {designMsg && (
                      <p
                        onClick={() => setDesignMsg("")}
                        className="mt-2 whitespace-pre-wrap break-all py-1 text-[11.5px] leading-5 text-muted"
                      >
                        {designMsg}
                      </p>
                    )}
                    {designUrl && (
                      <button
                        type="button"
                        onClick={() => void new Audio(designUrl).play()}
                        data-opt=""
                        className="k-input mt-2"
                      >
                        ▶ 再听一遍刚造的那个
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {voiceProvider === "dashscope" && (
              <Row
                label="按情绪念"
                checked={settings.voiceEmotionTags !== false}
                onChange={(v) => patch({ voiceEmotionTags: v })}
              />
            )}
          </Sub>

          <Sub title="语速与音调">
            <KSlider
              label="语速"
              value={settings.voiceRate}
              min={0.5}
              max={2}
              step={0.05}
              unit="×"
              onChange={(v) => patch({ voiceRate: v })}
            />
            <KSlider
              label="音调"
              value={settings.voicePitch}
              min={0.5}
              max={1.8}
              step={0.05}
              unit=""
              onChange={(v) => patch({ voicePitch: v })}
            />
            <div className="mt-3">
              <KButton
                variant="dashed"
                onClick={async () => {
                  setVoiceMsg("正在合成…");
                  const r = await speakTextAsync(
                    "你好，我是" + resolveAiName(settings.aiName) + "。",
                    {},
                  );
                  setVoiceMsg(r.ok ? "" : `没读出来：${r.reason}`);
                }}
              >
                试听一句
              </KButton>
            </div>
          </Sub>

          {/*
          **弹层选择器**（用户 m10646："改成弹层选择，就跟之前做的聊天页面的模型选择那种"）。
          一次只列一类（转文字 / 合成 / 音色），带搜索框；点一下就是换掉。
        */}
          {voicePick &&
            (() => {
              const isEL = voiceProvider === "elevenlabs";
              const isDS = voiceProvider === "dashscope";
              const asrList = isEL
                ? ["scribe_v1"]
                : voiceModels.filter((m) => /asr|whisper|sensevoice|transcri|paraformer/i.test(m));
              /**
               * 百炼的合成模型是**固定的几个**（不靠 /models 接口发现）；
               * 音色 = 系统音色 + 你在它那儿建的（复刻/设计）。
               */
              const ttsList = isDS
                ? [...DS_TTS_MODELS]
                : isEL
                  ? ["eleven_multilingual_v2", "eleven_turbo_v2_5"]
                  : voiceModels.filter((m) => /tts|cosyvoice|voice|speech|moss/i.test(m));
              const voiceList = isDS
                ? [...DS_SYSTEM_VOICES.map((v) => v.id), ...dsVoices]
                : isEL
                  ? elevenVoices
                  : ["alex", "anna", "bella", "benjamin", "charles", "claire", "david", "diana"];
              const list =
                voicePick === "asr" ? asrList : voicePick === "tts" ? ttsList : voiceList;
              const field =
                voicePick === "asr"
                  ? "voiceAsrModel"
                  : voicePick === "tts"
                    ? "voiceTtsModel"
                    : "voiceTtsVoice";
              const cur = ((settings[field] as string | undefined) ?? "").trim();
              const title =
                voicePick === "asr"
                  ? "选转文字模型"
                  : voicePick === "tts"
                    ? "选合成模型"
                    : "选音色";
              const q = voicePickQuery.trim().toLowerCase();
              const shown = list.filter((m) => !q || m.toLowerCase().includes(q));
              /**
               * ⚠️ 必须 portal 到 body：这一页的卡片带 backdrop-filter，
               * 祖先一旦有 filter/transform，position: fixed 就退化成"相对祖先"，
               * 弹层会被裁在卡片里看不见。
               */
              return createPortal(
                <div
                  className="fixed inset-0 z-[120] flex items-center justify-center px-4"
                  onClick={() => setVoicePick(null)}
                >
                  <div className="absolute inset-0 bg-black/45" />
                  <div
                    data-contrast=""
                    className={cn(
                      "aster-pop relative flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-[var(--k-card-radius)] border border-line px-4 pb-4 pt-3 shadow-[0_20px_60px_rgba(30,20,12,.35)] backdrop-blur-2xl",
                      solidPaper && "paper-card",
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[14px] font-semibold text-fg">{title}</p>
                      <button
                        type="button"
                        aria-label="关闭"
                        onClick={() => setVoicePick(null)}
                        data-opt=""
                        className="flex size-7 shrink-0 items-center justify-center rounded-full"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                    <p className="mt-0.5 text-[10.5px] leading-4 text-muted">
                      {voicePick === "voice" && isEL
                        ? "这些是这家 key 底下建过的音色（voice_id）"
                        : list.length === 0
                          ? "还没拉到清单，先点上面那个按钮"
                          : isEL
                            ? "这家这两个都是能用的"
                            : "只列语音相关的，聊天和画图那些已经滤掉"}
                    </p>
                    <input
                      value={voicePickQuery}
                      onChange={(e) => setVoicePickQuery(e.target.value)}
                      placeholder="搜索…"
                      data-opt=""
                      className="k-input mt-2"
                    />
                    <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto">
                      {shown.length === 0 && (
                        <p className="py-4 text-center text-[11.5px] text-subtle">
                          {list.length === 0 ? "清单是空的" : "没有匹配的"}
                        </p>
                      )}
                      {shown.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            patch({ [field]: m } as Partial<typeof settings>);
                            setVoicePick(null);
                          }}
                          className="flex w-full items-center gap-2 border-b border-line/60 py-2.5 text-left last:border-b-0"
                        >
                          <span className="flex-1 truncate font-mono text-[11.5px] text-fg">
                            {m}
                          </span>
                          {(() => {
                            if (!isDS || voicePick !== "voice") return null;
                            const hint = dsVoiceStatusHint(dsVoiceStatus[m]);
                            return hint ? (
                              <span className="shrink-0 text-[10px] text-accent">{hint}</span>
                            ) : null;
                          })()}
                          {cur === m && (
                            <span className="text-[13px] font-bold text-accent">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>,
                document.body,
              );
            })()}
        </>
      ),
    },
    dev: {
      title: "开发与纠错",
      value: "环境自检",
      order: 5,
      body: (
        <>
          <Sub title="开发与纠错">
            {/* Section 里的子元素是直接堆叠的，多张卡片必须自己包一层间距，
            否则半透明圆角卡片贴在一起会看起来像「重合」。 */}
            <div className="space-y-2">
              {/* 入口卡 = 玻璃，不是选项胶囊：2026-11-01 用户 "环境自建改回白色" */}
              <Link
                to="/env"
                className="flex items-center justify-between gap-3 rounded-[var(--k-card-radius)] px-3.5 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">环境自检</span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    麦克风 / 通知 / 摄像头 这台设备能不能用
                  </span>
                  <span className="mt-0.5 block text-[11px] text-subtle">
                    换地址、封装成 APP 之后再来看一次
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </Link>
            </div>
          </Sub>
        </>
      ),
    },
  };

  /** 旧的 /system 页按原来的顺序把五块套回可折叠壳 */
  const SYS_ORDER = ["chat", "notify", "weather", "voice", "dev"] as const;

  const systemSections = (
    <div className="sys-list">
      {SYS_ORDER.map((k) => {
        const g = sysGroups[k];
        return (
          <Group key={k} title={g.title} value={g.value} order={g.order}>
            {g.body}
          </Group>
        );
      })}
    </div>
  );

  if (tab === "space") return <>{spaceSections}</>;

  /*
   * 新五个二级页：用户 m03042 说「对话 / 主动与通知 / 语音 点进去只有一条大类，
   * 直接把里面的东西铺开，分类铺开」—— 所以这里不再套那层要点的 `Group`：
   * 对话页是三个分类各一张卡（`Sub` 自己就是一张卡）；
   * 其余页把正文直接摆进一张卡，进页面就能看到，不用先点开。
   */
  if (tab === "chat") return <div className="k-list">{sysGroups.chat.body}</div>;
  if (tab === "active") return <div className="k-list">{sysGroups.notify.body}</div>;
  if (tab === "voice") return <div className="k-list">{sysGroups.voice.body}</div>;
  if (tab === "privacy") {
    return (
      <div className="k-list">
        {sysGroups.weather.body}
        {dataSections}
      </div>
    );
  }
  if (tab === "about") {
    return (
      <div className="k-list">
        {usageSections}
        {sysGroups.dev.body}
      </div>
    );
  }
  /* 下面三行是旧分派：新页面接上之后整块删掉 */
  if (tab === "usage") return <>{usageSections}</>;
  if (tab === "data") return <>{dataSections}</>;
  return <>{systemSections}</>;
}
