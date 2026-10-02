package com.yanping.qidao;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // 注册自定义插件：把闹钟交给系统时钟（见 SystemAlarmPlugin）
    registerPlugin(SystemAlarmPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
