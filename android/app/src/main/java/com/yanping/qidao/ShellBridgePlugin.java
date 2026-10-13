package com.yanping.qidao;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * **系统栏那一层**：让背景铺满状态栏/导航栏，同时把"安全区高度"交给网页。
 *
 * 用户原话（2026-11）：
 *   "我想铺背景图的话，它能自然地延伸到导航栏和上面电量时间那块 —— 能不能把它铺满，
 *    而不是说想上花纹。"（意思：**任何**背景图都该铺上去，浅色深色都要好看）
 *
 * ── 为什么必须是三件一起做（上一次只做了一件就出事）──────────────
 *   第一次只做了 ①（`setDecorFitsSystemWindows(false)`）→ 内容被顶进状态栏下面
 *   （顶栏的菜单/标题被压住、界面看着短了一截）。
 *   原因是安卓 WebView 在这个组合下 **`env(safe-area-inset-top)` 是 0** ——
 *   网页那边根本不知道系统栏有多高，让不出地方。
 *
 *   所以这里补齐另外两件：
 *   ② **把安全区高度推给网页**：写成 CSS 变量 `--q-inset-top` / `--q-inset-bottom`
 *   ③ **图标颜色接口**：背景是浅色时状态栏图标必须是深色（否则看不见）
 *
 * ⚠️ **这一层是"好看"用的，不是功能** —— 所以每个入口都包了 try/catch：
 *   万一某个 ROM 上某个 API 抛异常，绝不能让 App 崩（用户报过"刚打开闪退两次"，
 *   虽然没能复现，但这种代价为零的防御必须做上）。
 */
@CapacitorPlugin(name = "ShellBridge")
public class ShellBridgePlugin extends Plugin {

  @Override
  public void load() {
    try {
      edgeToEdge();
      /** 系统栏高度/朝向变化（旋转、手势导航切换）时重新推一次 */
      View decor = getActivity().getWindow().getDecorView();
      ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
        try {
          Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
          pushInsets(bars.top, bars.bottom);
          /**
           * **键盘**（2026-10 新增，用户报的"打字时对话框被盖住、看不到打的字"）。
           * 见下面 `pushImeInset` 的说明：edge-to-edge 之后这一步只能原生来做。
           */
          pushImeInset(insets);
        } catch (Throwable ignored) {
          /* 推不过去最多是顶栏位置/键盘让位不完美，不该影响 App */
        }
        return insets; // 不消费 —— 交给系统默认处理
      });
      /** 默认按"深色背景 + 浅色图标"（这个 App 的主题就是深色），网页算完会覆盖 */
      applyBarIcons(true);
      /** 顺便先推一次（不等 insets 回调） */
      pushCurrentInsets();
    } catch (Throwable ignored) {
      /* 见类注释：绝不让这一层把 App 拖崩 */
    }
  }

  /** ① 内容铺到系统栏下面 + 系统栏透明（透明是因为背景要透上来） */
  private void edgeToEdge() {
    Window window = getActivity().getWindow();
    WindowCompat.setDecorFitsSystemWindows(window, false);
    window.setStatusBarColor(Color.TRANSPARENT);
    window.setNavigationBarColor(Color.TRANSPARENT);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      /** Android 10 起系统会给透明的系统栏垫一层半透明"对比度"底 —— 关掉，否则还是看得见一条 */
      window.setStatusBarContrastEnforced(false);
      window.setNavigationBarContrastEnforced(false);
      window.setNavigationBarDividerColor(Color.TRANSPARENT);
    }
  }

  private Insets currentBars() {
    WindowInsetsCompat insets =
        ViewCompat.getRootWindowInsets(getActivity().getWindow().getDecorView());
    if (insets == null) return Insets.NONE;
    return insets.getInsets(WindowInsetsCompat.Type.systemBars());
  }

  /**
   * 兜底：拿不到 WindowInsets 时（老 ROM / androidx.core 太老），
   * 直接问系统要"状态栏高度"这个资源 —— 顶栏位置能对就行。
   */
  private int statusBarHeightFallbackPx() {
    try {
      int id =
          getActivity().getResources().getIdentifier("status_bar_height", "dimen", "android");
      if (id > 0) return getActivity().getResources().getDimensionPixelSize(id);
    } catch (Throwable ignored) {
      /* 拿不到就 0：宁可顶栏贴上去，也不能崩 */
    }
    return 0;
  }

  private void pushCurrentInsets() {
    try {
      Insets bars = currentBars();
      pushInsets(bars.top, bars.bottom);
    } catch (Throwable t) {
      pushInsets(statusBarHeightFallbackPx(), 0);
    }
  }

  /** 网页启动时会问一次（万一 load 时推得太早、文档还没准备好） */
  @PluginMethod
  public void getInsets(PluginCall call) {
    JSObject out = new JSObject();
    float density = 1f;
    int top = 0;
    int bottom = 0;
    int ime = 0;
    try {
      density = getActivity().getResources().getDisplayMetrics().density;
      if (density <= 0) density = 1f;
      Insets bars = currentBars();
      top = bars.top;
      bottom = bars.bottom;
      /** 键盘（可能此刻正开着 —— 比如用户在输入框里退回桌面又切回来） */
      WindowInsetsCompat insets =
          ViewCompat.getRootWindowInsets(getActivity().getWindow().getDecorView());
      if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
        ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
      }
    } catch (Throwable ignored) {
      /** 兜底：问系统要状态栏高度（顶栏位置能对就行，绝不能让 App 崩） */
      top = statusBarHeightFallbackPx();
      bottom = 0;
      ime = 0;
    }
    out.put("top", Math.round(top / density));
    out.put("bottom", Math.round(bottom / density));
    out.put("ime", Math.round(ime / density));
    call.resolve(out);
  }

  /**
   * **② 安全区推给网页**（写成 CSS 变量）。
   * ⚠️ 用 dp（= WebView 的 CSS px）而不是物理像素。
   */
  private void pushInsets(int topPx, int bottomPx) {
    evalCssVar("--q-inset-top", topPx);
    evalCssVar("--q-inset-bottom", bottomPx);
  }

  /**
   * **③ 键盘高度推给网页**（2026-10 新增）。
   *
   * 用户原话："键盘打字的时候，对话框依旧不弹出，被掩盖住，看不到打的字。"
   *
   * ── 为什么必须在原生做（网页自己算不出来）─────────────────────────
   *   为了"背景铺到状态栏/导航栏"，这里开了 edge-to-edge
   *   （`setDecorFitsSystemWindows(window, false)`）。安卓官方口径：
   *   这个模式下**系统不再按键盘顶小窗口**（`windowSoftInputMode="adjustResize"` 失效），
   *   键盘是**盖**上来的，IME 内衬（`Type.ime()`）要由 App 自己处理。
   *   网页那边 `visualViewport` 在这种模式下**也不会跟着变小** → 算出来永远是 0。
   *   （参考：Android 官方《Understand window insets in WebView》）
   *
   * 口径：`--q-ime-bottom-native` = 键盘高度（dp）；没弹就是 0。
   * 网页自己那个兜底变量叫 `--q-ime-bottom-web`（给浏览器 / iOS 用），
   * 消费点是 `max(两者)` —— 谁有值就用谁，两边不会互相盖。
   */
  private void pushImeInset(WindowInsetsCompat insets) {
    try {
      boolean shown = insets.isVisible(WindowInsetsCompat.Type.ime());
      int px = shown ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
      evalCssVar("--q-ime-bottom-native", px);
    } catch (Throwable ignored) {
      /* 见类注释：这一层失败绝不能让 App 崩 */
    }
  }

  /** 把一个物理像素值按 dp 换算后写成网页上的 CSS 变量 */
  private void evalCssVar(String name, int px) {
    try {
      float density = getActivity().getResources().getDisplayMetrics().density;
      if (density <= 0) density = 1f;
      int value = Math.max(0, Math.round(px / density));
      final String js =
          "document.documentElement.style.setProperty('"
              + name
              + "','"
              + value
              + "px');";
      View web = getBridge().getWebView();
      if (web == null) return;
      web.post(
          () -> {
            try {
              getBridge().getWebView().evaluateJavascript(js, null);
            } catch (Throwable ignored) {
              /* 见类注释 */
            }
          });
    } catch (Throwable ignored) {
      /* 见类注释 */
    }
  }

  /**
   * ④ 状态栏/导航栏图标颜色。
   * `light = true` → **浅色图标**（配深色背景）；`false` → 深色图标（配浅色背景）。
   */
  @PluginMethod
  public void setBarIcons(PluginCall call) {
    try {
      Boolean light = call.getBoolean("light", Boolean.TRUE);
      applyBarIcons(light == null || light);
    } catch (Throwable ignored) {
      /* 见类注释 */
    }
    call.resolve();
  }

  private void applyBarIcons(boolean light) {
    Window window = getActivity().getWindow();
    WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(window, window.getDecorView());
    controller.setAppearanceLightStatusBars(!light);
    controller.setAppearanceLightNavigationBars(!light);
  }
}
