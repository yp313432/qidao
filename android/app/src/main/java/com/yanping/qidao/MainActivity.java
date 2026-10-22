package com.yanping.qidao;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // 注册自定义插件：把闹钟交给系统时钟（见 SystemAlarmPlugin）
    registerPlugin(SystemAlarmPlugin.class);
    // 注册自定义插件：「他主动找你」的配置抽屉（见 WakeBridgePlugin）
    // 前台把上游配置和五段指令写进去，后台那段 JS 醒来时自己读（安卓不允许直接递）
    registerPlugin(WakeBridgePlugin.class);
    // 注册自定义插件：**主动感知的原生入口**（见 SenseBridgePlugin）
    // 电量/网络/屏幕/最近通知/前台 App —— AI 调 sense.* 时是它去读一次
    registerPlugin(SenseBridgePlugin.class);
    // 注册自定义插件：**系统栏那一层**（见 ShellBridgePlugin）
    // 背景铺到状态栏/导航栏下面 + 把安全区高度交给网页 + 图标颜色跟着背景明暗走。
    // ⚠️ 必须跟插件里的 edgeToEdge() 一起用：只开窗口、不交安全区，顶栏会被状态栏压住
    registerPlugin(ShellBridgePlugin.class);
    super.onCreate(savedInstanceState);

    /**
     * **通知权限必须真的问一次**（用户 m10397：后台醒了但通知不弹）。
     *
     * targetSdk 36 → Android 13+ 要求运行时授权 `POST_NOTIFICATIONS`；
     * 没授权时 `NotificationManager.notify()` **不抛异常、什么都不做**，
     * 所以我们以前"发通知"的那段代码一直静默失败，日志里也看不出来。
     *
     * 只在第一次（没授权过）问；用户拒过一次后再打开 App 不再纠缠（系统要求
     * 二次询问要用户主动触发，硬问会被系统忽略）。想再开：系统设置 → 栖岛 → 通知。
     */
    if (Build.VERSION.SDK_INT >= 33
        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1001);
    }
  }
}
