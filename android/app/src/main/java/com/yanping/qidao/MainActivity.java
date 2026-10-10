package com.yanping.qidao;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // 先把窗口摆成 edge-to-edge（WebView 是 super 里建的，免得先按"系统栏占位"布局一次再跳）
    edgeToEdge();

    // 注册自定义插件：把闹钟交给系统时钟（见 SystemAlarmPlugin）
    registerPlugin(SystemAlarmPlugin.class);
    // 注册自定义插件：「他主动找你」的配置抽屉（见 WakeBridgePlugin）
    // 前台把上游配置和五段指令写进去，后台那段 JS 醒来时自己读（安卓不允许直接递）
    registerPlugin(WakeBridgePlugin.class);
    // 注册自定义插件：**主动感知的原生入口**（见 SenseBridgePlugin）
    // 电量/网络/屏幕/最近通知/前台 App —— AI 调 sense.* 时是它去读一次
    registerPlugin(SenseBridgePlugin.class);
    super.onCreate(savedInstanceState);
  }

  /**
   * **内容铺到状态栏 / 导航栏下面**（edge-to-edge）。
   *
   * 用户原话（2026-11）："App 内容延伸到状态栏区域，状态栏变透明/半透明，
   * 可以降低割裂感。你看我给你发的截图，上下是不是还是有白边，能不能把它延伸？"
   *
   * 那两条白边的来源：应用主题是 Light 主题（`AppTheme` = `Theme.AppCompat.Light…`），
   * 系统就给状态栏/导航栏刷了浅色底 —— 在这套深色花背景里就特别割裂。
   *
   * ⚠️ 三件事缺一不可：
   *   1. `setDecorFitsSystemWindows(window, false)` —— **开关**：让内容进入系统栏区域
   *   2. 系统栏底色**透明** + 关掉系统的"对比度蒙层"（Android 10+ 会给透明系统栏
   *      自动垫一层半透明灰底，不关掉就还是看得见一条带）
   *   3. 图标转**浅色**（这个 App 是深色背景；不转的话深色图标压在深背景上等于看不见）
   *
   * 网页侧**不用改**：`viewport-fit=cover` 一直开着（见 `__root.tsx`），
   * 各页顶栏/底栏也已经用 `env(safe-area-inset-*)` 让出安全区，
   * 所以背景会铺满、内容不会被状态栏压住。
   *
   * ⚠️ targetSdk 已经是 36（Android 16）—— Android 15 起系统**本来就强制 edge-to-edge**，
   * 这一步迟早要做；现在显式做掉，免得被系统默认行为牵着走。
   */
  private void edgeToEdge() {
    Window window = getWindow();
    WindowCompat.setDecorFitsSystemWindows(window, false);
    window.setStatusBarColor(Color.TRANSPARENT);
    window.setNavigationBarColor(Color.TRANSPARENT);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.setStatusBarContrastEnforced(false);
      window.setNavigationBarContrastEnforced(false);
      window.setNavigationBarDividerColor(Color.TRANSPARENT);
    }
    WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(window, window.getDecorView());
    controller.setAppearanceLightStatusBars(false);
    controller.setAppearanceLightNavigationBars(false);
  }
}
