import { createFileRoute } from "@tanstack/react-router";
import { GamesView } from "@/components/play/games-view";

/**
 * 「小游戏」分区首页。
 *
 * 用户："把五子棋放到真心话那里，他们俩做成一个分区叫小游戏，
 *       点进去有这两个游戏，后续我还要加小游戏类型的。"
 */
export const Route = createFileRoute("/_app/play/games/")({
  component: GamesView,
});
