package com.yanping.qidao;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

/**
 * 闹钟的**兜底通知**（只有全屏页起不来时才用）。
 *
 * 为什么单独一个类、单独一个渠道：
 *   · 渠道的"重要性"建好之后**改不了** —— 消息那个 `qidao` 渠道是给"他说话"用的，
 *     不够吵也不该吵；闹钟要的是 `IMPORTANCE_HIGH` + 闹铃音 + 全屏 intent。
 *   · 用统一的 `qidao` 渠道发闹钟，用户会在系统设置里看到「他的消息」带着闹铃音，
 *     语义全乱。
 *
 * ⚠️ 全屏 intent（`setFullScreenIntent`）是"锁屏时直接把界面怼到眼前"的合法手段，
 * 但它需要 `USE_FULL_SCREEN_INTENT` 权限（Android 14 起这权限对新装应用默认**不授予**，
 * 用户得去设置里单独开）。所以这里是**兜底**：主路径始终是 `AlarmReceiver` 直接
 * `startActivity(AlarmActivity)`（闹钟类应用有后台启动豁免）。
 */
final class AlarmNotify {

  static final String CHANNEL_ID = "qidao_alarm";

  private AlarmNotify() {}

  static void ensureChannel(Context ctx) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return;

    NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "闹钟", NotificationManager.IMPORTANCE_HIGH);
    ch.setDescription("到点响铃的闹钟（不是聊天消息）");
    ch.enableVibration(true);
    ch.setVibrationPattern(new long[] { 0, 600, 400, 600, 400, 600 });
    ch.setBypassDnd(true); /* 勿扰模式下闹钟也该响 —— 这是系统允许的（ALARM 类别） */
    ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    try {
      Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
      if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
      if (sound != null) {
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        ch.setSound(sound, attrs);
      }
    } catch (Exception ignored) {
      /* 拿不到铃声就用系统默认，别让建渠道失败（失败了通知就发不出来） */
    }
    nm.createNotificationChannel(ch);
  }

  static void post(Context ctx, String text, String sub) {
    try {
      ensureChannel(ctx);
      NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm == null) return;

      Intent full = new Intent(ctx, AlarmActivity.class);
      full.putExtra("text", text);
      full.putExtra("hour", -1);
      full.putExtra("minute", -1);
      full.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      int flags = PendingIntent.FLAG_UPDATE_CURRENT;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
      PendingIntent pi = PendingIntent.getActivity(ctx, 90001, full, flags);

      Notification.Builder b;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        b = new Notification.Builder(ctx, CHANNEL_ID);
      } else {
        b = new Notification.Builder(ctx);
      }
      b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
          .setContentTitle(text == null || text.isEmpty() ? "闹钟" : text)
          .setContentText(sub == null ? "" : sub)
          .setCategory(Notification.CATEGORY_ALARM)
          .setPriority(Notification.PRIORITY_MAX)
          .setAutoCancel(true)
          .setOngoing(true)
          .setContentIntent(pi)
          .setFullScreenIntent(pi, true);
      nm.notify(90001, b.build());
    } catch (Exception ignored) {
      /* 兜底的兜底：通知也发不出来就算了，别在这里崩 */
    }
  }
}
