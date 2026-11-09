import { createFileRoute } from "@tanstack/react-router";
import { ChatView } from "@/components/chat/chat-view";

/**
 * 对话页：**两种材质共用同一份实现**。
 *
 * 用户 m09209 / m09221 的原话是判断标准：
 *   "UI 跟功能，它俩是绑定的一块，我只是把它俩打包挪了个地方，你懂吗？"
 *   "功能是不变的，UI 跟功能是对应的"
 *
 * 所以这里不再按材质分岔。早先液态另写了一套
 * `src/liquid/components/liquid-chat.tsx`（446 行精简版）—— 重写完就把纯色那套
 * 已有的东西丢了：气泡壳、分段（`|||` 会原样露出来）、键盘跟随、模型选择（写死
 * "小克·均衡"）、加号上传、表情包。用户装上后截图连问"你那对话框框去哪儿了？
 * 气泡呢？"（m09209）。那一版**已废弃、不再挂路由**，文件留着等液态外壳时再说。
 *
 * 液态与纯色的差别只在外壳（没有底部导航、二级页换玻璃、抽屉/设置入口的位置），
 * 对话页本体一份就够 —— 换皮走材质变量，不重写功能。
 */
export const Route = createFileRoute("/_app/")({
  component: ChatRoute,
});

function ChatRoute() {
  return <ChatView />;
}
