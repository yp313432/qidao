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
 * ⚠️ 2026-10 更正一处**过期注释**（原来这里写着"android/ 不在仓库里、
 *    只能靠 CI 打补丁"，那是错的，会把人带沟里）：
 *
 *   · `android/` **在本仓库里**，`MainActivity.java` 等 55 个文件都被 git 跟踪
 *   · CI（.github/workflows/android.yml）跑的是 `npx cap sync android`，
 *     也就是**同步插件配置、不会覆盖我们改过的源码文件**
 *     （`cap add` 才会重新生成整个工程 —— 所以不能用 `cap add`）
 *
 *   所以想在安卓层彻底关掉缩放，**本地就能做**，在
 *   `android/app/src/main/java/com/yanping/qidao/MainActivity.java` 里加：
 *
 *       WebSettings settings = getBridge().getWebView().getSettings();
 *       settings.setBuiltInZoomControls(false);
 *       settings.setSupportZoom(false);
 *       settings.setDisplayZoomControls(false);
 *
 *   目前 viewport 那一层实测够用，所以还没动这段 Java —— 但**不是做不到**。
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
  plugins: {
    /**
     * **后台唤醒**（`public/runners/wake.js`）—— 让 App 关着时也能"自己醒过来"。
     *
     * 为什么需要：定时任务原来靠**页面里每 30 秒查一次**，而安卓一切后台就冻结
     * 网页的定时器 → App 一关就什么都不会发生。用户原话：
     *   "那个定时任务还是只有点开 app 才可以发消息，即使我后台一直开着"
     *   "我们现在已经是一个 app 了，不要再留网页的设计思路了"
     *
     * 这条路是**原生**的：系统叫醒一段跑在 webview 外面的 JS（走 WorkManager），
     * 它能联网、能弹真通知 —— 所以以后可以在后台直接问 AI"现在该说什么"。
     * 时机是「App 切到后台」那一刻排上队（见插件安卓侧的 `handleOnPause`）。
     *
     * ── 现在的配置：**正式形态** ────────────────────────────────────
     *   `repeat: true` + `interval: 15` = 每 15 分钟叫醒一次（安卓对**循环**任务的硬下限）。
     *   叫醒 ≠ 打扰：醒来只是去问一句 Worker"现在要不要说话"，而 Worker 那边有两道便宜闸门
     *   （夜间不打扰 + 用户设的最短间隔，默认 60 分钟），不合格就直接让他继续睡、**不调 AI**。
     *   所以通知是他真的想说话时才出现，不是每 15 分钟响一次。
     *   （中途为了快速验证机制，短暂用过 `repeat: false` + `interval: 1`：一次性、1 分钟，
     *     把验证时间从 15 分钟压到 1 分钟。机制验通之后就换回来了。）
     */
    BackgroundRunner: {
      label: "com.yanping.qidao.wake",
      src: "runners/wake.js",
      event: "qidaoWake",
      repeat: true,
      interval: 15,
      autoStart: true,
    },
  },
};

export default config;
