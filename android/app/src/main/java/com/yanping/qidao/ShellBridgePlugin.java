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
 *   我第一次只做了 ①（`setDecorFitsSystemWindows(false)`）→ 内容被顶进状态栏下面
 *   （顶栏的菜单/标题被压住、界面看着短了一截）。
 *   原因是安卓 WebView 在这个组合下 **`env(safe-area-inset-top)` 是 0** ——
 *   网页那边根本不知道系统栏有多高，让不出地方。
 *
 *   所以这里补齐另外两件：
 *   ② **把安全区高度推给网页**：写成 CSS 变量 `--q-inset-top` / `--q-inset-bottom`，
 *      网页的顶栏/底栏用它当内边距（WebView 的 CSS px 与 dp 1:1，所以直接除 density）
 *   ③ **图标颜色接口**：背景是浅色时状态栏图标必须是深色（否则看不见）——
 *      背景图在网页那边，所以由网页算好明暗再调 `setBarIcons()`
 */
@CapacitorPlugin(name = "ShellBridge")
public class ShellBridgePlugin extends Plugin {

  @Override
  public void load() {
    edgeToEdge();
    /** 系统栏高度/朝向变化（旋转、手势导航切换）时重新推一次 */
    View decor = getActivity().getWindow().getDecorView();
    ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
      Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
      pushInsets(bars.top, bars.bottom);
      return insets; // 不消费 —— 交给系统默认处理
    });
    /** 默认按"深色背景 + 浅色图标"（这个 App 的主题就是深色），网页算完会覆盖 */
    applyBarIcons(true);
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

  /** 网页启动时会问一次（万一 load 时推得太早、文档还没准备好） */
  @PluginMethod
  public void getInsets(PluginCall call) {
    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getActivity().getWindow().getDecorView());
    Insets bars = insets == null ? Insets.NONE : insets.getInsets(WindowInsetsCompat.Type.systemBars());
    float density = getActivity().getResources().getDisplayMetrics().density;
    com.getcapacitor.JSObject out = new com.getcapacitor.JSObject();
    out.put("top", Math.round(bars.top / density));
    out.put("bottom", Math.round(bars.bottom / density));
    call.resolve(out);
  }

  /**
   * ② 安全区推给网页（写成 CSS 变量）。
   * ⚠️ 用 dp（= WebView 的 CSS px）而不是物理像素。
   */
  private void pushInsets(int topPx, int bottomPx) {
    float density = getActivity().getResources().getDisplayMetrics().density;
    int top = Math.round(topPx / density);
    int bottom = Math.round(bottomPx / density);
    final String js =
        "document.documentElement.style.setProperty('--q-inset-top','"
            + top
            + "px');document.documentElement.style.setProperty('--q-inset-bottom','"
            + bottom
            + "px');";
    View web = getBridge().getWebView();
    if (web == null) return;
    web.post(() -> getBridge().getWebView().evaluateJavascript(js, null));
  }

  /**
   * ③ 状态栏/导航栏图标颜色。
   * `light = true` → **浅色图标**（配深色背景）；`false` → 深色图标（配浅色背景）。
   */
  @PluginMethod
  public void setBarIcons(PluginCall call) {
    Boolean light = call.getBoolean("light", Boolean.TRUE);
    applyBarIcons(light == null || light);
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
