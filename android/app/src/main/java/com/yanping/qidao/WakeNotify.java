package com.yanping.qidao;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

/**
 * 后台唤醒的**通知出口**（唯一一处）。
 *
 * 用户的要求是"通知只在一件事真的发生时弹"：他说了一句话、写了日记、发了动态。
 * 失败（配置没同步、上游连不上）**不弹**——只有连续失败才会单独报一次，
 * 免得手机上天天挂着"后台唤醒失败"。
 *
 * 点通知 → 打开 App（`MainActivity`）→ 网页那一层接着 `flushPendingWake()` 把话落进会话。
 *
 * ── 2026-10-22 修「后台醒了但通知不弹」（用户 m10397）─────────────────
 *
 * 三个致命坑，全在**发通知这一步**，而且都不会抛异常（所以查不出来）：
 *
 *   ① **小图标不合规**：原来用 `getApplicationInfo().icon`（adaptive icon）。
 *      Android 8+ 只接受单色剪影，拿彩色 icon 当 smallIcon 有的机型显示白块、
 *      有的**整条通知直接丢弃**。现在固定用 `R.drawable.ic_stat_qidao`。
 *   ② **通知权限没问过**：targetSdk 36 → Android 13+ 必须运行时授权
 *      `POST_NOTIFICATIONS`，没授权时 `notify()` **静默失败**（不抛错）。
 *      `MainActivity` 打开时问一次；这里再查一次，没权限就记一条日志给用户看。
 *   ③ **通知被用户/系统关掉**（渠道或总开关）：`areNotificationsEnabled()`
 *      为 false 时同样静默。同样记一条日志。
 *
 * 为什么要记日志而不是只吞掉：用户看到的是"什么都没发生"，而日志能让
 * 「我的 → 后台 → 后台记录」直接写清"通知被系统关了" —— 一次就能定位。
 */
final class WakeNotify {

  /** 与 `public/runners/wake.js` 的 WAKE_NOTIFY_ACTION 对齐（点通知时网页据此跳到那条消息） */
  static final String ACTION = "qidao-wake-said";
  static final String CHANNEL_ID = "qidao_wake";
  static final int ID_BASE = 9000;
  /** Android 13+ 的运行时通知权限 */
  private static final String PERM_POST = "android.permission.POST_NOTIFICATIONS";

  private WakeNotify() {}

  static void ensureChannel(Context ctx) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = ctx.getSystemService(NotificationManager.class);
    if (nm == null) return;
    NotificationChannel old = nm.getNotificationChannel(CHANNEL_ID);
    if (old != null) {
      /**
       * 渠道已经存在就**不重建**（重建会保留用户设置），但要把"被关掉"这件事记下来：
       * 渠道 importance 是 NONE 时，无论我们怎么 notify 都不会弹。
       */
      if (old.getImportance() == NotificationManager.IMPORTANCE_NONE) {
        note(ctx, "通知渠道「他主动找你」被关掉了，去系统设置里打开");
      }
      return;
    }
    NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "他主动找你", NotificationManager.IMPORTANCE_DEFAULT);
    ch.setDescription("他在后台想起来你时说的话");
    ch.enableVibration(true);
    nm.createNotificationChannel(ch);
  }

  /** 通知发不出去时，往"后台记录"里写一行人话（网页那边能看见） */
  private static void note(Context ctx, String why) {
    try {
      JSONObject entry = new JSONObject();
      long now = System.currentTimeMillis();
      entry.put("id", now);
      entry.put("atMs", now);
      entry.put("at", WakePrefs.str(ctx, "wake_stamp"));
      entry.put("kind", "notify");
      entry.put("text", "通知没弹出来：" + why);
      WakeLedger.append(ctx, entry);
    } catch (Exception ignored) {
      /* 记日志本身失败就算了 */
    }
  }

  /**
   * 弹一条。`text` 是正文（最多两行），`seq` 用来让通知 id 不撞（点开旧的不会被新的顶掉太快）。
   */
  static void show(Context ctx, String title, String text, int seq) {
    try {
      /* ① 权限（Android 13+）—— 没授权时 notify() 不抛错，只会什么都不发生 */
      if (Build.VERSION.SDK_INT >= 33
          && ctx.checkSelfPermission(PERM_POST) != PackageManager.PERMISSION_GRANTED) {
        note(ctx, "系统没给栖岛通知权限");
        return;
      }
      NotificationManager nm = ctx.getSystemService(NotificationManager.class);
      if (nm == null) {
        note(ctx, "系统通知服务不可用");
        return;
      }
      /* ② 总开关 / 渠道被关 —— 同样是静默失败 */
      if (!nm.areNotificationsEnabled()) {
        note(ctx, "栖岛的通知被系统关掉了");
        return;
      }
      ensureChannel(ctx);

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
          /* ③ 小图标必须是单色剪影，见文件头注释 ① */
          .setSmallIcon(R.drawable.ic_stat_qidao)
          .setAutoCancel(true)
          .setContentIntent(pi);
      nm.notify(ID_BASE + (seq % 1000), b.build());
    } catch (Exception e) {
      /* 话已经记进小本子了，通知失败不崩流程；但要留证据 */
      note(ctx, String.valueOf(e.getMessage()));
    }
  }
}
