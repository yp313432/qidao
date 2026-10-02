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
