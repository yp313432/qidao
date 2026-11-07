import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ChevronRight,
  Database,
  Palette,
  Settings2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { readImageFile } from "@/lib/image-file";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/shared/avatar";
import { FileButton } from "@/components/shared/file-button";
import { BUILD_TAG } from "@/lib/branding";
import { useScrollMemory } from "@/lib/ux";

/**
 * 「我的」首页：头像 + 名字 + 5 张入口卡 + 版本号。
 *
 * 用户原话：「我的主页那里直接把下面的功能页塞到第二层展示就好了，更短。」
 * 所以这一页只有入口，细节全部在第二层（MePage）。
 */

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
    hint: "他是谁 · 能知道什么 · 怎么和你相处 · 记得你什么",
    icon: Sparkles,
  },
  {
    to: "/space",
    label: "我的空间",
    hint: "形象 · 背景空间 · 个性化",
    icon: Palette,
  },
  {
    to: "/usage",
    label: "模型与用量",
    hint: "用量 · 上下文与内存 · 自定义上游",
    icon: Activity,
  },
  { to: "/data", label: "数据", hint: "备份与恢复", icon: Database },
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
  const patch = useApp((s) => s.patchSettings);
  const settings = useApp((s) => s.settings);
  const scrollRef = useScrollMemory("me");

  /*
   * 「封面收进导航栏」——用户 m14888 的原话：
   *   "这个顶边栏效果我想的是把那个组件做成变化效果的，就是我上滑，整个头像组件滑动缩小到左边，
   *    而不是还保留着那一大块组件，然后再另做一个缩小组件。"
   * 所以这里不是"大卡 + 另做一个小条"两套组件，而是**同一个头像、同一个名字**连续变过去：
   *   卡片高度 268 → 46、头像 80 → 28 并左移、名字跟着缩到头像右边、卡片底淡出、
   *   46px 高的玻璃条浮上来接手顶栏。
   * 滚动中只改 style（不 setState），避免每帧重渲染整页。
   */
  const headRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const avRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  /** 滚到底所需的总可滚量：内容贴住「顶栏底边 + GAP」时刚好用完（挂载时实测） */
  const needRef = useRef(0);

  const HEAD_H = 300; // 展开时资料卡的高度（塌陷行程 = 300-46 = 254px，行程越长收得越慢）
  const BAR_H = 46; // 收进顶栏后的高度
  const AV0 = 80; // 头像展开尺寸
  const AV1 = 28; // 头像收起尺寸
  const NAME_W = 220; // 名字输入框宽度（居中时靠它算落点）
  /**
   * 收起后第一张卡与顶栏之间留的空隙。
   *
   * 用户原话："距离可以没有重叠" —— 宁可留一道缝，也不要让内容被顶栏压住。
   * 这个值参与 need 的计算（见下面 pad），所以它是"收起态唯一的目标间距"，
   * 别在别处再写死一个数字。
   */
  const GAP = 8;
  /** 头块吸顶时距滚动区顶部的偏移，必须和下面 sticky 的 `top` 里的 +2px 保持一致 */
  const BAR_TOP = 2;

  const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const onScroll = (el: HTMLElement) => {
    const head = headRef.current;
    if (!head) return;
    /*
     * 两段式（2026-10-29 定稿，前后返工三次才理清）：
     *   第一段：头块**不动**，先让下面的内容滑上来贴住头底（这一段长度 = need - 行程）
     *   第二段：头块开始塌，内容跟着 1:1 上移（布局占位不变，只改视觉高度）
     * 两段加起来正好让「滚到底 ⇔ 头收成 46px 顶栏 且 第一个入口贴着顶栏」。
     * 开头就让它收（旧版）会出现"中间空一大片"；让它真实变矮又会被顶飞。
     */
    const span = Math.max(1, HEAD_H - BAR_H);
    const dead = Math.max(0, needRef.current - span);
    const t = clamp01((el.scrollTop - dead) / span);
    /*
     * 必须 1:1（不能用 t^1.6 那种前慢后快）：头块是"视觉变矮"、内容按滚动线性上移，
     * 两者一旦不同步，内容就会钻到头块下面或者拉开一道缝。跟手才贴得住。
     */
    const e = t;
    const p = t;
    const W = head.clientWidth || 320;

    const headH = lerp(HEAD_H, BAR_H, e);
    head.style.height = `${headH}px`;
    if (cardRef.current) cardRef.current.style.opacity = String(1 - clamp01(p / 0.72));
    // 玻璃条留到最后三成才浮上来，别在卡片还完整时就压一条白边
    if (barRef.current) barRef.current.style.opacity = String(clamp01((p - 0.55) / 0.35));
    if (avRef.current) {
      const scale = lerp(1, AV1 / AV0, e);
      const x = lerp((W - AV0) / 2, 16, e);
      // 始终留在容器可见范围内（高度在收缩，别让它被 overflow 裁掉）
      const y = Math.min(lerp(56, (BAR_H - AV1) / 2, e), Math.max(headH - AV0 * scale - 4, 0));
      avRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
    if (nameRef.current) {
      const x = lerp((W - NAME_W) / 2, 16 + AV1 + 8, e);
      const y = Math.min(lerp(150, BAR_H / 2 - 15, e), Math.max(headH - 26, 0));
      nameRef.current.style.transform = `translate(${x}px, ${y}px) scale(${lerp(1, 0.58, e)})`;
      if (nameInputRef.current) nameInputRef.current.style.textAlign = e > 0.5 ? "left" : "center";
    }
    const fade = String(1 - clamp01(p / 0.34));
    if (fadeRef.current) {
      fadeRef.current.style.opacity = fade;
      /*
       * 外层已经是 pointer-events: none，这里必须写 `auto` 才会重新可点 ——
       * 写 ""（移除内联样式）只会继承外层的 none，称呼那几个按钮就永远点不动了。
       */
      fadeRef.current.style.pointerEvents = p > 0.34 ? "none" : "auto";
    }
    if (hintRef.current) hintRef.current.style.opacity = fade;
    if (titleRef.current) titleRef.current.style.opacity = String(1 - clamp01(p / 0.22));
  };

  // 首帧就摆好位置（不然那几个 absolute 的元素会先挤在左上角闪一下）
  useEffect(() => {
    const el = scrollRef.current;
    if (el) onScroll(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 补足可滚量：让「滚到底」= 头收成 46px 顶栏，且第一个入口停在它下面 GAP 像素处。
   *
   * ⚠️ 2026-10-29 返工三次的教训：
   *   · 只补到「行程」(254px) → 内容短，滚到底时内容还没贴上来，中间空一大片；
   *   · 让头块真实变矮 → 内容被「缩小 + 滚动」顶两次，直接飞出屏幕。
   * 现在按「第一个内容块贴到 顶栏底边 + GAP 需要滚多少」来补，再在 onScroll 里拆成两段。
   *
   * ⚠️ 2026-10-30 用户报"头像缩小之后和下面内容是重叠的"：
   * 原来目标取的是「顶栏顶边 + BAR_H」（= 顶栏底边，零间距），于是刚收起时第一张卡
   * 正好贴着玻璃条下沿，视觉上像压在一起。现在目标改成顶栏底边 + GAP，
   * 并且把 sticky 自己的吸顶偏移（BAR_TOP）和原生状态栏高度（--q-inset-top）也减掉：
   * 浏览器里 inset-top 是 0，只减 BAR_H 看不出问题，装到真机上内容会被顶栏压住一条。
   */
  useEffect(() => {
    const el = scrollRef.current;
    const sp = spacerRef.current;
    if (!el || !sp) return;
    const pad = () => {
      // 第一个内容块（入口列表 / 二级卡片）距滚动内容顶部的距离
      const content = headRef.current?.parentElement?.nextElementSibling as HTMLElement | null;
      const offset = content
        ? content.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
        : HEAD_H;
      /**
       * 顶栏底边 = 状态栏高度（原生推的 `--q-inset-top`） + 吸顶偏移 + BAR_H。
       * 本页的滚动区从屏幕最顶上开始，所以状态栏高度必须算进来。
       */
      const insetRaw = getComputedStyle(document.documentElement)
        .getPropertyValue("--q-inset-top")
        .trim();
      const insetTop = Number.isFinite(parseFloat(insetRaw)) ? parseFloat(insetRaw) : 0;
      const target = BAR_H + GAP + BAR_TOP + insetTop;
      const need = Math.max(HEAD_H - BAR_H, offset - target);
      needRef.current = need;
      /*
       * 增量补，不能"先归零再量差值"：内容比容器还短时 scrollHeight 会被夹成 clientHeight，
       * 量出来的差值永远是 0（「AI 概览」就吃过这个亏）。按当前可滚量一次次加，几次收敛。
       */
      for (let i = 0; i < 8; i += 1) {
        const diff = need - (el.scrollHeight - el.clientHeight);
        if (Math.abs(diff) < 1) break;
        const cur = parseFloat(sp.style.height) || 0;
        if (cur <= 0 && diff < 0) break;
        sp.style.height = `${Math.max(0, cur + diff)}px`;
      }
      onScroll(el);
    };
    pad();
    const ro = new ResizeObserver(pad);
    ro.observe(el);
    window.addEventListener("resize", pad);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", pad);
    };
    // HEAD_H / BAR_H 是常量，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => onScroll(e.currentTarget)}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav"
      /*
       * 关掉 Chrome 的滚动锚定：头块在滚动中真的在变矮、spacer 同时反向变高，
       * 浏览器会自作主张"保持锚点"去改 scrollTop —— 实测会让进度乱跳（滑到 180 变 202）。
       */
      style={{ overflowAnchor: "none" }}
    >
      {/* 标题：滚动时先淡出，把位置让给资料卡 */}
      <div ref={titleRef} className="px-5 inset-top-100 pb-1">
        <p className="text-xs tracking-wide text-muted">账号与系统</p>
        <h1 className="mt-1 font-serif text-2xl font-medium">我的</h1>
      </div>

      {/*
        资料区 = 一个会"塌"下来的容器：卡片底、顶栏玻璃、头像、名字、文字块都在里面，
        滚动时同一套元素变形，不是换了一套小组件。
      */}
      {/*
        ⚠️ 2026-10-29 第三次返工后的定稿：
        外层永远是 HEAD_H 的**布局占位**，内层 head 只改视觉高度（绝对定位）。
        这样内容的位置只由 scrollTop 决定 —— 滚到底时内容正好落在 46px 顶栏下面，
        既不会「中间空一大片」（那是布局高度不变 + 内容没跟上），也不会被头块自身的缩小顶飞。
        可滚量由底部 spacer 补足，spacer 高度在挂载时实测（见下面那个 effect）。
      */}
      {/*
        ⚠️ 2026-10-30 用户报「AI 概览缩小时下面那些功能点不进去」：
        这一层是 HEAD_H 高的布局占位，收起后它的**透明区域**仍然盖在内容上面（z-20），
        以前整层默认可点，于是把下面的入口全挡住了。
        现在整层 pointer-events: none，只有真正要点的元素（头像、名字输入框、称呼按钮）
        各自加 pointer-events-auto 顶回来。
        ⚠️ **不要用"把外层 height 改小"来躲这个坑**：外层高度就是内容位置计算和
        1:1 映射的基准，改小会让"滚到底 ⇔ 头收完 + 内容贴住"这条恒等式断掉。
      */}
      <div
        className="pointer-events-none sticky z-20 mx-4 mt-3 shrink-0"
        data-surface
        style={{ height: HEAD_H, top: "calc(var(--q-inset-top, 0px) + 2px)" }}
      >
        <div
          ref={headRef}
          className="absolute inset-x-0 top-0 overflow-hidden"
          style={{ height: HEAD_H }}
        >
          <div
            ref={cardRef}
            className="me-head-card absolute inset-0 rounded-3xl border border-line bg-surface"
          />
          <p className="me-exlibris">EX LIBRIS · 栖岛</p>
          <p className="me-rule" />
          <p className="me-rule2" />
          <p className="me-vol">VOL.02 · 2026.11</p>
          <div
            ref={barRef}
            className="me-bar absolute inset-x-0 top-0 h-[46px] rounded-3xl"
            style={{
              opacity: 0,
              backgroundColor: "var(--aster-surface)",
              backdropFilter: "blur(18px) saturate(1.5)",
              WebkitBackdropFilter: "blur(18px) saturate(1.5)",
              borderBottom: "0.5px solid var(--aster-line)",
            }}
          />
          <span
            ref={avRef}
            /* 外层 pointer-events: none，头像要能点，所以这里单独顶回来 */
            className="pointer-events-auto absolute left-0 top-0 block"
            style={{ width: AV0, height: AV0, transformOrigin: "0 0" }}
          >
            <span className="me-av-ring" aria-hidden="true" />
            <FileButton
              ariaLabel="更换我的头像"
              accept="image/*"
              className="flex size-full items-center justify-center rounded-full"
              onPick={(files) => {
                const file = files[0];
                if (file) readImageFile(file, (url) => patch({ userAvatar: url }));
              }}
            >
              <Avatar role="user" size={80} />
            </FileButton>
          </span>
          <p
            ref={hintRef}
            className="absolute inset-x-0 text-center text-[11px] text-subtle"
            style={{ top: 180 }}
          >
            {settings.userAvatar ? "点头像可以换一张" : "点头像上传一张"}
          </p>
          <span
            ref={nameRef}
            /* 同上：名字要能输入/聚焦，得单独顶回可点击 */
            className="pointer-events-auto absolute left-0 top-0 block"
            style={{ width: NAME_W, transformOrigin: "0 0" }}
          >
            <input
              ref={nameInputRef}
              value={settings.displayName}
              onChange={(e) => patch({ displayName: e.target.value.slice(0, 24) })}
              placeholder="你的名字"
              aria-label="显示名"
              maxLength={24}
              className="w-full bg-transparent text-center font-serif text-2xl outline-none placeholder:text-subtle"
            />
          </span>
          <div ref={fadeRef} className="absolute inset-x-0" style={{ top: 196 }}>
            {/*
            称呼（性别）—— 2026-10 用户点名要的：
            "我是女的，凡事跟我相关的应该是女她，包括之前他思考链里我没提醒也是用的男他，
             说了才改 —— 要不要给我头像下面设置个性别设置，让 AI 能知道的。"
            他自己没法猜，只能靠这里告诉他一处、处处生效（提示词 + 说明书都带上）。
          */}
            <div
              className="mt-3 flex items-center justify-center gap-1.5"
              role="group"
              aria-label="他该怎么称呼你"
            >
              {(
                [
                  { v: "", label: "不说" },
                  { v: "女", label: "用「她」" },
                  { v: "男", label: "用「他」" },
                ] as const
              ).map((opt) => {
                const active = (settings.userGender ?? "") === opt.v;
                return (
                  <button
                    key={opt.v || "none"}
                    type="button"
                    aria-pressed={active}
                    data-opt={active ? undefined : ""}
                    onClick={() => patch({ userGender: opt.v })}
                    className={cn(
                      "me-call-btn rounded-full px-3 py-1 text-[11px] transition",
                      active && "data-pill",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/*
        5 个入口 —— 点进去才是细节，首页不再平铺一长串
        （文档：「我的」= AI 控制中枢，先分类再进二级 ✅ 纯入口整理）
      */}
      <p className="me-index-ttl">CONTENTS · 目录</p>
      <nav className="me-index mt-2 px-5">
        {ME_CARDS.map((c, i) => {
          const Icon = c.icon;
          return (
            <Link key={c.to} to={c.to} className="me-index-row">
              <Icon className="me-index-ic" strokeWidth={1.5} aria-hidden="true" />
              <span className="me-index-no">{String(i + 1).padStart(2, "0")}</span>
              <span className="me-index-name">{c.label}</span>
              <span className="me-index-hint">{c.hint}</span>
              <span className="me-index-lead" />
              <ChevronRight className="me-index-arrow" aria-hidden="true" />
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-8 text-center text-[12px] text-subtle">
        栖岛 · 思考链保存在这台设备 · {BUILD_TAG}
      </div>
      {/* 占位：保证「卡片塌成顶栏」那 254px 真的滚得动，高度由上面那个 effect 按实际差量撑出来 */}
      <div ref={spacerRef} aria-hidden style={{ height: HEAD_H - BAR_H, flexShrink: 0 }} />
    </div>
  );
}
