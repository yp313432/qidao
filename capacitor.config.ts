import type { CapacitorConfig } from "@capacitor/cli";

/**
 * 把栖岛打包成安卓 App。
 *
 * 关键点：
 *   · `webDir: "dist"` —— 指向「安卓目标」构建出来的纯静态产物
 *     （QIDAO_TARGET=android npm run build + scripts/copy-static.mjs）。
 *   · `androidScheme: "https"` —— WebView 的 origin 是 https://localhost，
 *     这对 localStorage / 加密 API / 服务运行都是最省事的选择。
 *   · 界面全部来自本地文件，所以**打开不需要网络**；
 *     只有跟模型对话那一下才出网（走 lib/chat-client 的直连模式）。
 *
 * ── 关于"双指还能放大"这件事（用户实测反馈过）────────────────────
 *
 * 用户："有时候双指一托放，界面放大了。咱们这个不是已经成了 APP 吗？
 *       为什么页面还会像网页一样放大？"
 *
 * 目前的处理：**在 viewport 里锁**（见 src/routes/__root.tsx）——
 * `maximum-scale=1, user-scalable=no`。这是能改到的唯一一层，
 * 而且实测有效。
 *
 * ⚠️ 说清楚做不到的部分，免得以后有人以为这里漏配了：
 *   Capacitor 的 `android` 配置**没有**关缩放的选项。
 *   真正彻底的做法要在安卓工程里改 WebSettings：
 *       settings.setBuiltInZoomControls(false)
 *       settings.setSupportZoom(false)
 *       settings.setDisplayZoomControls(false)
 *   但 `android/` 是 `npx cap add android` 生成的、**不在这个仓库里**
 *   （靠 GitHub Actions 现场生成），所以没法在这里落。
 *   如果以后发现 viewport 那一层在某些机型上还是挡不住，
 *   就得在 CI 里对生成出来的 MainActivity 打一个补丁。
 */
const config: CapacitorConfig = {
  appId: "com.yanping.qidao",
  appName: "栖岛",
  webDir: "dist",
  android: {
    // 界面是本地资源，允许 WebView 用文件协议加载（Capacitor 本地服务器）
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
