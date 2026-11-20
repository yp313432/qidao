"use client";

import { Avatar } from "@/components/shared/avatar";

/**
 * 空对话（新对话）的开场：AI 头像 + 一句按时间算出来的问候。
 *
 * 2026-11-18 用户 m01541：「空对话也放一个吧，就是这种意思，螃蟹是独立的，
 * 不跟对话界面有没有气泡绑定，如果聊天页面是一张纸，那么螃蟹是个独立于纸面上的」。
 *
 * 所以空态也要有一块**真的滚动区**当舞台——以前这段直接挂在 flex 列里、
 * 根本没有 `scroller`，`ChatCrab` 拿不到舞台就整只不显示。
 * 现在由 `chat-view.tsx` 把它塞进那个 `h-full overflow-y-auto` 的容器里，
 * 螃蟹就在这块空白上按 `pet-scene.ts` 的「空态落脚点」沿输入条上沿走动。
 */
export function EmptyChat({ greeting, incognito }: { greeting: string; incognito?: boolean }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6">
      <Avatar role="ai" size={48} />
      <h1 className="mt-6 font-serif text-[1.85rem] font-medium tracking-tight text-fg">
        {/* 问候语按「现在是几点」算 —— 服务端和客户端算出来可能不同
            （部署到 UTC 服务器时必然不同），所以挂载后再显示。 */}
        {greeting}
      </h1>
      {incognito && <p className="mt-2 text-sm text-muted">临时对话不会写入本地记录</p>}
    </div>
  );
}
