import { MessageCircle, Puzzle, Sparkles, UserRound } from "lucide-react";

/**
 * 主导航的四个入口。
 *
 * 两处共用：底部漂浮导航（除对话页外）＋ 对话抽屉的底部。
 * 用户的要求："上面留对话列表，下面显示导航栏" —— 于是聊天页不再需要
 * 给漂浮导航留位置，消息区直接多出 76px。
 */
export const MAIN_TABS = [
  { to: "/", label: "对话", icon: MessageCircle },
  { to: "/tools", label: "工具", icon: Puzzle },
  { to: "/play", label: "玩乐", icon: Sparkles },
  { to: "/me", label: "我的", icon: UserRound },
] as const;
