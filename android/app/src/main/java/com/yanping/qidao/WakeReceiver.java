package com.yanping.qidao;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 闹钟响的那一刻（以及开机/升级 App 后重排）。
 *
 * 只做两件事：把前台服务拉起来（真正干活在 `WakeService`）、顺便把下一次排上。
 */
public class WakeReceiver extends BroadcastReceiver {

  @Override
  public void onReceive(Context ctx, Intent intent) {
    String action = intent == null ? "" : String.valueOf(intent.getAction());
    /* 开机 / 升级后闹钟会被系统清掉 —— 重排一次 */
    if (Intent.ACTION_BOOT_COMPLETED.equals(action)
        || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
      WakeAlarm.schedule(ctx);
      return;
    }
    try {
      Intent svc = new Intent(ctx, WakeService.class);
      svc.setAction(WakeService.ACTION_TICK);
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
        ctx.startForegroundService(svc);
      } else {
        ctx.startService(svc);
      }
    } catch (Exception e) {
      /* 系统不让起（被厂商拦）→ 至少把下一次排上，别让唤醒链断掉 */
      WakeAlarm.schedule(ctx);
    }
  }
}
