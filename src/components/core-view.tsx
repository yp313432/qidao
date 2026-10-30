import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Sparkles } from "lucide-react";
import { FileButton } from "@/components/file-button";
import { readImageFile } from "@/lib/image-file";
import { PageHeader } from "@/components/page-header";
import { useApp } from "@/lib/store";
import { GROUPS, PERMISSIONS, permissionSummary } from "@/lib/permissions";
import { resolveAiName } from "@/lib/branding";

/**
 * 「AI 概览」—— 文档里的"大玻璃主卡"。
 *
 * AI核心说明第 3 节："AI概览：顶部大玻璃主卡。显示 AI 名称、头像、一句描述，
 * 以及'能感知多少项 / 正在使用多少项 / 待确认多少项'等概览。"
 *
 * 这一页基本**只读**：不提供任何开关，改权限去「感知权限」那一页。
 * 唯一的两个例外（用户 m14237："ai 的名字和头像挪到 ai 概览那里改"）：点头像换图、点名字改名。
 */
export function CoreView() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  /** 点名字才进编辑态：平时就是一行字，不占地方也不用一直显示输入框 */
  const [editingName, setEditingName] = useState(false);
  /*
   * 与「我的」同一套做法（用户 m14917："哎概览那块也记得同步"）：
   * 主卡里的**同一个头像、同一个名字**随滚动连续缩小并收到顶栏，不是主卡滚走 + 顶栏另做一个小标签。
   * 这个页面内容少、平时滚不动，所以进度按"实际可滚量"归一（见 onScroll），滚到底正好收完。
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const avRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  /** 滚到底所需的总可滚量：内容贴住「顶栏底边 + GAP」时刚好用完（挂载时实测） */
  const needRef = useRef(0);

  const HEAD_H = 352; // 主卡展开高度（行程 = 352-46 = 306px）
  const BAR_H = 46; // 收进顶栏后的高度
  const AV0 = 80;
  const AV1 = 24;
  const NAME_W = 220;
  /**
   * 收起后第一张卡与顶栏之间留的空隙（用户："距离可以没有重叠" —— 宁可留缝，不要压住）。
   * 这个值只在这里定义一次，need 计算和验收都以它为准。
   */
  const GAP = 8;
  const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const onScroll = (el: HTMLElement) => {
    const head = headRef.current;
    if (!head) return;
    /*
     * 两段式（跟「我的」同一套）：先让二级入口滑上来贴住主卡底，主卡再开始缩；
     * 两段加起来正好「滚到底 ⇔ 收成 46px 顶栏 且 内容贴着顶栏」。
     */
    const span = Math.max(1, HEAD_H - BAR_H);
    const dead = Math.max(0, needRef.current - span);
    const t = clamp01((el.scrollTop - dead) / span);
    // 同「我的」：必须 1:1，缓动会让主卡缩得比内容上移快，内容钻进卡片下面
    const e = t;
    const p = t;
    const W = head.clientWidth || 326;

    const headH = lerp(HEAD_H, BAR_H, e);
    head.style.height = `${headH}px`;
    if (cardRef.current) cardRef.current.style.opacity = String(1 - clamp01(p / 0.72));
    if (barRef.current) barRef.current.style.opacity = String(clamp01((p - 0.55) / 0.35));
    if (avRef.current) {
      const scale = lerp(1, AV1 / AV0, e);
      const x = lerp((W - AV0) / 2, 8, e);
      const y = Math.min(lerp(24, (BAR_H - AV1) / 2, e), Math.max(headH - AV0 * scale - 4, 0));
      avRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
    if (nameRef.current) {
      const x = lerp((W - NAME_W) / 2, 8 + AV1 + 8, e);
      const y = Math.min(lerp(150, BAR_H / 2 - 15, e), Math.max(headH - 26, 0));
      nameRef.current.style.transform = `translate(${x}px, ${y}px) scale(${lerp(1, 0.62, e)})`;
      const el2 = nameRef.current.firstElementChild as HTMLElement | null;
      if (el2) el2.style.textAlign = e > 0.5 ? "left" : "center";
    }
    const fade = String(1 - clamp01(p / 0.34));
    if (fadeRef.current) {
      fadeRef.current.style.opacity = fade;
      fadeRef.current.style.pointerEvents = p > 0.34 ? "none" : "";
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) onScroll(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 补足可滚量（与「我的」同一套）：让「滚到底」= 主卡收成 46px 顶栏、
   * 二级入口停在顶栏底边下方 GAP 像素处。
   *
   * 这一页内容更少，只补「行程」的话滚到底内容还没贴上来，中间会空一大片。
   * 目标带 GAP 的理由同「我的」：零间距时收起后第一张卡紧贴玻璃条，看着像压住了；
   * 用户明确说"距离可以没有重叠"。本页的滚动区在 PageHeader 下面，sticky 的 top 就是 0，
   * 所以这里不用补偿吸顶偏移 / 状态栏（那两项在「我的」里要算）。
   */
  useEffect(() => {
    const el = scrollRef.current;
    const sp = spacerRef.current;
    if (!el || !sp) return;
    const pad = () => {
      // 第一个内容块（「往下看」那组）距滚动内容顶部的距离
      const content = headRef.current?.parentElement?.nextElementSibling as HTMLElement | null;
      const offset = content
        ? content.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
        : HEAD_H;
      const need = Math.max(HEAD_H - BAR_H, offset - (BAR_H + GAP));
      needRef.current = need;
      // 增量补（同「我的」）：内容比容器短时 scrollHeight 会被夹成 clientHeight，不能先归零量差值
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
    // HEAD_H / BAR_H 是常量，onScroll 是每帧用的纯函数，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [draftName, setDraftName] = useState("");
  const permissions = useApp((s) => s.settings.permissions);
  const memories = useApp((s) => s.memories);
  const aiName = resolveAiName(settings.aiName);

  // 跟权限页用**同一个**统计函数，免得两处数字对不上
  const { allow, ask, deny } = permissionSummary(permissions);
  const activeMemories = memories.filter((m) => m.status === "active").length;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader title="AI 概览" />

      <div
        ref={scrollRef}
        onScroll={(e) => onScroll(e.currentTarget)}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-24"
        /* 同「我的」：头块滚动中变矮，关掉滚动锚定，否则 scrollTop 会被浏览器改回去 */
        style={{ overflowAnchor: "none" }}
      >
        {/* 主卡：他现在的样子 —— 会随滚动塌成顶栏（同一个头像、同一个名字） */}
        {/*
          外层固定 HEAD_H 布局占位、内层只改视觉高度（跟「我的」同一套定稿）：
          内容位置只由 scrollTop 决定，滚到底正好落在顶栏底边 + GAP 处，
          既不会中间留空，也不会被主卡自身的缩小顶飞。可滚量由底部 spacer 补足。

          ⚠️ pointer-events-none：收起后这一层的透明区域仍然盖在「往下看」入口上面（z-20），
          以前它把点击全挡了（用户："AI 概览缩小时下面那些功能点不进去"）。
          整层不吃点击，只有头像 / 名字按钮加 pointer-events-auto 顶回来。
          不能改小 height 来躲：外层高度是内容位置与 1:1 映射的基准。
        */}
        <div
          className="pointer-events-none sticky z-20 shrink-0"
          data-surface
          style={{ height: HEAD_H, top: 0 }}
        >
          <div
            ref={headRef}
            className="absolute inset-x-0 top-0 overflow-hidden rounded-3xl"
            style={{ height: HEAD_H }}
          >
          <div ref={cardRef} className="absolute inset-0 rounded-3xl border border-line bg-elevated" />
          <div
            ref={barRef}
            className="absolute inset-x-0 top-0 h-[46px] rounded-3xl"
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
            <FileButton
              ariaLabel="更换 AI 头像"
              accept="image/*"
              className="flex size-full items-center justify-center overflow-hidden rounded-full bg-chip"
              onPick={(files) => {
                const file = files[0];
                if (file) readImageFile(file, (url) => patch({ aiAvatar: url }));
              }}
            >
              {settings.aiAvatar ? (
                <img src={settings.aiAvatar} alt={aiName} className="size-full object-cover" />
              ) : (
                <Sparkles className="size-7 text-accent" />
              )}
            </FileButton>
          </span>
          <span
            ref={nameRef}
            /* 同上：点名字要能进编辑态，得单独顶回可点击 */
            className="pointer-events-auto absolute left-0 top-0 block"
            style={{ width: NAME_W, transformOrigin: "0 0" }}
          >
            {editingName ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value.slice(0, 12))}
                onBlur={() => {
                  patch({ aiName: draftName.trim() });
                  setEditingName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    patch({ aiName: draftName.trim() });
                    setEditingName(false);
                  }
                  if (e.key === "Escape") setEditingName(false);
                }}
                maxLength={12}
                aria-label="AI 名字"
                placeholder={aiName}
                className="w-full bg-transparent text-center font-serif text-xl outline-none placeholder:text-subtle"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraftName(settings.aiName ?? "");
                  setEditingName(true);
                }}
                aria-label="改 AI 的名字"
                className="w-full text-center font-serif text-xl"
              >
                {aiName}
              </button>
            )}
          </span>
          <div ref={fadeRef} className="absolute inset-x-0" style={{ top: 190 }}>
            <p className="text-center text-[12px] leading-5 text-muted">
              在 {settings.displayName || "你"} 的这个小世界里，陪你说话的那个
            </p>
            <div className="mt-4 flex items-center justify-center gap-5">
              <div>
                <p className="font-serif text-2xl">{allow}</p>
                <p className="mt-0.5 text-[11px] text-subtle">允许</p>
              </div>
              <div>
                <p className="font-serif text-2xl text-warn">{ask}</p>
                <p className="mt-0.5 text-[11px] text-subtle">需询问</p>
              </div>
              <div>
                <p className="font-serif text-2xl text-muted">{deny}</p>
                <p className="mt-0.5 text-[11px] text-subtle">已拒绝</p>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-subtle">
              他现在记得 {activeMemories} 条关于你的事
            </p>
          </div>
        </div>
        </div>

        {/* 二级入口：跟「我的 → AI 核心」一致 */}
        <section className="mt-5">
          <h2 className="mb-2 px-1 text-[12px] tracking-wide text-muted">往下看</h2>
          <div className="space-y-2">
            {[
              { to: "/permissions", label: "感知权限", hint: `${PERMISSIONS.length} 项能力，按 ${GROUPS.length} 组收着` },
              { to: "/worldbook", label: "怎么和你相处", hint: "给他的规矩 · 说话风格 · 思考引导" },
              { to: "/memories", label: "他记得你什么", hint: "记忆库：列表 + 关系图" },
            ].map((it) => (
              <Link
                key={it.to}
                to={it.to}
                className="flex items-center justify-between gap-3 rounded-2xl bg-chip px-3.5 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{it.label}</span>
                  <span className="mt-0.5 block text-[11px] text-subtle">{it.hint}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </Link>
            ))}
          </div>
        </section>

        <p className="mt-6 px-1 text-[11px] leading-5 text-subtle">
          点名字能改、点头像能换；其他设置点上面那三项进去改。
        </p>
        {/* 占位：保证「主卡塌成顶栏」那 306px 真的滚得动，高度由上面那个 effect 按实际差量撑出来 */}
        <div ref={spacerRef} aria-hidden style={{ height: HEAD_H - BAR_H, flexShrink: 0 }} />
      </div>
    </div>
  );
}
