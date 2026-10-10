import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ChevronRight,
  Database,
  ImagePlus,
  Lock,
  Palette,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BackupSection } from "@/components/backup-section";
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
import { isOwnApi, QUOTA_LIMIT } from "@/lib/models";
import { refreshPlaceAndWeather } from "@/lib/where-am-i";
import { IS_APP, probeUpstreamModels } from "@/lib/platform";
import { failedProbeResult, probeToolCalling, type ToolProbeResult } from "@/lib/tool-probe";
import { toolProtocolLabel } from "@/lib/tool-protocol";
import { wakeSupported } from "@/lib/background-wake";
import { pingWake, readWakeLog, resetWake, wakeUrlSource } from "@/lib/wake-sync";
import { speakTextAsync } from "@/lib/tts";
import { resetLabel } from "@/lib/greeting";
import { useApp } from "@/lib/store";
import type { FontId, PlanetTone, ReplyStyle, TextTone, ThemeId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Avatar } from "@/components/avatar";
import { FileButton } from "@/components/file-button";
import { DEFAULT_AI_NAME, BUILD_TAG, resolveAiName } from "@/lib/branding";
import { permissionSummary } from "@/lib/permissions";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory, CHAT_FONT_SIZES } from "@/lib/ux";

/**
 * 「我的」的四组内容 —— 首页只放入口卡，细节在第二层。
 *
 * 为什么抽出来：以前全部平铺在 `me-view.tsx` 一个文件里（1300 行），
 * 现在按文档的 4 大类拆成 4 个二级页，但**区块 JSX 只写一份**：
 *   · `MeHub`   → 首页（头像 + 5 张入口卡）
 *   · `space`   → 我的空间：形象 · 背景空间 · 个性化
 *   · `usage`   → 模型与用量：用量 · 上下文与内存 · 自定义上游
 *   · `data`    → 数据与记忆：记忆库 · 世界书 / 思考引导 · 备份恢复
 *   · `system`  → 系统：思考链 · 通知 · 定位 · 语音 · 定时任务 · 开发与纠错
 *
 * 纯搬位置，**一个功能都没动** ✅（开关、输入框、逻辑全是原来那套）
 */

export type MeTab = "space" | "usage" | "data" | "system";

const THEMES: { id: ThemeId; label: string; hint: string }[] = [
  { id: "dawn", label: "黎明", hint: "奶油纸页" },
  { id: "dusk", label: "黄昏", hint: "暖夜" },
  { id: "ink", label: "墨色", hint: "冷黑" },
];

const STYLES: { id: ReplyStyle; label: string }[] = [
  { id: "default", label: "默认" },
  { id: "concise", label: "简洁" },
  { id: "explanatory", label: "详尽" },
];

/** 「此刻的情况」那几行小字要用到的相对时间。 */
function relShort(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const FONTS: { id: FontId; label: string; hint: string; stack: string }[] = [
  { id: "system", label: "默认", hint: "无衬线", stack: '"DM Sans", system-ui, sans-serif' },
  {
    id: "serif",
    label: "衬线",
    hint: "宋体 · 优雅",
    stack: '"Source Serif 4", "Songti SC", "SimSun", serif',
  },
  { id: "kai", label: "楷体", hint: "手写 · 文艺", stack: '"Kaiti SC", "KaiTi", "楷体", "STKaiti", serif' },
  {
    id: "mono",
    label: "等宽",
    hint: "代码感",
    stack: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
  },
];

const TONES: { id: TextTone; label: string }[] = [
  { id: "auto", label: "跟随主题" },
  { id: "dark", label: "深色字" },
  { id: "light", label: "浅色字" },
  { id: "custom", label: "自定义" },
];

/**
 * 小宇宙里行星/星环的预设色。
 *
 * 跟「文字颜色」是**两个独立的开关**（用户："球体颜色和字体颜色做个切割吧，
 * 她两分开，不放一起，不然不好同时兼顾"）。
 * 三个色取自视觉 Skill 的配色原则：冷薄荷青为主 + 雾紫为辅 + 暖金点缀。
 * swatch 只用来画那个小圆点，真实取值在 store.ts 的 PLANET_COLORS。
 */
const PLANET_TONES: { id: PlanetTone; label: string; swatch?: string }[] = [
  { id: "auto", label: "跟随文字" },
  { id: "mist", label: "冷薄荷青", swatch: "#7fa8b8" },
  { id: "violet", label: "雾紫", swatch: "#9a8cba" },
  { id: "gold", label: "暖金", swatch: "#c9a227" },
  { id: "custom", label: "自定义" },
];

/* ───────────────────────────── 首页：只留入口卡 ───────────────────────────── */

/**
 * 首页那 5 张入口卡 —— 图里的构成是「图标 + 标题 + 一行短小字 + 箭头」。
 *
 * 图标统一放一个 `size-10` 的圆角方玻璃底、`strokeWidth 1.7` 的线性图标，
 * **不按卡片给不同颜色** —— 文档第 7 节说要收敛"卡片之间颜色竞争"，
 * 靠背景图那个天然渐变的圆底取色，比硬编码五个颜色自然（也不挑主题）。
 */
const ME_CARDS: { to: string; label: string; hint: string; icon: LucideIcon }[] = [
  {
    to: "/core",
    label: "AI 概览",
    hint: "他是谁 · 能知道什么 · 怎么和你相处 · 什么状态 · 记得你什么",
    icon: Sparkles,
  },
  {
    to: "/space",
    label: "我的空间",
    hint: "形象 · 背景空间 · 时感地址 · 个性化",
    icon: Palette,
  },
  {
    to: "/usage",
    label: "模型与用量",
    hint: "用量 · 上下文与内存 · 自定义上游",
    icon: Activity,
  },
  { to: "/data", label: "数据", hint: "备份与恢复（记忆库、世界书在「AI 概览」里）", icon: Database },
  {
    to: "/system",
    /*
      ⚠️ 这行 hint 是**用户能看到的**，必须跟二级页里真实有的东西一致，
      否则就是误导（用户实测指出过："闹钟和定时任务已经挪走了，
      但是系统那行提示还是显示有"）。

      所以：闹钟、定时任务**已经从小日子那边挪过去了**，这里不能再写。
      改 hint 的时候记得回头对一遍下面 systemSections 里的 Section 标题。
    */
    label: "系统",
    hint: "思考链 · 通知 · 天气与定位 · 语音 · 开发与纠错",
    icon: Settings2,
  },
];

/**
 * 「我的」首页。
 *
 * 用户的原话："我的主页那里直接把下面的功能页塞到第二层展示就好了，更短。"
 * 所以这里**只有**：头像/名字那张卡 + 5 个入口 + 版本号。
 */
export function MeHub() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const scrollRef = useScrollMemory("me");

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4">
        <p className="text-xs tracking-wide text-muted">账号与系统</p>
        <h1 className="mt-1 font-serif text-2xl font-medium">我的</h1>
      </header>

      {/* 资料区：头像在上、名字在下；点头像就能换 */}
      <section className="mx-4 flex flex-col items-center rounded-3xl border border-line bg-surface px-4 py-6">
        <FileButton
          ariaLabel="更换我的头像"
          accept="image/*"
          className="flex size-20 items-center justify-center rounded-full"
          onPick={(files) => {
            const file = files[0];
            if (file) readBackground(file, (url) => patch({ userAvatar: url }));
          }}
        >
          <Avatar role="user" size={80} />
        </FileButton>
        <p className="mt-2.5 text-[11px] text-subtle">
          {settings.userAvatar ? "点头像可以换一张" : "点头像上传一张"}
        </p>
        <input
          value={settings.displayName}
          onChange={(e) => patch({ displayName: e.target.value.slice(0, 24) })}
          placeholder="你的名字"
          aria-label="显示名"
          maxLength={24}
          className="mt-3 w-full bg-transparent text-center font-serif text-2xl outline-none placeholder:text-subtle"
        />
        <p className="mt-1 text-[11px] text-subtle">
          他会用这个名字称呼你 · AI 头像与名字在「我的空间」里
        </p>
      </section>

      {/*
        5 个入口 —— 点进去才是细节，首页不再平铺一长串
        （文档：「我的」= AI 控制中枢，先分类再进二级 ✅ 纯入口整理）
      */}
      <nav className="mt-6 space-y-2 px-4">
        {ME_CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.to}
              to={c.to}
              className="flex items-center gap-3 rounded-3xl border border-line bg-elevated px-4 py-3.5"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-chip">
                <Icon className="size-[1.15rem] text-accent" strokeWidth={1.7} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-serif text-[15px]">{c.label}</span>
                <span className="mt-1 block text-[11px] leading-4 text-subtle">{c.hint}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted" />
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-8 text-center text-[12px] text-subtle">
        栖岛 · 思考链保存在这台设备 · {BUILD_TAG}
      </div>
    </div>
  );
}

/* ───────────────────────── 第二层：四组区块 ───────────────────────── */

/** 第二层页面共用外壳：左上角返回 + 标题 + 可滚动内容区。 */
export function MePage({
  tab,
  title,
  subtitle,
}: {
  tab: MeTab;
  title: string;
  subtitle: string;
}) {
  // 报给 AI「我在看什么」（跟其它二级页一样），纯 UI 迁移顺手补上
  useActivity(`在看${title}`);
  const scrollRef = useScrollMemory(`me-${tab}`);

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader title={title} description={subtitle} />

      <MeSections tab={tab} />

      <div className="px-5 py-8 text-center text-[12px] text-subtle">
        栖岛 · 思考链保存在这台设备 · {BUILD_TAG}
      </div>
    </div>
  );
}

function MeSections({ tab }: { tab: MeTab }) {
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoMsg, setGeoMsg] = useState("");
  /** 浏览器里能选的音色（App 里由系统引擎决定，所以是空数组） */
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const settings = useApp((s) => s.settings);
  // 记忆库 / 世界书的条数统计在「AI 概览」和它自己的页面里，这里不再订阅
  // （定时任务/闹钟的列表入口已经挪到「玩乐 → 小日子」，这一页不再订阅 tasks）
  /** 今天的真实用量（来自每条请求记录的 token），替代原来那个假的额度百分比 */
  const requestLog = useApp((s) => s.requestLog);
  const usageToday = (() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = requestLog.filter((r) => r.at >= start.getTime());
    if (today.length === 0) return null;
    const sum = (k: "prompt" | "completion" | "cached") => today.reduce((n, r) => n + (r[k] ?? 0), 0);
    return { calls: today.length, prompt: sum("prompt"), completion: sum("completion"), cached: sum("cached") };
  })();
  const quota = useApp((s) => s.quota);
  /** 自己带 key → 只统计真实 token；走服务端 → 才显示窗口额度 */
  const ownApi = isOwnApi(settings);
  const hydrationDone = useApp((s) => s.hydrated);
  // 配额重置时间是按「现在」算的 —— 服务端和客户端算出来必然不同，
  // 所以等服务端渲染过去之后再显示，避免水合失败。
  const resetAt = useApp((s) => s.quotaResetAt());
  const hydrated = hydrationDone;
  const usedPct = Math.min(100, Math.round((quota.used / QUOTA_LIMIT) * 100));
  const patch = useApp((s) => s.patchSettings);
  const background = settings.background;
  const sum = permissionSummary(settings.permissions);
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
  const [bgUnlocked, setBgUnlocked] = useState(false);
  // 拉取上游模型名：省得用户猜（猜错只会得到一句看不懂的英文报错）
  const [models, setModels] = useState<string[]>([]);
  const [modelMsg, setModelMsg] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  // 「这把上游认不认原生 tools」—— 用户点一下，用他自己的地址 + key 直接问
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState<ToolProbeResult | null>(null);
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
    Boolean((settings.customBaseUrl ?? "").trim() && (settings.customApiKey ?? "").trim() && (settings.upstreamModel ?? "").trim());
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
      setModelMsg(`上游列了 ${json.models.length} 个模型 —— 点一个就用它`);
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
      setWakeResetMsg("再点一下确认：会清掉醒来次数、后台日志、上次说话时间、静音标记，还有交给后台的那份配置。");
      return;
    }
    setWakeResetArmed(false);
    setWakeResetBusy(true);
    setWakeResetMsg("");
    try {
      const r = await resetWake();
      setWakeResetMsg(`${r.ok ? "🟢" : "🔴"} ${r.message}`);
      // 清完记录就没了 —— 正打开着的话跟着刷新一下，别显示上一轮的旧日志
      if (wakeLogOpen) setWakeLogLines(await readWakeLog(6));
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
    void permissionStateAsync().then(setPerm);    setSecure(secureContextOk());
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

  const spaceSections = (
    <>
      <Section title="形象">
        <div className="flex gap-3">
          <AvatarSlot
            label="AI 头像"
            hint={resolveAiName(settings.aiName)}
            value={settings.aiAvatar}
            preview={<Avatar role="ai" size={44} />}
            onChange={(v) => patch({ aiAvatar: v })}
          />
          <AvatarSlot
            label="我的头像"
            hint={settings.displayName}
            value={settings.userAvatar}
            preview={<Avatar role="user" size={44} />}
            onChange={(v) => patch({ userAvatar: v })}
          />
        </div>

        <label className="mt-3 block px-1">
          <span className="block text-[12px] text-muted">AI 名字</span>
          <input
            value={settings.aiName}
            onChange={(e) => patch({ aiName: e.target.value.slice(0, 12) })}
            placeholder={DEFAULT_AI_NAME}
            maxLength={12}
            aria-label="AI 名字"
            className="mt-1 w-full rounded-full border border-line bg-chip px-4 py-2.5 text-[15px] outline-none placeholder:text-subtle"
          />
        </label>
        <p className="mt-2 text-[12px] leading-5 text-muted">
          名字会用在对话、游戏和系统提示里。留空就用默认的「{DEFAULT_AI_NAME}」。
        </p>
        <p className="mt-2 text-[12px] leading-5 text-muted">
          头像只存在这台设备。换一次，对话里所有头像（AI 的、我的）都会跟着变。
        </p>
      </Section>

      <Section title="背景空间">
        {/* 三张图各管一处：主页是全局的底，另外两张只在自己那页出现 */}
        <div className="space-y-2">
          <ImageRow
            label="主页背景"
            hint="整个 App 的底"
            value={background.image}
            onPick={(url) => patch({ background: { ...background, image: url } })}
            onClear={() => patch({ background: { ...background, image: "" } })}
          />
          <ImageRow
            label="音乐播放页"
            hint="只在这一页出现"
            value={settings.musicImage}
            onPick={(url) => patch({ musicImage: url })}
            onClear={() => patch({ musicImage: "" })}
          />
          <ImageRow
            label="日记动态页"
            hint="只在这一页出现"
            value={settings.diaryImage}
            onPick={(url) => patch({ diaryImage: url })}
            onClear={() => patch({ diaryImage: "" })}
          />
        </div>
        <p className="mt-2 text-[12px] leading-5 text-muted">
          图片只存在这台设备；玻璃会随背景自动调整明暗，保证文字可读。
          另外两张不设的话，那两页就用「主页背景」。
        </p>

        {/* 动画 */}
        <div className="mt-3 rounded-2xl bg-chip px-3.5 py-3">
          <p className="text-[13px] font-medium">动画</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted">
            手机开着「减弱动态效果」时，系统会把所有动画压成 0.01 毫秒 ——
            那就是黑胶不转、心跳不动的原因。
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {(
              [
                ["auto", "跟随系统"],
                ["on", "始终开启"],
                ["off", "关闭"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => patch({ motion: id })}
                className={cn(
                  "rounded-full py-1.5 text-[11px]",
                  settings.motion === id ? "bg-fg/10 font-medium text-fg" : "text-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-2xl bg-chip px-3.5 py-2.5">
          <span className="min-w-0 text-[11px] leading-4 text-muted">
            {bgUnlocked ? "正在调整 —— 调完记得锁上" : "已锁定，滑动页面不会误改"}
          </span>
          <button
            type="button"
            aria-label={bgUnlocked ? "锁定背景调整" : "解锁背景调整"}
            onClick={() => setBgUnlocked((v) => !v)}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-medium",
              bgUnlocked ? "bg-warn/20 text-warn" : "bg-surface text-muted",
            )}
          >
            {bgUnlocked ? <Lock className="size-3.5" /> : <SlidersHorizontal className="size-3.5" />}
            {bgUnlocked ? "锁定" : "调整"}
          </button>
        </div>

        <SliderRow
          label="模糊"
          value={background.blur}
          min={0}
          max={60}
          step={1}
          unit="px"
          disabled={!bgUnlocked}
          onChange={(v) => patch({ background: { ...background, blur: v } })}
        />
        <SliderRow
          label="暗化"
          value={background.dim}
          min={0}
          max={0.8}
          step={0.05}
          unit=""
          disabled={!bgUnlocked}
          onChange={(v) => patch({ background: { ...background, dim: v } })}
        />
        <SliderRow
          label="透明度"
          value={background.opacity}
          min={0.2}
          max={1}
          step={0.05}
          unit=""
          disabled={!bgUnlocked}
          onChange={(v) => patch({ background: { ...background, opacity: v } })}
        />
      </Section>

      {/*
        时感地址 —— **2026-10 挪到「玩乐 → 插件 → 时感」里去了**。
        用户把时感收进了"插件"这个类别，那"插件的事在插件里管"：
        插件编辑器里改地址，设置页不再留重复的一份
        （同一件事两处能改 = 迟早走散，这是这份文档反复在治的毛病）。
        老存档里的 `shiganUrl` 不变，插件那边读的就是同一个字段。
      */}

      <Section title="个性化">
        <p className="mb-2 text-[12px] text-muted">主题</p>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => useApp.getState().setTheme(t.id)}
              className={cn(
                "rounded-2xl border px-3 py-3 text-left",
                settings.theme === t.id ? "border-fg" : "border-line",
              )}
            >
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="text-[11px] text-muted">{t.hint}</span>
            </button>
          ))}
        </div>

        <p className="mt-4 mb-2 text-[12px] text-muted">正文字体</p>
        <div className="grid grid-cols-2 gap-2">
          {FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => patch({ font: f.id })}
              style={{ fontFamily: f.stack }}
              className={cn(
                "rounded-2xl border px-3 py-2.5 text-left",
                settings.font === f.id ? "border-fg" : "border-line",
              )}
            >
              <span className="block text-[13px] font-medium">{f.label}</span>
              <span className="text-[11px] text-muted">{f.hint}</span>
            </button>
          ))}
        </div>

        {/* 「最大输出长度」+「回复风格」已经挪到「系统 → 思考链」（用户要求）。
            这里不能再留一份 —— 同一个开关出现两次，改哪边都容易漏。 */}

        <p className="mt-4 mb-2 text-[12px] text-muted">正文字号</p>
        <div className="flex gap-2">
          {CHAT_FONT_SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => patch({ chatFontSize: s.id })}
              className={cn(
                "flex-1 rounded-2xl border px-2 py-2.5 text-center",
                settings.chatFontSize === s.id ? "border-fg" : "border-line",
              )}
            >
              <span className="block text-[13px] font-medium">{s.label}</span>
              <span className="block text-[10px] text-subtle">{s.px}px</span>
            </button>
          ))}
        </div>

        <p className="mt-4 mb-2 text-[12px] text-muted">文字颜色</p>
        <div className="flex flex-wrap gap-2">
          {TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => patch({ textTone: t.id })}
              className={cn(
                "rounded-full px-3 py-1.5 text-[13px]",
                settings.textTone === t.id ? "bg-ink text-ink-fg" : "bg-chip",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {settings.textTone === "custom" && (
          <div className="mt-3 flex items-center gap-3 px-1">
            <input
              type="color"
              value={settings.textColor}
              onChange={(e) => patch({ textColor: e.target.value })}
              className="size-9 rounded-full border border-line bg-transparent"
              aria-label="自定义文字颜色"
            />
            <span className="text-[12px] text-muted">自定义颜色 {settings.textColor}</span>
          </div>
        )}

        {/*
          星球颜色 —— 跟「文字颜色」**分开**的一个开关。
          用户："球体颜色和字体颜色做个切割吧，她两分开，不放一起，
          不然不好同时兼顾。"
          所以这里单独给一组：跟随文字 / 冷薄荷青 / 雾紫 / 暖金 / 自定义。
        */}
        <p className="mt-4 mb-2 text-[12px] text-muted">小宇宙的星球颜色</p>
        <div className="flex flex-wrap gap-2">
          {PLANET_TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => patch({ planetTone: t.id })}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px]",
                settings.planetTone === t.id ? "bg-ink text-ink-fg" : "bg-chip",
              )}
            >
              {t.swatch && (
                <span
                  className="size-3 rounded-full border border-line/60"
                  style={{ background: t.swatch }}
                  aria-hidden="true"
                />
              )}
              {t.label}
            </button>
          ))}
        </div>
        {settings.planetTone === "custom" && (
          <div className="mt-3 flex items-center gap-3 px-1">
            <input
              type="color"
              value={settings.planetColor}
              onChange={(e) => patch({ planetColor: e.target.value })}
              className="size-9 rounded-full border border-line bg-transparent"
              aria-label="自定义星球颜色"
            />
            <span className="text-[12px] text-muted">自定义星球色 {settings.planetColor}</span>
          </div>
        )}
        <p className="mt-2 text-[12px] leading-5 text-muted">
          只影响对话抽屉下面那个小宇宙里的行星和星环，<span className="text-fg">不影响文字</span>。
          选「跟随文字」时会随你换背景、改文字色一起变，不会出现背景暗了、星球还亮的问题。
        </p>

        {/*
          认识的日子 —— 玩乐区首页那个「NNN DAYS TOGETHER」用它算天数。
          用户："可以来个组件，上面是两个的名字或头像，写着认识多久了"、
          "用户自己填日子"。填了才显示，没填就提示来这儿填，不编数字。
        */}
        <p className="mt-4 mb-2 text-[12px] text-muted">认识的日子</p>
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-chip px-3.5 py-3">
          <span className="min-w-0 text-[12px] leading-4 text-muted">
            玩乐区首页会显示
            <br />
            「一起多少天」
          </span>
          <input
            type="date"
            value={settings.togetherSince}
            onChange={(e) => patch({ togetherSince: e.target.value })}
            aria-label="认识的日子"
            className="shrink-0 bg-transparent font-mono text-[13px] outline-none"
          />
        </label>
        <p className="mt-1.5 text-[11px] leading-4 text-subtle">
          {settings.togetherSince
            ? "留空就不显示那个数字。"
            : "还没填 —— 填上之后，玩乐区首页就会替你数着。"}
        </p>
        <p className="mt-2 text-[12px] leading-5 text-muted">
          深色背景图下小字看不清时，把它换成浅色字就行。
        </p>
      </Section>
    </>
  );

  /* ── 模型与用量 ── */

  const usageSections = (
    <>
      <Section title={ownApi ? "用量（真实统计）" : "额度（服务端）"}>
        <div className="rounded-2xl bg-chip px-4 py-3">
          {ownApi ? (
            <>
              {usageToday ? (
                <>
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium">今天 {usageToday.calls} 次请求</p>
                    <p className="text-[12px] text-muted">
                      输入 {usageToday.prompt.toLocaleString()} · 输出 {usageToday.completion.toLocaleString()}
                    </p>
                  </div>
                  <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-elevated">
                    <div
                      className="h-full bg-accent"
                      style={{
                        width: `${Math.round((usageToday.prompt / Math.max(1, usageToday.prompt + usageToday.completion)) * 100)}%`,
                      }}
                    />
                    <div className="h-full flex-1 bg-accent/40" />
                  </div>
                  <p className="mt-2 text-[12px] text-muted">
                    缓存命中 {usageToday.cached.toLocaleString()} tokens
                    {usageToday.cached > 0 && " —— 这部分上游按更低价算，省的就是它"}
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-muted">今天还没发过消息。</p>
              )}
              <p className="mt-2 text-[12px] leading-5 text-muted">
                你填了自己的 API key（花的是你的钱），所以本机<span className="text-fg">不做任何限制</span>，只如实显示上游返回的用量。
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{usedPct}% 已使用</p>
                <p className="text-[12px] text-muted">
                  {quota.used}/{QUOTA_LIMIT}
                </p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full bg-accent" style={{ width: `${usedPct}%` }} />
              </div>
              <p className="mt-2 text-[12px] text-muted" suppressHydrationWarning>
                {hydrated
                  ? `${resetAt <= Date.now() ? "窗口已过，下次发送重新计数" : resetLabel(resetAt)} · `
                  : ""}
                每窗口 {QUOTA_LIMIT} 条
              </p>
              <p className="mt-2 text-[12px] leading-5 text-muted">
                你在走内置服务端（花的是服务端那把 key），所以才有这个窗口额度。
                想不受限，去下面「自定义上游」填自己的地址和密钥即可。
              </p>
            </>
          )}
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
          className="flex items-center justify-between gap-3 rounded-2xl bg-chip px-3.5 py-3"
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

      <Section title="自定义上游">
        <p className="mb-2 text-[12px] leading-5 text-muted">
          栖岛不绑定任何模型厂商 —— 接哪家都行（DeepSeek、智谱、通义，或任何 OpenAI
          兼容接口）。填三样：地址、密钥、模型名。
          <br />
          密钥<span className="text-fg">只存在这台设备的浏览器里</span>
          ，不进代码、不进仓库。
        </p>
        <input
          value={settings.customBaseUrl}
          onChange={(e) => patch({ customBaseUrl: e.target.value })}
          placeholder="https://your-proxy/v1"
          className="mb-2 h-11 w-full rounded-2xl bg-chip px-3 text-sm outline-none"
        />
        <input
          type="password"
          value={settings.customApiKey}
          onChange={(e) => patch({ customApiKey: e.target.value })}
          placeholder="API Key"
          className="h-11 w-full rounded-2xl bg-chip px-3 text-sm outline-none"
        />

        {/* 模型名：换一家 API 最容易踩的坑 —— 名字得听对方的。
            猜错的话上游只回一句英文报错，看起来像密钥不对，极难定位。 */}
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <input
              value={settings.upstreamModel}
              onChange={(e) => patch({ upstreamModel: e.target.value.trim() })}
              placeholder="上游模型名，例如 deepseek-v4-pro"
              aria-label="上游模型名"
              className="h-11 min-w-0 flex-1 rounded-2xl bg-chip px-3 text-sm outline-none"
            />
            <button
              type="button"
              disabled={!settings.customBaseUrl.trim() || !settings.customApiKey.trim() || probing}
              onClick={probeModels}
              className="h-11 shrink-0 rounded-2xl bg-chip px-3.5 text-[12px] font-medium disabled:opacity-40"
            >
              {probing ? "问上游…" : "拉取可用模型"}
            </button>
          </div>

          {modelMsg && <p className="mt-1.5 text-[11px] leading-4 text-warn">{modelMsg}</p>}

          {models.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {models.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    patch({ upstreamModel: m });
                    setModels([]);
                    setModelMsg(`已选 ${m}`);
                  }}
                  className="rounded-full bg-chip px-3 py-1.5 font-mono text-[11px]"
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          <p className="mt-1.5 text-[11px] leading-4 text-subtle">
            用自定义地址时这一格<span className="text-fg">必须填</span>
            —— 上面三档只是推理力度；不填就会把无效的模型名发出去，对方只会回一句英文报错。
            <br />
            不记得名字就点「拉取可用模型」，直接问对方要列表。
          </p>
        </div>
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
        <div className="mb-2 rounded-2xl bg-chip px-3.5 py-3">
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
                onClick={() => patch({ toolProtocol: id })}
                className={cn(
                  "rounded-full px-3 py-2 text-[12px] font-medium",
                  (settings.toolProtocol ?? "auto") === id ? "bg-ink text-ink-fg" : "bg-elevated",
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
        <div className="mb-2 rounded-2xl bg-chip px-3.5 py-3">
          <p className="text-[12px] leading-5">每次发多少工具</p>
          <p className="mt-1 text-[11px] leading-4 text-muted">
            按需：只按当前这句话挑相关的几组发过去（省钱，也少让他选错）。
            拿不准你在说什么的时候会全发，不会让他「不会做」。
            全发：每轮都带 61 个动作，最稳但最贵 —— 怀疑按需漏了什么就切到这儿对比。
          </p>
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
                onClick={() => patch({ toolCatalog: id })}
                className={cn(
                  "rounded-full px-3 py-2 text-[12px] font-medium",
                  ((settings.toolCatalog ?? "auto") === "auto" ? "auto" : "all") === id
                    ? "bg-ink text-ink-fg"
                    : "bg-elevated",
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
          className="h-11 w-full rounded-2xl bg-chip px-3.5 text-[13px] font-medium disabled:opacity-40"
        >
          {probeBusy ? "正在问上游，稍等…（最多 20 秒）" : "测一测这个上游支不支持工具调用"}
        </button>
        {probeBusy && (
          <p className="mt-1.5 text-[11px] leading-4 text-subtle">
            真机上网络往返 0.8~2 秒很正常，三条请求加起来可能要几秒 —— 别退出去，马上好。
          </p>
        )}
        {probeResult && !probeBusy && (
          <div className="mt-2 rounded-2xl bg-chip px-3.5 py-3">
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

  const systemSections = (
    <>
      <Section title="思考链">
        {/* 只留「显示」—— 「保存思考链」已去掉：
            思考过程回复时你当场就能看到，再存一份纯占地方（用户明确要求删）。 */}
        <Row
          label="显示思考过程"
          hint="折叠块展示推理"
          checked={settings.showThinking}
          onChange={(v) => patch({ showThinking: v })}
        />
        {/*
          这两项原来在「我的空间 → 个性化」里（最大输出长度 + 回复风格），
          用户要求挪到思考链这边：
          "思考链的最大输出长度和模型回复风格放思考链那里，不要放在个性化那里"。
          它们本来就跟"思考多深 / 回答多长"是一回事，放这儿更贴。
        */}
        <p className="mt-4 mb-2 text-[12px] text-muted">最大输出长度</p>
        <div className="flex flex-wrap gap-2">
          {[
            { v: 0, label: "跟随档位" },
            { v: 8192, label: "8192" },
            { v: 16384, label: "16384" },
            { v: 32768, label: "32768" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => patch({ maxTokens: o.v })}
              className={cn(
                "rounded-2xl border px-3 py-2 text-[12px]",
                settings.maxTokens === o.v ? "border-ink bg-ink text-ink-fg" : "border-line",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-subtle">
          思考链太长被掐断、只剩空回复时，调大这个能缓解（有些网关把思考也算进这个额度）。
          但调太大某些模型会直接报错 —— 所以默认「跟随档位」。
        </p>

        <p className="mt-4 mb-2 text-[12px] text-muted">回复风格</p>
        <div className="flex gap-2">
          {STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => patch({ replyStyle: s.id })}
              className={cn(
                "rounded-full px-3 py-1.5 text-[13px]",
                settings.replyStyle === s.id ? "bg-ink text-ink-fg" : "bg-chip",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      {/*
        ── 说话方式：**分段回复**（2026-11 用户要的）─────────────────────
        用户原话："他这个回复只能我回一句，他回一句，就感觉不像真人；
        能不能他分段回呢？一句就跟发消息似的，可以发好几条那种。"
        以及："分段做成可调节的吧，就是我自己设置最多几句。"

        所以四个旋钮都摆在这儿，**不写死在代码里** —— 效果不对他自己拧，
        不用等我改代码重新打包。切分逻辑见 `lib/segment.ts`。
      */}
      <Section title="说话方式">
        <Row
          label="分段回复"
          hint="像真人那样连着发几条"
          checked={settings.segmentReply !== false}
          onChange={(v) => patch({ segmentReply: v })}
        />
        <p className="mt-1.5 text-[11px] leading-4 text-subtle">
          打开后他可以把想说的分成几条发过来，一条一个气泡、一条接一条出现。
          **一句能说完的回复不会被切开**（只有他确实有几句话要分开说时才分）。
        </p>

        {settings.segmentReply !== false && (
          <>
            <p className="mt-4 mb-2 text-[12px] text-muted">一次最多几条</p>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patch({ segmentMaxParts: v })}
                  className={cn(
                    "rounded-2xl border px-3 py-2 text-[12px]",
                    (settings.segmentMaxParts ?? 3) === v ? "border-ink bg-ink text-ink-fg" : "border-line",
                  )}
                >
                  {v} 条
                </button>
              ))}
            </div>

            <p className="mt-4 mb-2 text-[12px] text-muted">每条最多几句</p>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patch({ segmentMaxSentences: v })}
                  className={cn(
                    "rounded-2xl border px-3 py-2 text-[12px]",
                    (settings.segmentMaxSentences ?? 2) === v ? "border-ink bg-ink text-ink-fg" : "border-line",
                  )}
                >
                  {v} 句
                </button>
              ))}
            </div>

            <p className="mt-4 mb-2 text-[12px] text-muted">段间延迟</p>
            <div className="flex flex-wrap gap-2">
              {[400, 800, 1200, 1800, 2500].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patch({ segmentDelayMs: v })}
                  className={cn(
                    "rounded-2xl border px-3 py-2 text-[12px]",
                    (settings.segmentDelayMs ?? 1200) === v ? "border-ink bg-ink text-ink-fg" : "border-line",
                  )}
                >
                  {(v / 1000).toFixed(1)} 秒
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-subtle">
              两条之间隔多久出现。太短就没有"一句句发过来"的感觉，太长会显得他在发呆。
            </p>
          </>
        )}
      </Section>

      {/*
        ── 表情包（2026-11 用户要的"他自己会发表情"）─────────────────
        两块：① 入库时**去白底**（照片/白底截图 → 真正的透明表情）
             ② 他能**自己决定发一张**（动作 `sticker.send`，挑哪张由客户端定）
        "按情绪挑"要等"给表情打标签"那一步，所以这里先不给它编不存在的开关。
      */}
      <Section title="表情包">
        <Row
          label="传表情时自动去白底"
          hint="照片/白底截图 → 透明表情"
          checked={settings.stickerRemoveWhite !== false}
          onChange={(v) => patch({ stickerRemoveWhite: v })}
        />
        <p className="mt-1.5 text-[11px] leading-4 text-subtle">
          从相册选的表情常常是白底照片，贴到聊天里就是一块白边（不是表情包那个样子）。
          打开这项会自动把**跟边缘连通的白色**变透明（图内部的白留住，比如眼白、白字）。
          动图（GIF/WebP）不会被重画，动画保留。
        </p>
        <p className="mt-3 text-[11px] leading-4 text-subtle">
          他**可以自己发表情**（不用你问）：想发的时候会从你的表情库里挑一张，
          而且会避开上一次那张。想加表情就走输入框的「＋ → 表情包」。
        </p>
      </Section>

      <Section title="通知">
        <Row
          label="允许通知"
          hint="打开时向系统申请权限"
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

        <div className="mb-2 rounded-2xl bg-chip px-3.5 py-3 text-[11px] leading-5 text-muted">
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
        <div className="mt-3 mb-4 rounded-2xl bg-chip px-3.5 py-3">
          <p className="text-[12px] font-medium">他主动找你</p>
          {/*
            **总开关**（用户原话："这个定时唤醒要做个开关，哪一天我不想他跑了，可以一键关闭"）。
            关掉之后：Worker 一次 AI 都不问、不弹通知；后台那段 JS 还会把"静音"记下来，
            接下来 4 小时连请求都不发（省电）。
            唯一关不掉的是"系统每 1 小时来一次"这个节拍 —— 它写在打包配置里。
          */}
          <Row
            label="让他主动找我"
            hint="关掉就完全安静：不问 AI、不弹通知、后台几小时内也不发请求"
            checked={settings.wakeEnabled ?? true}
            onChange={(v) => patch({ wakeEnabled: v })}
          />

          <p className="mt-1.5 text-[11px] leading-4 text-subtle">
            {settings.wakeEnabled ?? true
              ? "系统每 1 小时来一次（只是起一下程序，你感觉不到）；每次一半概率真的看他一眼，看了再由他决定说不说。"
              : "已经关掉了 —— 他不会再主动找你（包括后台。要重新开就打开上面这个开关）。"}
          </p>
          {!wakeSupported() && (
            <p className="mt-1 text-[11px] leading-4 text-warn">
              （网页版没有后台任务 —— 这一栏只有装成 App 之后才有用）
            </p>
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
          <div className="mt-2 rounded-2xl bg-elevated px-3 py-2.5">
            <p className="text-[11px] leading-5 text-muted">
              <strong>他多久会开口</strong>
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] leading-5 text-subtle">
              <li>· 每 <strong>1 小时</strong>系统来一次（很轻，你感觉不到）</li>
              <li>· 这一半：<strong>50%</strong> 真的看他一眼；没看 → <strong>下次必定看</strong></li>
              <li>· 看了之后：<strong>50%</strong> 他会说；没说 → <strong>下次必定说</strong></li>
              <li>· 所以最坏 <strong>4 小时</strong>一定有他一句话（平均约 2~2.5 小时）</li>
              <li>· 他一旦说了，两边都重新算</li>
            </ul>
          </div>

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
          {wakeUrlSource() !== "none" && (
            <p className="mt-1 text-[11px] leading-4 text-subtle">
              备路（Worker 中转）：{wakeUrlSource() === "manual" ? "手填地址" : "打包时已注入"} —— 只有主路不通时才需要它
            </p>
          )}

          {/* 夜间不打扰 */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted">夜间不打扰</span>
            <select
              value={settings.wakeQuietStart ?? 1}
              onChange={(e) => patch({ wakeQuietStart: Number(e.target.value) })}
              className="rounded-full bg-elevated px-3 py-1.5 text-[11px]"
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
              className="rounded-full bg-elevated px-3 py-1.5 text-[11px]"
              aria-label="夜间不打扰结束的小时"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-subtle">
            这两格设成一样 = 不启用。（跨零点也对：比如 23:00 → 7:00。）
          </p>

          {/*
            ── 主动说话的三个闸门（2026-11 用户要的）────────────────────
            用户原话："设置一个回复的约定或按钮，我主动说忙，他自动调低，否则原来就行。"
            ＋ "他自己情绪到了，也可以发吧……或者你给情绪那个加个按钮，只单独管情绪发消息这个。"
            ＋ "降频那个不用"（所以**没有**"你不理他就自动降频"）。
            默认值：最短 40 分钟、每天最多 8 条 —— 这两条是防骚扰的地板。
          */}
          <div className="mt-3 rounded-2xl bg-chip px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-[12px] leading-5">
                {busy ? (
                  <>
                    <span className="text-warn">我现在忙</span>
                    <br />
                    <span className="text-subtle">
                      他不会再主动说话，到 {new Date(settings.busyUntil ?? 0).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 自动恢复
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
                onClick={() => patch({ busyUntil: busy ? 0 : Date.now() + 2 * 60 * 60 * 1000 })}
                className="shrink-0 rounded-2xl border border-line px-3 py-2 text-[12px]"
              >
                {busy ? "取消" : "我在忙（2 小时）"}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-subtle">
              说忙之后是**彻底不打扰**（不是"少说点"）—— 你主动找他说话不受影响。
            </p>
          </div>

          <Row
            label="心情可以单独让他开口"
            hint="情绪到了就能说，不用等由头"
            checked={settings.emotionSpeak !== false}
            onChange={(v) => patch({ emotionSpeak: v })}
          />
          <p className="mt-1.5 text-[11px] leading-4 text-subtle">
            打开：他情绪到了就能主动说一句。关掉：只有真有由头（隔了很久 / 深夜 / 你正挂在心上的事）才会开口，
            心情只影响他怎么说。
          </p>

          <p className="mt-4 mb-2 text-[12px] text-muted">最短间隔（两次主动说话之间）</p>
          <div className="flex flex-wrap gap-2">
            {[30, 40, 60, 90, 120].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => patch({ wakeMinGapMin: v })}
                className={cn(
                  "rounded-2xl border px-3 py-2 text-[12px]",
                  (settings.wakeMinGapMin ?? 40) === v ? "border-ink bg-ink text-ink-fg" : "border-line",
                )}
              >
                {v} 分钟
              </button>
            ))}
          </div>

          <p className="mt-4 mb-2 text-[12px] text-muted">每天最多主动说几条</p>
          <div className="flex flex-wrap gap-2">
            {[4, 6, 8, 12].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => patch({ wakeDailyMax: v })}
                className={cn(
                  "rounded-2xl border px-3 py-2 text-[12px]",
                  (settings.wakeDailyMax ?? 8) === v ? "border-ink bg-ink text-ink-fg" : "border-line",
                )}
              >
                {v} 条
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-subtle">
            这两条是**地板**：不管什么理由都不会越过它们。他现在是每 1 小时醒一次、掷骰子决定说不说，
            所以"最短间隔"实际很少碰到（醒来次数本来就少），真正管用的是每天上限。
          </p>

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
              className="rounded-full bg-elevated px-4 py-2 text-[12px] font-medium disabled:opacity-40"
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
              className="rounded-full bg-elevated px-4 py-2 text-[12px] font-medium disabled:opacity-40"
            >
              {wakeResetBusy ? "正在清…" : wakeResetArmed ? "再点一下，确认清空" : "清空后台状态，重新来"}
            </button>
          </div>
          {wakePingMsg && <p className="mt-1.5 text-[11px] leading-4 text-subtle">{wakePingMsg}</p>}
          {wakeResetMsg && <p className="mt-1.5 text-[11px] leading-4 text-subtle">{wakeResetMsg}</p>}

          <p className="mt-2 text-[11px] leading-4 text-subtle">
            自检只问一句&ldquo;这条路通不通&rdquo;，不改任何东西。一次真机验证要等 1 小时（到下一次节拍），
            所以先用它把&ldquo;地址错 / 口令错 / Worker 没部署 / 上游没配&rdquo;分开。
          </p>
          <p className="mt-1.5 text-[11px] leading-4 text-subtle">
            「清空后台状态，重新来」会清掉：醒来次数、后台日志、上次说话时间、静音标记，
            还有交给后台的那份配置（清完立刻重新交一份新的）。
          </p>

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
            {wakeLogOpen ? "收起后台记录" : "看后台最近几次醒来"}
          </button>
          {wakeLogOpen && (
            <div className="mt-1.5 rounded-2xl bg-elevated px-3 py-2">
              {wakeLogLines === undefined ? (
                <p className="text-[11px] leading-4 text-subtle">正在读后台的记录…</p>
              ) : wakeLogLines && wakeLogLines.length > 0 ? (
                <>
                  <p className="text-[11px] leading-4 text-subtle">
                    后台最近 {wakeLogLines.length} 次醒来（最近的在最上面）：
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
        </div>

        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void testNotify()}
            className="rounded-full bg-chip px-4 py-2.5 text-[13px]"
          >
            发一条测试通知
          </button>
          <button
            type="button"
            onClick={() => void doSubscribe()}
            className="rounded-full bg-chip px-4 py-2.5 text-[13px]"
          >
            订阅后台推送
          </button>
        </div>
        {toast && <p className="mb-2 px-1 text-[11px] leading-4 text-muted">{toast}</p>}

        <Row
          label="额度提醒"
          hint="接近上限时提示"
          checked={settings.quotaAlerts}
          onChange={(v) => patch({ quotaAlerts: v })}
        />
        <Row
          label="日记提醒"
          hint="App 开着时到点提醒；完全关闭收不到"
          checked={settings.diaryReminders}
          onChange={(v) => patch({ diaryReminders: v })}
        />
        {settings.diaryReminders && (
          <label className="mt-2 flex items-center justify-between rounded-2xl bg-chip px-3.5 py-3">
            <span className="text-[13px]">提醒时间</span>
            <input
              type="time"
              value={settings.reminderTime}
              onChange={(e) => patch({ reminderTime: e.target.value })}
              className="bg-transparent text-[13px] outline-none"
            />
          </label>
        )}

        {/*
          「闹钟 / 提醒」的列表入口**已挪到「玩乐 → 小日子 → 闹钟」**
          （用户："把闹钟和定时任务都挪到小日子这个组件里面呗，
                 然后我的区里面就删掉就不用重复了"）。
          这里只留上面那个"日记提醒时间"的开关 —— 它属于通知设置，不是闹钟。
        */}
      </Section>

      <Section title="天气与定位">
        <Row
          label="让他知道你在哪、外面什么天气"
          hint="默认关。开了之后地点和天气会进「此刻的情况」—— 也就是说会发给你接的那家 AI"
          checked={settings.geoEnabled}
          onChange={(v) => patch({ geoEnabled: v })}
        />

        {settings.geoEnabled && (
          <>
            {/* ── 手动指定地点：不依赖任何服务，永远可用 ── */}
            <p className="mt-3 mb-2 text-[12px] text-muted">你常待的地方</p>
            <input
              value={settings.manualPlace}
              onChange={(e) => patch({ manualPlace: e.target.value })}
              placeholder="例如 北京市朝阳区"
              aria-label="手动指定地点"
              className="h-11 w-full rounded-2xl bg-chip px-3 text-sm outline-none placeholder:text-subtle"
            />
            <p className="mt-1.5 text-[11px] leading-4 text-subtle">
              填了就直接用它 —— <span className="text-fg">不用网络、不会失败</span>，而且日常就在那一两个地方，
              比每次重新定位还准。想用自动定位就留空。
            </p>

            {/* ── 和风天气：一次配好，定位（反查地名）和天气都能用 ── */}
            <p className="mt-4 mb-2 text-[12px] text-muted">和风天气</p>
            <input
              value={settings.qweatherHost}
              onChange={(e) => patch({ qweatherHost: e.target.value.trim() })}
              placeholder="API Host，例如 abcd1234.re.qweatherapi.com"
              aria-label="和风 API Host"
              className="mb-2 h-11 w-full rounded-2xl bg-chip px-3 font-mono text-[12px] outline-none placeholder:text-subtle"
            />
            <input
              type="password"
              value={settings.qweatherKey}
              onChange={(e) => patch({ qweatherKey: e.target.value.trim() })}
              placeholder="API Key"
              aria-label="和风 API Key"
              className="h-11 w-full rounded-2xl bg-chip px-3 font-mono text-[12px] outline-none placeholder:text-subtle"
            />
            <p className="mt-1.5 text-[11px] leading-4 text-subtle">
              在和风控制台「项目管理 → 创建项目 → 添加凭据（选 API KEY）」里拿这两样。
              <br />
              <span className="text-fg">API Host 每个人不一样</span>（和风早就不是统一的
              devapi.qweather.com 了），控制台首页能看到。免费额度每月 5 万次，个人用不完。
              <br />
              它管两件事：把坐标翻译成地名（就是原来一直失败的那一步），以及天气。
              <br />
              <span className="text-fg">这两栏是边打边存的</span>，不用点保存 ——
              填完把上面的开关打开，再点下面的「刷新」。
            </p>

            {/* ── 现在在哪 / 什么天气 ── */}
            <div className="mt-3 rounded-2xl bg-chip px-3.5 py-3">
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
                <button
                  type="button"
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
                  disabled={geoBusy}
                  className="shrink-0 rounded-full bg-elevated px-3.5 py-1.5 text-[13px] font-medium text-fg shadow-sm disabled:opacity-50"
                >
                  {geoBusy ? "刷新中…" : "刷新"}
                </button>
              </div>
              {geoMsg && <p className="mt-2 text-[11px] leading-4 text-subtle">{geoMsg}</p>}
              <p className="mt-2 text-[11px] leading-4 text-subtle">
                地点、天气、Key 都只存在这台设备上；关掉上面的开关就不再进提示词。
              </p>
            </div>
          </>
        )}
      </Section>

      <Section title="语音">
        <Row
          label="朗读回复"
          hint="使用系统语音"
          checked={settings.voiceReplies}
          onChange={(v) => patch({ voiceReplies: v })}
        />

        {/* 音色 / 语速 / 音调 —— 用户要的"换音色和改音调" */}
        <p className="mt-4 mb-2 text-[12px] text-muted">语音服务（语音转文字 + 合成）</p>
        <div className="rounded-2xl bg-chip px-3.5 py-3">
          <p className="text-[11px] leading-4 text-subtle">
            手机的系统识别就是 YOYO（它自己接话、不把文字还给栖岛）✅ 所以这里单接一家：
            自己录音 → 上传转文字 → 语言模型回复 → 再合成语音放出来 ✅
            <br />
            硅基流动那家：地址填 https://api.siliconflow.cn/v1 ，
            转文字 FunAudioLLM/SenseVoiceSmall，合成 FunAudioLLM/CosyVoice2-0.5B ✅
          </p>
          {[
            { k: "voiceBaseUrl" as const, label: "地址", ph: "https://api.siliconflow.cn/v1" },
            { k: "voiceApiKey" as const, label: "密钥", ph: "sk-…", secret: true },
            { k: "voiceAsrModel" as const, label: "转文字模型", ph: "FunAudioLLM/SenseVoiceSmall" },
            { k: "voiceTtsModel" as const, label: "合成模型", ph: "FunAudioLLM/CosyVoice2-0.5B" },
            { k: "voiceTtsVoice" as const, label: "音色", ph: "alex" },
          ].map((f) => (
            <label key={f.k} className="mt-2 block">
              <span className="mb-1 block text-[11px] text-muted">{f.label}</span>
              <input
                type={f.secret ? "password" : "text"}
                value={(settings[f.k] as string | undefined) ?? ""}
                onChange={(e) => patch({ [f.k]: e.target.value } as Partial<typeof settings>)}
                placeholder={f.ph}
                className="h-10 w-full rounded-2xl bg-surface px-3 text-[12px] outline-none"
              />
            </label>
          ))}
          <p className="mt-2 text-[11px] leading-4 text-subtle">
            密钥只存在这台设备里，不进代码、不进仓库 ✅ 填了就会自动启用：
            语音页和输入框的麦克风都改走它（YOYO 不再出现 ✅），朗读也用它家的音色 ✅
            「试听一句」用的就是这个音色 ✅
          </p>
        </div>

        <p className="mt-4 mb-2 text-[12px] text-muted">语速 {settings.voiceRate.toFixed(2)}×</p>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={settings.voiceRate}
          onChange={(e) => patch({ voiceRate: Number(e.target.value) })}
          className="w-full"
        />
        <p className="mt-3 mb-2 text-[12px] text-muted">
          音调 {settings.voicePitch.toFixed(2)}（低一点更沉稳，高一点更年轻）
        </p>
        <input
          type="range"
          min={0.5}
          max={1.8}
          step={0.05}
          value={settings.voicePitch}
          onChange={(e) => patch({ voicePitch: Number(e.target.value) })}
          className="w-full"
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void speakTextAsync("你好，我是" + resolveAiName(settings.aiName) + "。", {})}
            className="rounded-full bg-chip px-3.5 py-2 text-[12px] text-fg"
          >
            试听一句
          </button>
          {!IS_APP && (
            <button
              type="button"
              onClick={() => setVoices(window.speechSynthesis?.getVoices?.() ?? [])}
              className="rounded-full bg-chip px-3.5 py-2 text-[12px] text-fg"
            >
              换音色（共 {voices.length} 个）
            </button>
          )}
        </div>
        {!IS_APP && voices.length > 0 && (
          <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-2xl bg-chip px-3 py-2">
            {voices
              .filter((v) => /zh|cmn|Chinese/i.test(v.lang))
              .slice(0, 12)
              .map((v) => (
                <button
                  key={v.voiceURI}
                  type="button"
                  onClick={() => patch({ voiceURI: v.voiceURI })}
                  className={cn(
                    "block w-full truncate rounded-lg px-2 py-1.5 text-left text-[12px]",
                    settings.voiceURI === v.voiceURI ? "bg-elevated text-fg" : "text-muted",
                  )}
                >
                  {v.name} · {v.lang}
                </button>
              ))}
          </div>
        )}
        {IS_APP && (
          <p className="mt-2 text-[11px] leading-4 text-subtle">
            App 里的音色由<span className="text-fg">安卓系统的语音引擎</span>决定：去「系统设置 → 语音合成」里换引擎/装语音包，
            这里调的是语速和音调。
          </p>
        )}
      </Section>

      {/*
        「定时任务」那一段**已挪到「玩乐 → 小日子 → 定时任务」**
        （跟闹钟一起挪的，用户要求，理由是"这样看着分类更准一点"）。
        这一页不再重复。
      */}

      <Section title="开发与纠错">
        {/* Section 里的子元素是直接堆叠的，多张卡片必须自己包一层间距，
            否则半透明圆角卡片贴在一起会看起来像「重合」。 */}
        <div className="space-y-2">
          <Link
            to="/env"
            className="flex items-center justify-between gap-3 rounded-2xl bg-chip px-3.5 py-3"
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
      </Section>

      {/*
        这块**已经不显示了**（`hidden`）—— 它的内容搬到「AI 概览」里了：
          · 权限与感知 → /permissions（从 AI 概览进）
        「我的」页面留着它只会又长又重复。

        用户要求："我之前让你删掉的那些外面还有就把它给调整了吧免得误导"——
        所以这里**不再是"留着以后用"**：要么删掉，要么明确它就是废弃的。
        保持 hidden 但写清原因，免得以后有人以为漏了又把它打开。

        ⚠️ 2026-10：原来这里还有一块 hidden 的「内在」（他自己报的状态样本）。
        旧的 11 维花瓣连 `state.report` 一起退场之后，`stateSamples` 已经不存在了，
        所以那一块**整块删掉**（不是留个 hidden 的空壳）。

        ⚠️ 2026-11：连「AI 概览」里那条「他的状态」入口和 `/inner` 那一页也**一起删了**
        （用户："直接把他的状态这一项直接给删掉就行了，那个三级页面也不用留了"）。
        情绪看「星屿」：玩乐 → 插件 → 星屿 —— 不用再留第二条路。
      */}
      <Section title="AI 权限" hidden>
        <Link
          to="/permissions"
          className="flex items-center justify-between gap-3 rounded-2xl bg-chip px-3.5 py-3"
        >
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">权限与感知</span>
            <span className="mt-0.5 block text-[11px] text-muted">
              {sum.allow} 项允许 · {sum.ask} 项询问 · {sum.deny} 项拒绝（共 {sum.total} 项）
            </span>
            <span className="mt-0.5 block text-[11px] text-subtle">
              分级说明、他能感知到什么、动作记录都在那一页
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted" />
        </Link>
      </Section>
    </>
  );

  if (tab === "space") return <>{spaceSections}</>;
  if (tab === "usage") return <>{usageSections}</>;
  if (tab === "data") return <>{dataSections}</>;
  return <>{systemSections}</>;
}

/* ───────────────────────────── 小部件 ───────────────────────────── */

function AvatarSlot({
  label,
  hint,
  value,
  preview,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  preview: ReactNode;
  onChange: (v: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <FileButton
        ariaLabel={label}
        accept="image/*"
        className="flex items-center gap-2.5 text-left"
        onPick={(files) => {
          const file = files[0];
          if (file) readBackground(file, onChange);
        }}
      >
        {preview}
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{label}</span>
          <span className="block truncate text-[11px] text-muted">
            {value ? "已设置" : "点击上传"} · {hint}
          </span>
        </span>
      </FileButton>
      {value && (
        <button
          type="button"
          className="mt-1.5 pl-1 text-[11px] text-subtle"
          onClick={() => onChange("")}
        >
          恢复默认
        </button>
      )}
    </div>
  );
}

/** 一张背景图槽位：缩略图 + 名字 + 说明 + 更换/移除。 */
function ImageRow({
  label,
  hint,
  value,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  value: string;
  onPick: (url: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-chip px-3 py-2.5">
      <FileButton
        ariaLabel={value ? `更换${label}` : `上传${label}`}
        accept="image/*"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onPick={(files) => {
          const file = files[0];
          if (file) readBackground(file, onPick);
        }}
      >
        <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-elevated">
          {value ? (
            <img src={value} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-4 text-muted" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{label}</span>
          <span className="block truncate text-[11px] text-muted">
            {value ? "已设置 · 点一下换" : `${hint} · 点一下上传`}
          </span>
        </span>
      </FileButton>
      {value && (
        <button
          type="button"
          aria-label={`移除${label}`}
          onClick={onClear}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-muted"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** 探测结果里的一行：通过 / 不通过 */
function ProbeLine({ label, pass }: { label: string; pass: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[13px]">{label}</span>
      <span className={cn("shrink-0 text-[12px] font-medium", pass ? "text-ok" : "text-warn")}>
        {pass ? "通过" : "不通过"}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
  hidden,
}: {
  title: string;
  children: ReactNode;
  /** 暂时收起这一块（内容已经归到别处了，但代码先留着） */
  hidden?: boolean;
}) {
  // 收起的块直接不渲染（代码留着，随时能放回来）
  if (hidden) return null;
  return (
    <section className="mt-6 px-4">
      <h2 className="mb-2 px-1 text-[12px] tracking-wide text-muted">{title}</h2>
      <div className="rounded-3xl border border-line bg-surface p-3">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2.5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[12px] text-muted">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={label} />
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("mt-3 px-1", disabled && "opacity-45")}>
      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>{label}</span>
        <span>
          {Math.round(value * 100) / 100}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
        style={{ accentColor: "var(--aster-accent)" }}
      />
    </div>
  );
}

function readBackground(file: File, done: (url: string) => void) {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") done(reader.result);
  };
  reader.readAsDataURL(file);
}
