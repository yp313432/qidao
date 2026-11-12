"use client";

import { useState } from "react";

import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Bug,
  Flower2,
  Music,
  NotebookPen,
  Plus,
  Puzzle,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { DrawerCosmos, DrawerSky } from "@/components/chat/drawer-decor";
import { isSolid, materialOf } from "@/lib/material";
import { useApp } from "@/lib/store";
import { chatCrabSize } from "@/lib/chat-crab-settings";
import { cn } from "@/lib/utils";

/**
 * 对话抽屉（侧边栏）。
 *
 * 为什么单独成文件：chat-view.tsx 已经 2250 行，样式守卫的「最大部件」棘轮
 * 只许它变小 —— 这轮往里加功能必须先把它拆小。**这不是重写**：抽屉里的
 * 每一段逻辑、每一句文案、每一个按钮都还是原来那一份，只是搬了个家；
 * 纯色渲染路径一字节没动（`liquid` 为 false 时看到的还是旧抽屉）。
 *
 * 这轮（用户 13 条里的 3/4/8/9/10/11）：
 *   · 3 条 —— 螃蟹桌宠从抽屉底部挪到对话页（所以这里 `!liquid` 才画 DrawerCosmos）；
 *   · 4 条 —— 底栏左边头像，点进设置页（图一）；
 *   · 8 条 —— 底栏右边「+ 新建对话」，与头像相对；顶部那颗「新对话」液态下删掉；
 *   · 9 条 —— 分界以下的功能八条直接排在这张列表界面里（不另套一层），细长玻璃条；
 *   · 10 条 —— 对话条目也走图一的玻璃参数（`.lq-conv`）；
 *   · 11 条 —— 液态下 portal 到 body：折角是给聊天页根节点加 transform 做的，
 *     抽屉若还留在那棵树里会被一起转、fixed 也会退化成 absolute。
 */
export function ChatDrawer({
  open,
  onClose,
  rowMenu,
  setRowMenu,
  onCrabReplay,
}: {
  open: boolean;
  onCrabReplay: () => void;
  onClose: () => void;
  rowMenu: string | null;
  setRowMenu: (id: string | null) => void;
}) {
  const navigate = useNavigate();
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeId);
  const settings = useApp((s) => s.settings);

  const [showCrab, setShowCrab] = useState(false);
  const pet = { enabled: true, activity: "lively" as const, ...settings.chatCrab,
    size: chatCrabSize(settings.chatCrab?.size) };
  const savePet = (patch: Partial<typeof pet>) => {
    useApp.getState().patchSettings({ chatCrab: { ...pet, ...patch } });
  };
  const liquid = materialOf(settings) === "liquid";
  const solidPaper = isSolid(settings);

  /*
    第 9 条：侧边栏下半的**功能八条**（用户定的顺序：工具／动态／岁序／音乐／学习／花园／插件／桌宠）。
    形状照定稿：通栏细长条（左图标 + 右文字、13px 圆角）。
    桌宠在抽屉内切换到设置。
  */
  const drawerFuncs: { label: string; Icon: LucideIcon; go: (() => void) | null }[] = [
    { label: "工具", Icon: Wrench, go: () => void navigate({ to: "/tools" }) },
    { label: "动态", Icon: Sparkles, go: () => void navigate({ to: "/play/space" }) },
    // m03003 第 5 条：原来「岁序」直接跳 /play/days（只有「重要日子」一个三级页），
    // 用户说"原来小日子有 4 个二级入口，那些二级页没了，要补回来"。
    // 所以回到 /play/tools 这一层（小日子 → 重要日子 / 待办 / 闹钟 / 定时任务），
    // 那页标题也跟着改成「岁序」，卡片换成玻璃（见 tools-view.tsx）。
    { label: "岁序", Icon: NotebookPen, go: () => void navigate({ to: "/play/tools" }) },
    { label: "音乐", Icon: Music, go: () => void navigate({ to: "/play/listen" }) },
    { label: "学习", Icon: BookOpen, go: () => void navigate({ to: "/play/learn" }) },
    { label: "花园", Icon: Flower2, go: () => void navigate({ to: "/play/garden" }) },
    { label: "插件", Icon: Puzzle, go: () => void navigate({ to: "/play/plugins" }) },
    { label: "桌宠", Icon: Bug, go: null },
  ];

  if (!open) return null;

  return createPortal(
    /*
      抽屉 z-50。底部导航 z-[60] 比它高，但抽屉打开时**要把导航收起来** ——
      用户反馈："展开对话列表，导航栏就不留了吧，看看这怪怪的"
      （导航横在抽屉下沿，抽屉的圆角跟它叠在一起确实别扭）。
      做法：在 <html> 上挂 data-drawer-open，由 CSS 把导航藏掉。
      这样不用把 menu 状态提到 AppShell，也不用每帧重渲染。
    */
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="关闭"
        /* 用户 m01199（实机）："点开侧边栏全糊成一团" —— 液态那层 20% 的遮罩压不住
           底下的聊天文字，透上来跟功能条叠在一起。液态换更深的遮罩（样式在 glass.css）。 */
        className={cn("absolute inset-0", liquid ? "lq-sheet-scrim" : "bg-fg/20")}
        onClick={onClose}
      />
      <aside
        className={cn(
          "relative z-10 flex h-full w-[84%] max-w-sm flex-col inset-top-75",
          liquid
            ? /* 用户 m01709："就是一整块是玻璃的…那里面可以加一点磨砂，以防止看不清。"
                 磨砂必须写在 TSX 的 Tailwind 类上 —— 样式守卫禁止 liquid CSS 出现
                 backdrop-filter 字样，所以真模糊只能从这里给。 */
              "lq-sheet-scope lq-sheet backdrop-blur-2xl"
            : cn(
                "glass-panel",
                /* 纸世界 Step3 补：纯色材质下抽屉换纸壳（用户 m00405 点名）。
                   星野装饰 DrawerSky 保留 —— 低对比丝线星点在纸底上不抢，先返图看效果。 */
                solidPaper && "paper-drawer",
              ),
        )}
      >
        {/* 上：整片星野铺在抽屉顶部（标题和按钮浮在它上面）。
            用户："上面那个从顶部开始，不是从我画的框开始"

            第 11 条（2026-11 实机）：**液态下不画这片星野**。
            用户 m01354 反馈"一会看得到、一会看不到、碎片" —— 抽屉里再压一层
            大面积的装饰图（星野是整块渐变 + 粒子），安卓 WebView 的合成层更容易掉。
            先让面板干净（纸底 + 标题 + 列表 + 功能 + 底栏），星星等稳定了再加回来。 */}
        {!liquid && <DrawerSky />}

        <div className="relative z-10 flex items-center justify-between px-4 pb-3">
          {/* m02943 第 4 条①：「对话」两个字改成**小字分组标题**（不再是 text-lg 的大字），
              下面才是对话列表。纯色那一侧保持原样（用户没让动纯色）。 */}
          <p className={cn("font-serif text-lg", liquid && "lq-group-head lq-group-head--inline")}>
            对话
          </p>
          <button type="button" aria-label="关闭" onClick={onClose} className="size-10">
            <X className="size-5" />
          </button>
        </div>

        {/* 第 8 条：液态下「新对话」从顶部挪到底栏右侧（和头像相对），
            纯色保持原来这颗 —— 用户没让动纯色。 */}
        {!liquid && (
          <button
            type="button"
            className="relative z-10 mx-4 mb-1 flex items-center gap-2 rounded-full bg-chip px-4 py-3 text-sm font-medium"
            onClick={() => {
              useApp.getState().newChat();
              onClose();
            }}
          >
            <Plus className="size-4" />
            新对话
          </button>
        )}

        <ul
          className={cn(
            "relative z-10 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pt-1",
            /* 第 9 条：到分界处渐隐（mask 在 liquid/styles/glass.css）。 */
            liquid && "lq-conv-list",
          )}
        >
          {conversations.filter((c) => !c.incognito).length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted">还没有保存的对话</li>
          )}
          {conversations
            .filter((c) => !c.incognito)
            .slice()
            .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
            .map((c) => (
              <li key={c.id}>
                {/*
                  对话条目：用户反馈"这一整个大方块，改成柔和一点，带着边框，
                  上下留白一些，材质要统一"。
                  · 圆角从 rounded-full（整条胶囊，太"实"）收到 rounded-2xl
                  · 补一条 border-line 边框 —— 跟 App 里其它卡片同一套材质
                  · 左右内边距对称（原来左边 pl-6、右边 pr-1，文字被挤在左边）
                  · 上下用 space-y-2.5 留白，不再一条贴一条
                */}
                <div
                  className={cn(
                    // 底：透明，只留间距 —— 一整列都画框会让人分不清"哪条是现在这条"
                    // （用户 m04469 第 1 条：当前会话反而没框、没选中的有框，反了）。
                    // 选中态才给底色 + 边框；边框常驻但透明，避免切会话时行高跳一下。
                    "flex items-center gap-0.5 rounded-2xl border border-transparent py-1 pr-0.5 pl-3.5",
                    c.id === activeId && "border-line bg-chip",
                    /* 第 10 条：液态下这一列也走图一的玻璃参数（纯色下这个类没样式）。 */
                    liquid && "lq-conv",
                  )}
                  data-active={c.id === activeId ? "true" : undefined}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate py-3 text-left text-sm"
                    onClick={() => {
                      useApp.getState().setActive(c.id);
                      onClose();
                    }}
                  >
                    <span className="font-medium">{c.title}</span>
                    <span className="text-muted"></span>
                  </button>
                  {/*
                    **改名**（用户："对话列表可以重命名"）—— `chat.rename` 动作早就有、
                  {/* 第 3 条：三个内联按钮 → 一个 ⋯（点开才有 重命名/置顶/删除） */}
                  <button
                    type="button"
                    aria-label="更多"
                    className="size-9 shrink-0 text-[15px] leading-none text-muted"
                    onClick={() => setRowMenu(rowMenu === c.id ? null : c.id)}
                  >
                    ⋯
                  </button>
                </div>
              </li>
            ))}
        </ul>

        {/*
          下：小宇宙（带星环的行星 + 小卫星 + 碎钻粒子），跟上面的星月呼应。
          · 这里原来是给底部导航让位的留白（h-[4.5rem]）——
            但抽屉一打开导航就收走了，那段留白只是空着，显得像"大方块"，
            所以让装饰接管它
          · 用户："下面……不要有线，看着割裂" → 去掉那条分隔线
          · 第 3 条：液态下螃蟹已挪到对话页，这里只留纯色。
        */}
        {!liquid && <DrawerCosmos />}

        {/*
          第 9 条：液态下半区 —— 功能八条**直接排在列表界面里**（用户："不要新套一层"）。
          第 4 条：底栏左边头像 → 设置页（图一 /me）；
          第 8 条：底栏右边「+ 新建对话」，与头像相对。
        */}
        {liquid && (
          <>
            {/* m02943 第 4 条②：功能八条上面也加一个小字分组标题「功能」，
                跟上面「对话」一组同一个模子（小字 + 淡色 + 字距）。 */}
            <p className="lq-group-head lq-group-head--func">功能</p>
            <nav aria-label="功能" className="relative z-10 shrink-0 px-3 pt-1">
              {showCrab ? (
                <div className="flex flex-col gap-2 pb-2 text-sm">
                  <button type="button" className="lq-func__row" onClick={() => setShowCrab(false)}>‹ 桌宠</button>
                  <label className="flex items-center justify-between gap-2 px-2">
                    在聊天显示 <input type="checkbox" checked={pet.enabled}
                      onChange={(e) => savePet({ enabled: e.target.checked })} />
                  </label>
                  <label className="flex items-center justify-between gap-2 px-2">
                    大小 <select className="k-input" value={pet.size}
                      onChange={(e) => savePet({ size: Number(e.target.value) as typeof pet.size })}>
                      <option value={36}>小 · 36 × 27</option>
                      <option value={44}>中 · 44 × 33</option>
                      <option value={52}>大 · 52 × 39</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between gap-2 px-2">
                    活动量 <select className="k-input" value={pet.activity}
                      onChange={(e) => savePet({ activity: e.target.value === "quiet" ? "quiet" : "lively" })}>
                      <option value="lively">活泼</option>
                      <option value="quiet">安静</option>
                    </select>
                  </label>
                  <button type="button" className="lq-func__row" disabled={!pet.enabled}
                    onClick={() => { setShowCrab(false); onCrabReplay(); onClose(); }}>
                    <Bug className="lq-func__ico" strokeWidth={1.6} /> 回聊天看动作
                  </button>
                </div>
              ) : (
              drawerFuncs.map(({ label, Icon, go }) => (
                <button
                  key={label}
                  type="button"
                  className="lq-func__row"
                  onClick={() => {
                    if (!go) { setShowCrab(true); return; }
                    go();
                    onClose();
                  }}
                >
                  <Icon className="lq-func__ico" strokeWidth={1.6} />
                  <span>{label}</span>
                </button>
              ))
              )}
            </nav>
            <div className="lq-sheet-foot relative z-10 flex shrink-0 items-center justify-between gap-2 px-3">
              <button
                type="button"
                className="lq-me min-w-0"
                onClick={() => {
                  void navigate({ to: "/me" });
                  onClose();
                }}
              >
                <Avatar role="user" size={42} />
                <span className="min-w-0 truncate text-left text-sm">{settings.displayName}</span>
              </button>
              <button
                type="button"
                aria-label="新建对话"
                className="lq-new flex size-11 shrink-0 items-center justify-center rounded-full"
                onClick={() => {
                  useApp.getState().newChat();
                  onClose();
                }}
              >
                <Plus className="size-5" />
              </button>
            </div>
          </>
        )}
      </aside>
    </div>,
    document.body,
  );
}
