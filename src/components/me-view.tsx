import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight, ImagePlus, Lock, SlidersHorizontal, X } from "lucide-react";
import { BackupSection } from "@/components/backup-section";
import {
  localNotify,
  PERMISSION_LABEL,
  permissionState,
  pushKeyConfigured,
  registerServiceWorker,
  requestPermission,
  secureContextOk,
  subscribePush,
  swRegistration,
  type SwStatus,
} from "@/lib/notify";
import { MODELS, QUOTA_LIMIT } from "@/lib/models";
import { resetLabel } from "@/lib/greeting";
import { useApp } from "@/lib/store";
import type { FontId, ReplyStyle, TextTone, ThemeId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { AsterMark } from "@/components/aster-mark";
import { Avatar } from "@/components/avatar";
import { FileButton } from "@/components/file-button";
import { DEFAULT_AI_NAME, BUILD_TAG, resolveAiName } from "@/lib/branding";
import { permissionSummary } from "@/lib/permissions";
import { useScrollMemory } from "@/lib/ux";

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

export function MeView() {
  const settings = useApp((s) => s.settings);
  const quota = useApp((s) => s.quota);
  const hydrationDone = useApp((s) => s.hydrated);
  // 配额重置时间是按「现在」算的 —— 服务端和客户端算出来必然不同，
  // 所以等服务端渲染过去之后再显示，避免水合失败。
  const resetAt = useApp((s) => s.quotaResetAt());
  const hydrated = hydrationDone;
  const usedPct = Math.min(100, Math.round((quota.used / QUOTA_LIMIT) * 100));
  const patch = useApp((s) => s.patchSettings);
  const background = settings.background;
  const sum = permissionSummary(settings.permissions);
  const reminders = useApp((s) => s.reminders);

  // 通知相关状态（都在 effect 里读，避免 SSR / 客户端不一致）
  const [perm, setPerm] = useState<NotificationPermission | "unsupported" | "loading">("loading");
  const [secure, setSecure] = useState<boolean | null>(null);
  const [sw, setSw] = useState<SwStatus | null>(null);
  const [pushReady, setPushReady] = useState(false);
  const [toast, setToast] = useState("");
  // 背景那几个滑杆默认锁住 —— 手机上滑页面太容易误改
  const [bgUnlocked, setBgUnlocked] = useState(false);
  const scrollRef = useScrollMemory("me");

  useEffect(() => {
    setPerm(permissionState());
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
          他会用这个名字称呼你 · AI 头像与名字在下面「形象」里
        </p>
      </section>

      <Section title="额度（本机计数）">
        <div className="rounded-2xl bg-chip px-4 py-3">
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
            每窗口 {QUOTA_LIMIT} 次
          </p>
          <p className="mt-2 text-[12px] leading-5 text-muted">
            这是本地计数器，用来防止误触刷屏；不是服务端配额，也不影响模型本身。
          </p>
        </div>
      </Section>

      <Section title="当前模型">
        <div className="grid gap-1">
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                useApp.getState().setModel(m.id);
                patch({ defaultModel: m.id });
              }}
              className={cn(
                "flex items-center justify-between rounded-2xl px-3 py-3 text-left",
                settings.defaultModel === m.id ? "bg-chip" : "",
              )}
            >
              <span>
                <span className="block text-sm font-medium">{m.label}</span>
                <span className="text-[12px] text-muted">{m.mapping}</span>
              </span>
              {settings.defaultModel === m.id && <span className="size-2 rounded-full bg-accent" />}
            </button>
          ))}
        </div>
      </Section>

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
        <p className="mt-2 text-[12px] leading-5 text-muted">
          深色背景图下小字看不清时，把它换成浅色字就行。
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

      {/* 备份 / 恢复：内容只在这台设备的浏览器里，导出一份能保命 */}
      <BackupSection />

      <Section title="思考链">
        <Row
          label="显示思考过程"
          hint="折叠块展示推理"
          checked={settings.showThinking}
          onChange={(v) => patch({ showThinking: v })}
        />
        <Row
          label="保存思考链"
          hint="写入本地思考档案，必须开启才能归档"
          checked={settings.saveThinking}
          onChange={(v) => patch({ saveThinking: v })}
        />
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
            <span className={pushReady ? "text-ok" : "text-warn"}>
              {pushReady ? "服务端已配好，可订阅" : "服务端还没配 VAPID 密钥"}
            </span>
          </p>
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

        {reminders.length > 0 && (
          <div className="mt-2 rounded-2xl bg-chip px-3.5 py-3">
            <p className="text-[12px] font-medium">提醒 / 待办</p>
            <ul className="mt-2 space-y-2">
              {reminders.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={r.done}
                    aria-label={`完成 ${r.text}`}
                    onClick={() => useApp.getState().toggleReminder(r.id)}
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border",
                      r.done ? "border-fg bg-ink text-ink-fg" : "border-line",
                    )}
                  >
                    {r.done && <Check className="size-3" />}
                  </button>
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-[12px] leading-5",
                      r.done && "text-subtle line-through",
                    )}
                  >
                    {r.text}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{r.time}</span>
                  <button
                    type="button"
                    aria-label="删除提醒"
                    onClick={() => useApp.getState().removeReminder(r.id)}
                    className="shrink-0 text-[11px] text-subtle"
                  >
                    删
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="语音">
        <Row
          label="朗读回复"
          hint="使用系统语音"
          checked={settings.voiceReplies}
          onChange={(v) => patch({ voiceReplies: v })}
        />
      </Section>

      <Section title="AI 权限">
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
          默认走内置 xAI（grok-4.5），映射自 Haiku / Sonnet / Opus，兼容{" "}
          <a className="underline" href="https://github.com/1rgs/claude-code-proxy" target="_blank" rel="noreferrer">
            claude-code-proxy
          </a>{" "}
          的模型分层。若你自建了 OpenAI 兼容代理，可填入地址与密钥（只存在本机）。
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
      </Section>

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
          <Link
            to="/workspace"
            className="flex items-center justify-between gap-3 rounded-2xl bg-chip px-3.5 py-3"
          >
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">工作区</span>
              <span className="mt-0.5 block text-[11px] text-muted">文件树 + 变更时间线</span>
              <span className="mt-0.5 block text-[11px] text-subtle">
                实时扫盘 · 点变更里的文件名可直接定位
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" />
          </Link>
        </div>
      </Section>

      <div className="px-5 py-8 text-center text-[12px] text-subtle">
        栖岛 · 思考链保存在这台设备 · {BUILD_TAG}
      </div>
    </div>
  );
}

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

function Section({ title, children }: { title: string; children: ReactNode }) {
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
