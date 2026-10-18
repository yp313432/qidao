package com.yanping.qidao;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * **跑一次唤醒的前台服务**。
 *
 * 为什么非得起前台服务：安卓 8 以后后台随便起的进程会被很快冻结，网络请求经常跑到一半被掐；
 * 前台服务能让这次请求和它之后的记账跑完（通常 3~10 秒），跑完立刻 stopSelf，
 * 通知栏上只留一条"正在想事情"的低优先级提示，不打扰人。
 *
 * 干活的内容全在 `WakeEngine.tick()`；这个类只管生命周期和线程。
 */
public class WakeService extends Service {

  static final String ACTION_TICK = "com.yanping.qidao.WAKE_RUN";
  private static final String CH_ID = "qidao_wake_busy";
  private static final int FG_ID = 7302;

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    startForegroundQuietly();

    new Thread(new Runnable() {
      @Override
      public void run() {
        try {
          WakeEngine.tick(WakeService.this);
        } catch (Throwable ignored) {
          /* 这次失败了不能把唤醒链断掉 */
        } finally {
          /* 无论成败都排下一次 */
          WakeAlarm.schedule(WakeService.this);
          stopForegroundQuietly();
          stopSelf();
        }
      }
    }, "qidao-wake").start();

    return START_NOT_STICKY;
  }

  private void startForegroundQuietly() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder b = new Notification.Builder(this, ensureBusyChannel());
        b.setContentTitle("栖岛").setContentText("在想事情…")
            .setSmallIcon(getApplicationInfo().icon)
            .setPriority(Notification.PRIORITY_MIN);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          startForeground(FG_ID, b.build(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
          startForeground(FG_ID, b.build());
        }
      } else {
        Notification.Builder b = new Notification.Builder(this);
        b.setContentTitle("栖岛").setContentText("在想事情…")
            .setSmallIcon(getApplicationInfo().icon)
            .setPriority(Notification.PRIORITY_MIN);
        startForeground(FG_ID, b.build());
      }
    } catch (Throwable ignored) {
      /* 起不来也不能崩：tick 照样在后台线程里试 */
    }
  }

  private String ensureBusyChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
      if (nm != null && nm.getNotificationChannel(CH_ID) == null) {
        android.app.NotificationChannel ch = new android.app.NotificationChannel(
            CH_ID, "后台唤醒（临时）", android.app.NotificationManager.IMPORTANCE_MIN);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
      }
    }
    return CH_ID;
  }

  private void stopForegroundQuietly() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE);
      } else {
        stopForeground(true);
      }
    } catch (Throwable ignored) {
      /* 已经不在前台了：无所谓 */
    }
  }
}
