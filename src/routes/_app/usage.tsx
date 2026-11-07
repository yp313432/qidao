import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * 结构 B（2026-11）之后「模型与用量」不再单列一页：
 * 用量、上下文预算、上游都并进了「关于与高级」(/about)。
 * 老链接与 AI 的界面动作还指着 /usage，所以留个转场，别白屏。
 */
export const Route = createFileRoute("/_app/usage")({
  beforeLoad: () => {
    throw redirect({ to: "/about", replace: true });
  },
});
