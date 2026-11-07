import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * 结构 B（2026-11）之后「数据」不再单列一页：备份与恢复搬进了
 * 「隐私与数据」(/privacy)。老链接与 AI 的界面动作还指着 /data，
 * 所以留个转场，别白屏。
 */
export const Route = createFileRoute("/_app/data")({
  beforeLoad: () => {
    throw redirect({ to: "/privacy", replace: true });
  },
});
