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

import { useState } from "react";
import { Lock, SlidersHorizontal } from "lucide-react";
import { KButton, KCard, KFold, KOpt, KOpts, KSlider } from "@/components/ui-kit";
import { resolveAiName } from "@/lib/branding";
import { isSolid, materialOf } from "@/lib/material";
import { useApp } from "@/lib/store";
import { CHAT_FONT_SIZES } from "@/lib/ux";
import { FONTS, TONES } from "./me-options";
import { ImageRow } from "./me-widgets";

/**
 * 材质两档：纯色 / 液态。半磨砂 2026-11 下线（用户 m06619）。
 * 液态的**长相**还在样张阶段（`qidao-liquid-glass.html` 定的是 A 配方：零模糊、极透），
 * 但开关必须先存在 —— 否则用户没法跳过去看。判断口径统一走 `src/lib/material.ts`。
 */
const MATERIALS = [
  { id: "solid", label: "纯色" },
  { id: "liquid", label: "液态" },
] as const;

const PALETTES = [
  { id: "cream", label: "奶油白", dot: "#f6f3ee" },
  { id: "blue", label: "雾蓝", dot: "#5b7f9e" },
  { id: "green", label: "苔绿", dot: "#6f8c6a" },
  { id: "pink", label: "淡粉", dot: "#c07f8c" },
] as const;

/**
 * 外观页。从 `me-sections.tsx` 整段搬出来，只为把那个文件的行数降回棘轮线以内；
 * 长相、行为、`patch(...)` 的字段名一个都没改。
 */
export function SpacePage() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const background = settings.background;
  /** 哪一组是展开的（null = 全收起，一屏能看完） */
  const [openFold, setOpenFold] = useState<
    null | "material" | "paper" | "bg" | "font" | "date"
  >(null);
  // 背景那几个滑杆默认锁住 —— 手机上滑页面太容易误改
  const [bgUnlocked, setBgUnlocked] = useState(false);

  const material = materialOf(settings);
  const materialName = MATERIALS.find((x) => x.id === material)?.label ?? "纯色";

  const palette = settings.palette ?? "cream";
  const palName = PALETTES.find((x) => x.id === palette)?.label ?? "奶油白";
  const bgCount = [background.image, settings.musicImage, settings.diaryImage].filter(
    Boolean,
  ).length;
  const bgHint = `${bgCount ? `${bgCount} 张都设了` : "还没设"} · 压纸色 ${settings.bgPaper ?? 18}%`;
  const fontHint = `${FONTS.find((f) => f.id === (settings.font ?? "system"))?.label ?? "默认"} · ${
    /* 默认档是 `normal`（标准 15px）。原来这里写的是 "md" —— 没有这个 id，
       所以「外观」页标题上那行永远显示「中号」，选了大号也不变（顺手修掉）。 */
    CHAT_FONT_SIZES.find((x) => x.id === (settings.chatFontSize ?? "normal"))?.label ?? "标准"
  }`;

  return (
    /* 左右留白由外壳 `MePage` 的 `.k-page` 统一给（用户 m04469 第 3 条），这里不再套一层 */
    <div className="k-list k-nav-space">
      <KFold
        title="材质"
        meta={materialName}
        open={openFold === "material"}
        onToggle={() => setOpenFold(openFold === "material" ? null : "material")}
      >
        <KOpts cols={2}>
          {MATERIALS.map((x) => (
            <KOpt
              key={x.id}
              active={material === x.id}
              onClick={() => patch({ material: x.id })}
            >
              {x.label}
            </KOpt>
          ))}
        </KOpts>
      </KFold>

      <KFold
        title="纸色"
        meta={palName}
        open={openFold === "paper"}
        onToggle={() => setOpenFold(openFold === "paper" ? null : "paper")}
      >
        <KOpts cols={2}>
          {PALETTES.map((x) => (
            <KOpt
              key={x.id}
              active={palette === x.id}
              dot={x.dot}
              onClick={() => patch({ palette: x.id })}
            >
              {x.label}
            </KOpt>
          ))}
        </KOpts>
      </KFold>

      <KFold
        title="字体"
        meta={fontHint}
        open={openFold === "font"}
        onToggle={() => setOpenFold(openFold === "font" ? null : "font")}
      >
        <p className="k-sect__title">正文字体</p>
        <KOpts cols={2}>
          {FONTS.map((f) => (
            <KOpt
              key={f.id}
              tall
              active={settings.font === f.id}
              sub={f.hint}
              style={{ fontFamily: f.stack }}
              onClick={() => patch({ font: f.id })}
            >
              {f.label}
            </KOpt>
          ))}
        </KOpts>

        {/* 「最大输出长度」+「回复风格」已经挪到「系统 → 思考链」（用户要求）。
          这里不能再留一份 —— 同一个开关出现两次，改哪边都容易漏。 */}
        <p className="k-sect__title">正文字号</p>
        <KOpts cols={4}>
          {CHAT_FONT_SIZES.map((s) => (
            <KOpt
              key={s.id}
              tall
              active={settings.chatFontSize === s.id}
              sub={`${s.px}px`}
              onClick={() => patch({ chatFontSize: s.id })}
            >
              {s.label}
            </KOpt>
          ))}
        </KOpts>

        <p className="k-sect__title">文字颜色</p>
        <KOpts cols="wrap">
          {TONES.map((t) => (
            <KOpt
              key={t.id}
              active={settings.textTone === t.id}
              onClick={() => patch({ textTone: t.id })}
            >
              {t.label}
            </KOpt>
          ))}
        </KOpts>
        {settings.textTone === "custom" && (
          <div className="k-hstack">
            <input
              type="color"
              value={settings.textColor}
              onChange={(e) => patch({ textColor: e.target.value })}
              className="k-color"
              aria-label="自定义文字颜色"
            />
            <span className="k-opt__sub">{settings.textColor}</span>
          </div>
        )}
      </KFold>

      <KFold
        title="背景"
        meta={bgHint}
        open={openFold === "bg"}
        onToggle={() => setOpenFold(openFold === "bg" ? null : "bg")}
      >
        {/* 三张图各管一处：主页是全局的底，另外两张只在自己那页出现 */}
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

        <p className="k-sect__title">动画</p>
        <div className="k-tabs">
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
              className="k-tab"
              data-active={settings.motion === id ? "true" : undefined}
              onClick={() => patch({ motion: id })}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="k-hstack">
          <span className="k-hint k-grow">
            {bgUnlocked ? "正在调整 —— 调完记得锁上" : "已锁定，滑动页面不会误改"}
          </span>
          <KButton
            variant={bgUnlocked ? "primary" : "default"}
            aria-label={bgUnlocked ? "锁定背景调整" : "解锁背景调整"}
            onClick={() => setBgUnlocked((v) => !v)}
          >
            {bgUnlocked ? <Lock /> : <SlidersHorizontal />}
            {bgUnlocked ? "锁定" : "调整"}
          </KButton>
        </div>

        <KSlider
          label="模糊"
          value={background.blur}
          min={0}
          max={60}
          step={1}
          unit="px"
          disabled={!bgUnlocked}
          onChange={(v) => patch({ background: { ...background, blur: v } })}
        />
        <KSlider
          label="暗化"
          value={background.dim}
          min={0}
          max={0.8}
          step={0.05}
          disabled={!bgUnlocked}
          onChange={(v) => patch({ background: { ...background, dim: v } })}
        />
        <KSlider
          label="透明度"
          value={background.opacity}
          min={0.2}
          max={1}
          step={0.05}
          disabled={!bgUnlocked}
          onChange={(v) => patch({ background: { ...background, opacity: v } })}
        />
        {/* 压纸色只在纯色模式下有意义（液态是极透，压了就糊）——
            材质判断走 lib/material.ts，别自己写 `settings.material === …` */}
        {isSolid(settings) && (
          <>
            <KSlider
              label="背景压纸色"
              value={settings.bgPaper ?? 18}
              min={0}
              max={40}
              step={2}
              unit="%"
              onChange={(v) => patch({ bgPaper: v })}
            />
          </>
        )}
      </KFold>

      {/* 认识的日子 —— 玩乐区首页那个「NNN DAYS TOGETHER」用它算天数。
        用户："可以来个组件，上面是两个的名字或头像，写着认识多久了"、
        "用户自己填日子"。填了才显示，没填就提示来这儿填，不编数字。
        （结构定案里它归「账号与资料」，那一页还没建，先留在这儿。） */}

      {/* 效果预览：不用跳去聊天页就能看气泡长什么样 */}
      <KCard>
        <div className="k-card__head">
          <span className="k-row__body">
            <span className="k-row__title">效果预览</span>
            <span className="k-row__meta">改上面任何一项，这块跟着变</span>
          </span>
        </div>
        <div className="k-card__body">
          <div className="k-msg" data-role="me">
            <div className="k-bubble">那你以后说话短点</div>
          </div>
          <div className="k-msg" data-role="ai">
            <div className="k-bubble">好，从这条开始。</div>
          </div>
          <div className="k-input k-hstack">
            <span className="k-hint">和{resolveAiName(settings.aiName)}聊聊…</span>
          </div>
        </div>
      </KCard>
    </div>
  );
}
