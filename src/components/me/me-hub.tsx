import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  ChevronRight,
  MessageCircle,
  Mic,
  Palette,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { readImageFile } from "@/lib/image-file";
import { Avatar } from "@/components/shared/avatar";
import { FileButton } from "@/components/shared/file-button";
import { BUILD_TAG } from "@/lib/branding";
import { useScrollMemory } from "@/lib/ux";
import { IdentityCard } from "./identity-card";

/**
 * 「我的」首页：资料卡 + 三组入口 + 版本号。
 *
 * ── 2026-11-07 结构 B（用户定稿）────────────────────────────
 * 用户原话："我的区那个主页也要改，因为它下面不是卡片的…里面有的很乱，
 *           不在一块儿。可以不弄 5 个，给他多分一点。先给图吧。"
 * 看了 `design/me-hub.html` 之后他选了右版："可以就B吧"。
 *
 * 所以这一页从「5 行目录」变成「3 组 8 张纸卡」：
 *   他（1 张）        —— AI 概览：他是谁、能知道什么、记得你什么
 *   我的设置（6 张）  —— 账号与资料 / 外观 / 对话 / 主动与通知 / 语音 / 隐私与数据
 *   关于（1 张）      —— 关于与高级
 *
 * 原来挤在「模型与用量」「系统」两个大杂烩里的东西按主题拆开了：
 *   用量·上下文·自定义上游 → 关于与高级
 *   思考链·回复长短·分段·表情包 → 对话
 *   通知·主动找我 → 主动与通知
 *   天气定位·备份·权限 → 隐私与数据
 *   语音（560 行）→ 独立成页
 *
 * ⚠️ 2026-11-07 用户回头改了主意（m03042）：称呼**留在首页**，做成名字后面那颗符号，
 * 点头像换头像、点名字改名都在卡片里直接办；「账号与资料」页只剩「认识的日子」。
 * 理由是他原话："这几个完全都是小图标…咱们在我的那个首页那个大卡片里面就直接可以设置了，
 * 就不用单列出来，这就是繁琐之一。"
 */

type Entry = { to: string; label: string; hint: string; icon: LucideIcon };

/**
 * 称呼轮换表：首页名字后面那颗符号，点一下换一个（不说 → 用「她」→ 用「他」）。
 *
 * 用户 m03042："点头像咱们就换头像，然后点名字那咱们就换名字，然后名字后面
 * 跟着一个性别的那个符号就行" —— 所以称呼不再单独排一行按钮，也不再单独占一页的位置。
 */
const GENDER_CYCLE = [
  { value: "", symbol: "·", hint: "不说" },
  { value: "女", symbol: "♀", hint: "用「她」" },
  { value: "男", symbol: "♂", hint: "用「他」" },
] as const;

/** 三组入口。分组名和顺序就是用户在图里拍下来的那一版，别随手调。 */
const GROUPS: { title: string; entries: Entry[] }[] = [
  {
    title: "他",
    entries: [
      {
        to: "/core",
        label: "AI 概览",
        hint: "他是谁 · 能知道什么 · 记得你什么",
        icon: Sparkles,
      },
    ],
  },
  {
    title: "我的设置",
    entries: [
      {
        to: "/profile",
        label: "账号与资料",
        hint: "认识的日子",
        icon: UserRound,
      },
      { to: "/space", label: "外观", hint: "材质 · 纸色 · 字体 · 背景", icon: Palette },
      {
        to: "/chat-settings",
        label: "对话",
        hint: "思考过程 · 回复长短 · 分段 · 表情包",
        icon: MessageCircle,
      },
      {
        to: "/notify",
        label: "主动与通知",
        hint: "多久找你 · 半夜静音 · 写在日记里",
        icon: Bell,
      },
      { to: "/voice-settings", label: "语音", hint: "声音 · 语速 · 朗读 · 转文字", icon: Mic },
      {
        to: "/privacy",
        label: "隐私与数据",
        hint: "定位 · 记忆 · 备份与导出",
        icon: ShieldCheck,
      },
    ],
  },
  {
    title: "关于",
    entries: [
      {
        to: "/about",
        label: "关于与高级",
        hint: "版本 · 自定义上游 · 用量与诊断",
        icon: Settings2,
      },
    ],
  },
];

/**
 * 「我的」首页。
 *
 * 结构改动只动了「下面那一半」（目录 → 分组卡）；上半部分的
 * 「封面收进导航栏」连续塌陷动画一行没动，参数只收窄了卡片高度。
 */
export function MeHub() {
  const patch = useApp((s) => s.patchSettings);
  const settings = useApp((s) => s.settings);
  const scrollRef = useScrollMemory("me");
  /** 称呼在轮换表里的位置（空的/认不出来的都算第 0 个「不说」） */
  const genderIndex = Math.max(
    0,
    GENDER_CYCLE.findIndex((g) => g.value === (settings.userGender ?? "")),
  );

  /*
   * 「封面收进导航栏」——用户 m14888 的原话：
   *   "这个顶边栏效果我想的是把那个组件做成变化效果的，就是我上滑，整个头像组件滑动缩小到左边，
   *    而不是还保留着那一大块组件，然后再另做一个缩小组件。"
   * 所以这里不是"大卡 + 另做一个小条"两套组件，而是**同一个头像、同一个名字**连续变过去：
   *   卡片高度 → 46、头像 72 → 28 并左移、名字跟着缩到头像右边、卡片底淡出，
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
  const titleRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  /** 滚到底所需的总可滚量：内容贴住「顶栏底边 + GAP」时刚好用完（挂载时实测） */
  const needRef = useRef(0);

  /*
   * 卡片尺寸（2026-11-07 换 A 藏书票之后重算，见 design/identity-card.html）：
   *   头像 72 → 104（结构 B 那轮缩过头，用户 m04868："怎么变这么小"）
   *   高度 210 → 204：卡片里只剩头像 + 名字，提示行挪到卡片外面（用户："卡片里只留身份信息"）
   *   名字槽位 220 → 240：字号跟上头像之后要留够位置
   */
  const HEAD_H = 204; // 展开时卡片的高度（塌陷行程 = 204-46 = 158px）
  const BAR_H = 46; // 收进顶栏后的高度
  const AV0 = 104; // 头像展开尺寸
  const AV1 = 28; // 头像收起尺寸
  const NAME_W = 240; // 名字槽位宽度（居中时靠它算落点）
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
      // 起点 34 = 卡片内边距 22 + 右上角小字让出的位移（A 版样张量的）
      const y = Math.min(lerp(34, (BAR_H - AV1) / 2, e), Math.max(headH - AV0 * scale - 4, 0));
      avRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
    if (nameRef.current) {
      const x = lerp((W - NAME_W) / 2, 16 + AV1 + 8, e);
      // 起点 154 = 头像 34 + 104 之后 16px 的间距
      const y = Math.min(lerp(154, BAR_H / 2 - 15, e), Math.max(headH - 26, 0));
      nameRef.current.style.transform = `translate(${x}px, ${y}px) scale(${lerp(1, 0.58, e)})`;
      if (nameInputRef.current) nameInputRef.current.style.textAlign = e > 0.5 ? "left" : "center";
    }
    const fade = String(1 - clamp01(p / 0.34));
    if (fadeRef.current) {
      fadeRef.current.style.opacity = fade;
      /*
       * 外层已经是 pointer-events: none，这里必须写 `auto` 才会重新可点 ——
       * 写 ""（移除内联样式）只会继承外层的 none。
       */
      fadeRef.current.style.pointerEvents = p > 0.34 ? "none" : "auto";
    }
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
   *   · 只补到「行程」(164px) → 内容短，滚到底时内容还没贴上来，中间空一大片；
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
      {/* 标题：滚动时先淡出，把位置让给资料卡。
          液态下左上角有全局返回钮（`.lq-back`），这块要往右让一格 ——
          让位规则写在 glass.css 的 `.lq-skin[data-lq-back="true"] .me-title`，
          纯色下没有返回钮、`.me-title` 也没有任何样式，等于不存在（用户第 7 条 / 图一）。 */}
      <div ref={titleRef} className="me-title px-5 inset-top-100 pb-1">
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
        可滚量由底部 spacer 补足，spacer 高度在挂载时实测（见上面那个 effect）。
      */}
      {/*
        ⚠️ 2026-10-30 用户报「AI 概览缩小时下面那些功能点不进去」：
        这一层是 HEAD_H 高的布局占位，收起后它的**透明区域**仍然盖在内容上面（z-20），
        以前整层默认可点，于是把下面的入口全挡住了。
        现在整层 pointer-events: none，只有真正要点的元素（头像、名字输入框）
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
          {/*
              卡片外壳走共用组件（跟「AI 概览」主卡同一套 A 版藏书票）：
              1px 墨框 + 内圈细线 + 右上 EX LIBRIS 角标 + 头像那圈虚线。
              头像和名字仍然由本页传给组件（换头像、改名字的逻辑原样不动），
              塌陷动画也仍然由上面的 onScroll 写 transform 驱动。
            */}
          <IdentityCard
            refs={{ card: cardRef, bar: barRef, avatar: avRef, name: nameRef, copy: fadeRef }}
            avatarSize={AV0}
            nameWidth={NAME_W}
            avatar={
              <FileButton
                ariaLabel="更换我的头像"
                accept="image/*"
                className="flex size-full items-center justify-center rounded-full"
                onPick={(files) => {
                  const file = files[0];
                  if (file) readImageFile(file, (url) => patch({ userAvatar: url }));
                }}
              >
                <Avatar role="user" size={AV0} />
              </FileButton>
            }
            name={
              <input
                ref={nameInputRef}
                value={settings.displayName}
                onChange={(e) => patch({ displayName: e.target.value.slice(0, 24) })}
                placeholder="你的名字"
                aria-label="显示名"
                maxLength={24}
                /* size 跟着字数走：宽度收在文字上，称呼符号才贴得住名字 */
                size={Math.min(24, Math.max(2, (settings.displayName || "你的名字").length))}
                className="min-w-0 bg-transparent text-center font-serif text-2xl outline-none placeholder:text-subtle"
              />
            }
            gender={
              /*
               * 称呼就在名字后面那颗符号上（用户 m03042："名字后面跟着一个性别的那个符号就行"）。
               * 点一下轮换：不说 → 用「她」→ 用「他」→ 不说。
               * 位置由 `.k-idcard__gender` 绝对定位到名字右边 8px 外，**不参与居中**。
               */
              <button
                type="button"
                className="k-gender"
                data-on={settings.userGender ? "true" : undefined}
                aria-label={`他怎么称呼你：${GENDER_CYCLE[genderIndex].hint}（点一下换下一个）`}
                title={GENDER_CYCLE[genderIndex].hint}
                onClick={() =>
                  patch({
                    userGender: GENDER_CYCLE[(genderIndex + 1) % GENDER_CYCLE.length].value,
                  })
                }
              >
                {GENDER_CYCLE[genderIndex].symbol}
              </button>
            }
          />
        </div>
      </div>

      {/* 提示行挪到卡片外面（用户 m04868：卡片里只留身份信息） */}
      <p className="mt-2 px-5 text-center text-[11px] text-subtle">
        {settings.userAvatar ? "点头像可以换一张" : "点头像上传一张"} · 点名字可以改 ·
        名字后面那颗是称呼
      </p>

      {/*
        三组入口（结构 B）：
          · 每张卡就是标准件的 `.k-row`（和工具页同一套：同样的边框、圆角、软纸影、按下位移）
          · 左上角 `.k-tile` 是 32×32 的淡墨块装图标，不给每张卡配不同颜色
          · 分组小标题 `.k-sect` 右边那个数字是这一组有几张，纯装饰但能帮人扫
      */}
      <div className="mt-5 flex flex-col gap-6 px-5">
        {GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <div className="k-sect">
              <p className="k-sect__title">{group.title}</p>
              <span className="k-sect__act">{String(group.entries.length).padStart(2, "0")}</span>
            </div>
            <nav className="flex flex-col gap-2" aria-label={group.title}>
              {group.entries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <Link key={entry.to} to={entry.to} className="k-row">
                    <span className="k-tile" aria-hidden="true">
                      <Icon strokeWidth={1.6} />
                    </span>
                    <span className="k-row__body">
                      <span className="k-row__title">{entry.label}</span>
                      <span className="k-row__meta">{entry.hint}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                  </Link>
                );
              })}
            </nav>
          </section>
        ))}
      </div>

      <div className="px-5 py-8 text-center text-[12px] text-subtle">
        栖岛 · 思考链保存在这台设备 · {BUILD_TAG}
      </div>
      {/* 占位：保证「卡片塌成顶栏」那 164px 真的滚得动，高度由上面那个 effect 按实际差量撑出来 */}
      <div ref={spacerRef} aria-hidden style={{ height: HEAD_H - BAR_H, flexShrink: 0 }} />
    </div>
  );
}
