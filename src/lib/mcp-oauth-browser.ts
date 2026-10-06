import { isNativeApp } from "./platform";

/**
 * OAuth 里**唯一跟平台有关**的那部分：怎么把用户送去授权、怎么把他接回来。
 *
 * 协议本身（发现 / 动态注册 / PKCE / 换令牌）都在 `mcp-oauth.ts` 里，
 * 那份是两端共用的；这里只处理"浏览器这一跳"：
 *
 *   · **真机 App**：必须用**系统浏览器**（`@capacitor/browser`），
 *     回来靠**自定义 scheme 深链**（`qidao://oauth/callback`）+ `@capacitor/app`。
 *     为什么不能用 App 内的 WebView：
 *       ① 很多登录页（Google 那类）会**拒绝**被塞进 WebView；
 *          用户也不该在一个看不出来路的框里输密码（RFC 8252 就是为这个写的）
 *       ② App 里**没有本地服务端**，`https://localhost/oauth/callback`
 *          会落到 Chrome 自己身上，回不到 App
 *   · **网页版**：直接同源跳（`/oauth/callback` 那条路由自己收回调），
 *     规范上最干净（localhost / https 本来就是规范允许的形态）
 *
 * ⚠️ 插件都用**动态 import**（照 `lib/locate.ts` / `lib/notify.ts` 的写法）：
 * 这两个包只有真机里才有意义，别让它们进首屏包，也免得 SSR 时被求值。
 */

/**
 * 把用户送去授权页。
 * 真机 → 系统浏览器；网页 → 当前页跳转（回调由路由接）。
 */
export async function openAuthorizeUrl(url: string): Promise<void> {
  if (isNativeApp()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return;
  }
  window.location.assign(url);
}

/**
 * 订阅"授权完跳回来"这件事，返回取消订阅的函数。
 *
 * 网页版什么都不用做（回调会自然落到 `/oauth/callback` 路由），
 * 所以这里直接返回空函数 —— 调用方不用自己判断平台。
 */
export async function listenAuthCallback(
  handler: (url: string) => void,
): Promise<() => void> {
  if (!isNativeApp()) return () => {};

  const { App } = await import("@capacitor/app");

  /*
    冷启动这一路不能漏：App 被系统回收之后，用户从浏览器点回来是**重新冷启**的，
    这时候不会发 `appUrlOpen` 事件 —— 得主动问一次"你是被哪个链接唤起的"。
    （网页实现返回空 url，所以网页上这段是白做的，但无害。）
  */
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) handler(launch.url);
  } catch {
    /* 拿不到就算了，下面的事件还有机会 */
  }

  const sub = await App.addListener("appUrlOpen", (event) => {
    if (event?.url) handler(event.url);
  });
  return () => {
    void sub.remove();
  };
}

/** 回跳完了，把那个系统浏览器关掉（网页版不用管）。 */
export async function closeAuthBrowser(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    /* 已经关掉了 / 不是我们开的，忽略 */
  }
}
