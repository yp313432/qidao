import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * 「系统」这页在结构 B（2026-11，用户 m03042）之后就不存在了 ——
 * 它的五组（聊天 / 通知 / 语音 / 天气定位 / 开发与纠错）分别搬进了
 * /chat-settings、/notify、/voice-settings、/privacy、/about。
 *
 * 路由不能直接删：AI 的界面动作、旧链接都可能还指过来，删了就是白屏。
 * 所以留一个转场，老的 /system 直接送去「关于与高级」。
 * （用户 m04469 第 4 条：从环境自检退出来先闪了一下这张下线的「系统」页。）
 */
export const Route = createFileRoute("/_app/system")({
  beforeLoad: () => {
    throw redirect({ to: "/about", replace: true });
  },
});
