package com.yanping.qidao;

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
    super.onCreate(savedInstanceState);
  }
}
