/**
 * 纸世界 Step5 · 导航四枚铜版画票图（qidao-docs/选样卡-导航-v2.html 手绘 ETCH 路径搬运）。
 *
 * 信封＝对话、钥匙＝工具、蝴蝶＝玩乐、双框章「我」＝我的 —— 笔法与刊头垂枝一套。
 * 只在纯色材质（solidPaper）分支渲染；液态玻璃继续用 lucide 图标，一字不碰。
 * 拉丁小注按落地清单口径塞进原 label 行（nav 高度不变）。
 */

/** 信封（对话）：封身 + V 形封口 + 底部一道淡折线。 */
function NavEnv() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="6.5" width="17" height="12" rx="1" />
      <path d="M4.5 7.5 L12 12.8 L19.5 7.5" />
      <path d="M9.2 18.2 L15.2 14.2" strokeOpacity={0.4} />
    </svg>
  );
}

/** 钥匙（工具）：双环头 + 柄 + 两齿。 */
function NavKey() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8.5" cy="8.5" r="3.6" />
      <circle cx="8.5" cy="8.5" r="1.1" />
      <path d="M11 11 L19.5 19.5" />
      <path d="M16.5 19.5 L19 17" />
      <path d="M14.6 17.6 L17.1 15.1" />
    </svg>
  );
}

/** 双框章「我」（我的）：外框 + 内淡框 + 中字，整体微斜。 */
function NavSeal() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      aria-hidden="true"
    >
      <rect x="5" y="5" width="14" height="14" rx="1" transform="rotate(-8 12 12)" />
      <rect x="7.2" y="7.2" width="9.6" height="9.6" rx="0.5" transform="rotate(-8 12 12)" strokeOpacity={0.5} />
      <text
        x="12"
        y="15.4"
        textAnchor="middle"
        fontSize="7.5"
        style={{ fontFamily: "var(--font-serif)" }}
        fill="currentColor"
        stroke="none"
        transform="rotate(-8 12 12)"
      >
        我
      </text>
    </svg>
  );
}

/** 传 tab.to（"/" "/tools" "/me"），渲染对应票图。（`/play` 这张票 2026-11-18 随玩乐区一起删了） */
export function NavEtch({ name }: { name: string }) {
  switch (name) {
    case "/":
      return <NavEnv />;
    case "/tools":
      return <NavKey />;
    case "/me":
      return <NavSeal />;
    default:
      return null;
  }
}
