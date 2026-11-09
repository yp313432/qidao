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

/** 蝴蝶（玩乐）：四翼两触角 + 翅点。 */
function NavFly() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 11.5 C9.5 6.5 4.5 5 3.6 8.4 C3 10.8 6.8 12.6 12 11.5" />
      <path d="M12 11.5 C14.5 6.5 19.5 5 20.4 8.4 C21 10.8 17.2 12.6 12 11.5" />
      <path d="M12 12.5 C10 14.2 6.5 14.9 6.3 17.2 C6.2 19 9 18.6 12 13.8" />
      <path d="M12 12.5 C14 14.2 17.5 14.9 17.7 17.2 C17.8 19 15 18.6 12 13.8" />
      <path d="M12 11 C11.6 9.6 11 8.6 10 7.7" />
      <path d="M12 11 C12.4 9.6 13 8.6 14 7.7" />
      <circle cx="7.6" cy="9.3" r={0.9} fill="currentColor" stroke="none" fillOpacity={0.55} />
      <circle cx="16.4" cy="9.3" r={0.9} fill="currentColor" stroke="none" fillOpacity={0.55} />
      <circle cx="8.7" cy="15.9" r={0.7} fill="currentColor" stroke="none" fillOpacity={0.45} />
      <circle cx="15.3" cy="15.9" r={0.7} fill="currentColor" stroke="none" fillOpacity={0.45} />
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

/** 传 tab.to（"/" "/tools" "/play" "/me"），渲染对应票图。 */
export function NavEtch({ name }: { name: string }) {
  switch (name) {
    case "/":
      return <NavEnv />;
    case "/tools":
      return <NavKey />;
    case "/play":
      return <NavFly />;
    case "/me":
      return <NavSeal />;
    default:
      return null;
  }
}
