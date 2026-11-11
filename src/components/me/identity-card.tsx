import type { ReactNode, RefObject } from "react";

/**
 * 身份卡外壳：「我的」封面 与「AI 概览」主卡**共用同一个组件**。
 *
 * ── 为什么抽出来（隔天就要用）──────────────────────────────
 * 用户 m04868："这个头像是不是不对，怎么变这么小，2名字在头像下面不居中，看着会显歪，
 *              然后就是两个卡片用一样的就行，因为是一类，但是它两也算是个展示吧，
 *              可以弄个好看点的样式吗，给图我看看"
 * 我出了 `design/identity-card.html` 三版（A 藏书票 / B 票签 / C 压印章），他选 A。
 *
 * ── 两个已知病根，这次一起修掉了 ────────────────────────────
 * 1) 头像被我缩过头：结构 B 那轮把封面高度从 300 压到 210，顺手把头像 80 改成 72，
 *    比例就散了。现在统一 104（收起 28，跟塌陷动画对得上）。
 * 2) 名字显歪：原来名字和称呼符号（♀/♂/·）在**同一个 flex 行**里，居中的是两者之和，
 *    一宽一窄就把名字拽偏了。现在符号绝对定位挂到名字右边，不占布局宽度 → 名字永远在正中。
 *
 * ── 这里只有结构与材质，没有业务逻辑 ────────────────────────
 * 头像怎么换（FileButton + readImageFile）、名字怎么编辑（「我的」是常驻 input，
 * 「AI 概览」是点一下才变 input）、称呼怎么轮换 —— 都由页面传进来，
 * 因为两页的交互本来就不同（用户 m03042 / m14237 定过的）。
 * 塌陷动画也仍然由页面驱动：三个槽位拿到 ref 后自己写 style.transform，
 * 这一层只提供起点和内圈那道细线。
 */
/** Keep scrolling rows out of the visible sticky header, including its gap. */
export function clearIdentityOverlap(head: HTMLElement, gap: number): void {
  const content = head.parentElement?.nextElementSibling;
  if (!(content instanceof HTMLElement)) return;
  const overlap = Math.ceil(head.getBoundingClientRect().bottom + gap - content.getBoundingClientRect().top);
  content.style.clipPath = overlap > 0 ? `inset(${overlap}px -24px -24px)` : "";
}

export type IdentityCardRefs = {
  /** 纸卡本身（塌陷时整块淡出） */
  card: RefObject<HTMLDivElement | null>;
  /** 收进顶栏后浮上来的那一条（塌陷时淡入） */
  bar: RefObject<HTMLDivElement | null>;
  /** 头像槽位 */
  avatar: RefObject<HTMLSpanElement | null>;
  /** 名字槽位 */
  name: RefObject<HTMLSpanElement | null>;
  /** 说明块（副标题 / 数据行 / 记得几条） */
  copy: RefObject<HTMLDivElement | null>;
};

type Props = {
  refs: IdentityCardRefs;
  /** 头像展开尺寸：页面按它算水平落点，必须和页面里的 AV0 一致 */
  avatarSize: number;
  /** 名字槽位宽度：页面按它算水平落点，必须和页面里的 NAME_W 一致 */
  nameWidth: number;
  /** 右上角那行小字 */
  mark?: string;
  /** 头像（页面自己包 FileButton / Avatar） */
  avatar: ReactNode;
  /** 名字（页面自己决定是 input 还是可点文字） */
  name: ReactNode;
  /** 名字后面那颗称呼符号（可选） */
  gender?: ReactNode;
  /** 副标题 / 数据行 / 脚注 */
  children?: ReactNode;
};

export function IdentityCard({
  refs,
  avatarSize,
  nameWidth,
  mark = "EX LIBRIS · 栖岛",
  avatar,
  name,
  gender,
  children,
}: Props) {
  return (
    <>
      <div ref={refs.card} className="k-idcard" />
      <div ref={refs.bar} className="k-idcard__bar" style={{ opacity: 0 }} />
      <p className="k-idcard__mark">{mark}</p>
      {/* 外层容器是 pointer-events: none（收起后不能挡住下面的入口），
          头像和名字要能点，各自顶回来 */}
      <span
        ref={refs.avatar}
        className="k-idcard__ava pointer-events-auto"
        style={{ width: avatarSize, height: avatarSize }}
      >
        {avatar}
      </span>
      <span
        ref={refs.name}
        className="k-idcard__name pointer-events-auto"
        style={{ width: nameWidth }}
      >
        <span className="k-idcard__namewrap">
          {name}
          {gender ? <span className="k-idcard__gender">{gender}</span> : null}
        </span>
      </span>
      <div ref={refs.copy} className="k-idcard__copy">
        {children}
      </div>
    </>
  );
}
