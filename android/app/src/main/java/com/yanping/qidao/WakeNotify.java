package com.yanping.qidao;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * 后台唤醒的**通知出口**（唯一一处）。
 *
 * 用户的要求是"通知只在一件事真的发生时弹"：他说了一句话、写了日记、发了动态。
 * 失败（配置没同步、上游连不上）**不弹**——只有连续失败才会单独报一次，
 * 免得手机上天天挂着"后台唤醒失败"。
 *
 * 点通知 → 打开 App（`MainActivity`）→ 网页那一层接着 `flushPendingWake()` 把话落进会话。
 */
final class WakeNotify {

  /** 与 `public/runners/wake.js` 的 WAKE_NOTIFY_ACTION 对齐（点通知时网页据此跳到那条消息） */
  static final String ACTION = "qidao-wake-said";
  static final String CHANNEL_ID = "qidao_wake";
  static final int ID_BASE = 9000;

  private WakeNotify() {}

  static void ensureChannel(Context ctx) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = ctx.getSystemService(NotificationManager.class);
    if (nm == null) return;
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
    NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "他主动找你", NotificationManager.IMPORTANCE_DEFAULT);
    ch.setDescription("他在后台想起来你时说的话");
    ch.enableVibration(true);
    nm.createNotificationChannel(ch);
  }

  /**
   * 弹一条。`text` 是正文（最多两行），`seq` 用来让通知 id 不撞（点开旧的不会被新的顶掉太快）。
   */
  static void show(Context ctx, String title, String text, int seq) {
    try {
      ensureChannel(ctx);
      NotificationManager nm = ctx.getSystemService(NotificationManager.class);
      if (nm == null) return;

      Intent open = new Intent(ctx, MainActivity.class);
      open.setAction(ACTION);
      open.putExtra("qidaoWake", true);
      open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      int flags = PendingIntent.FLAG_UPDATE_CURRENT;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
      PendingIntent pi = PendingIntent.getActivity(ctx, ID_BASE + (seq % 1000), open, flags);

      Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
          ? new Notification.Builder(ctx, CHANNEL_ID)
          : new Notification.Builder(ctx);
      b.setContentTitle(title == null || title.isEmpty() ? "栖岛" : title)
          .setContentText(text == null ? "" : text)
          .setStyle(new Notification.BigTextStyle().bigText(text == null ? "" : text))
          .setSmallIcon(ctx.getApplicationInfo().icon)
          .setAutoCancel(true)
          .setContentIntent(pi);
      nm.notify(ID_BASE + (seq % 1000), b.build());
    } catch (Exception ignored) {
      /* 通知发不出去（没权限）不该让唤醒流程崩：话已经记进小本子了 */
    }
  }
}
