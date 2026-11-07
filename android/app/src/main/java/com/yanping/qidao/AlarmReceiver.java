package com.yanping.qidao;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 闹钟到点的那一下（`AlarmManager.setAlarmClock` 到点会广播到这里）。
 *
 * 只做两件事：
 *   ① 把全屏响铃页拉起来（`AlarmActivity`）
 *   ② 如果是"每天"的，把明天那一次排上（`setAlarmClock` 是一次性的，不会自己重复）
 *
 * ⚠️ 为什么可以直接 `startActivity`：
 *   Android 10 之后普通后台 App 不许启动 Activity（`BackgroundActivityStartDenied`），
 *   但**闹钟类应用有豁免** —— 前提是这条定时必须来自 `setAlarmClock()`（带 AlarmClockInfo）。
 *   所以这里能弹出全屏页，而"普通通知到点"弹不出来。这也是整条链路必须走
 *   `setAlarmClock` 而不是 `setExact` 的原因之一。
 */
public class AlarmReceiver extends BroadcastReceiver {

  @Override
  public void onReceive(Context ctx, Intent intent) {
    if (intent == null) return;
    int id = intent.getIntExtra("id", 0);
    int hour = intent.getIntExtra("hour", -1);
    int minute = intent.getIntExtra("minute", -1);
    String text = intent.getStringExtra("text");
    boolean daily = intent.getBooleanExtra("daily", false);
    if (text == null || text.isEmpty()) text = "闹钟";

    /* ① 全屏响铃页（自己带铃声 + 震动 + 保持屏幕亮） */
    try {
      Intent ring = new Intent(ctx, AlarmActivity.class);
      ring.putExtra("id", id);
      ring.putExtra("hour", hour);
      ring.putExtra("minute", minute);
      ring.putExtra("text", text);
      ring.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      /*
       * 曾经在这里加过 `Intent.FLAG_ACTIVITY_REQUIRE_NON_BACKGROUND` —— 那个常量**不存在**
       * （CI `compileReleaseJavaWithJavac` 直接报 cannot find symbol），而且方向也是反的。
       *
       * 后台启动 Activity 的豁免**不是靠 flag 申请的**：只要这条定时来自
       * `AlarmManager.setAlarmClock()`，系统（Android 12+ 的 background activity start
       * restrictions）就把这次启动当成"闹钟在响"，直接放行。
       * 真正能显式声明意图的 API 是 `ActivityOptions.setPendingIntentBackgroundActivityStartMode`，
       * 但它只作用于 `PendingIntent` 的发送方（API 34+），跟我们这条 `startActivity` 无关。
       */
      ctx.startActivity(ring);
    } catch (Exception e) {
      /*
       * 起不来（极少数 ROM 把后台启动全禁了）→ 至少弹一条高优先级通知，
       * 用户在通知栏能看到、点进来就是 App。宁可吵一次也不静默。
       */
      AlarmNotify.post(ctx, text, "闹钟响了 · 点开看");
    }

    /* ② 每天的：把明天这一次排上 */
    if (daily && hour >= 0 && minute >= 0) {
      try {
        QidaoAlarmPlugin.scheduleFromReceiver(ctx, id, hour, minute, text, true);
      } catch (Exception ignored) {
        /* 排不上就明天靠 JS 冷启动时同步 —— 不要让广播崩掉（崩了系统会弹"栖岛屡次停止运行"） */
      }
    }
  }
}
