package com.yanping.qidao;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Calendar;
import java.util.Date;

/**
 * **叫醒排班**（原生）：算出下一次该几点醒，然后交给系统闹钟。
 *
 * 为什么用 AlarmManager 而不是 WorkerManager：Worker 最短 15 分钟一档、而且系统会
 * 攒批、省电模式下能拖一小时；用户要的是"20:30 就是 20:30"。
 * `setExactAndAllowWhileIdle` 在 Doze 下也能准时（一天几十次以内不会被限）。
 *
 * 排班规则（跟 `WakeEngine.decide()` 的优先级一致，只是提前算）：
 *   · 日记保底：今天还没写、且现在还没到 20:30 → 下一次就是 20:30
 *   · 其余：45~75 分钟之后（随机，避免永远整点）
 *   · 落在安静时段 → 推到安静结束
 */
final class WakeAlarm {

  static final int REQ = 7301;

  private WakeAlarm() {}

  static PendingIntent pending(Context ctx) {
    Intent i = new Intent(ctx, WakeReceiver.class);
    i.setAction("com.yanping.qidao.WAKE_TICK");
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getBroadcast(ctx, REQ, i, flags);
  }

  /** 下一次醒来的时刻（毫秒） */
  static long nextAt(Context ctx, Date now) {
    Calendar c = Calendar.getInstance();
    c.setTime(now);

    long candidate = 0;

    /* ① 日记保底 */
    boolean autonomy = "1".equals(WakePrefs.str(ctx, WakePrefs.AUTONOMY_ON));
    boolean diaryOn = "1".equals(WakePrefs.str(ctx, WakePrefs.ACTION_DIARY));
    String today = WakeEngine.dayKey(now);
    boolean wroteToday = today.equals(WakePrefs.str(ctx, WakePrefs.ACTION_DAY));
    if (autonomy && diaryOn && !wroteToday) {
      Calendar d = Calendar.getInstance();
      d.setTime(now);
      d.set(Calendar.HOUR_OF_DAY, WakePrefs.num(ctx, WakePrefs.ACTION_HOUR, 20));
      d.set(Calendar.MINUTE, WakePrefs.num(ctx, WakePrefs.ACTION_MINUTE, 30));
      d.set(Calendar.SECOND, 0);
      d.set(Calendar.MILLISECOND, 0);
      if (d.getTimeInMillis() > now.getTime()) candidate = d.getTimeInMillis();
    }

    /* ② 平时的节拍：45~75 分钟随机 */
    Calendar r = Calendar.getInstance();
    r.setTime(now);
    r.add(Calendar.MINUTE, 45 + (int) Math.floor(Math.random() * 31));
    long tick = r.getTimeInMillis();
    if (candidate <= 0 || tick < candidate) candidate = tick;

    /* ③ 安静时段里就叫不醒 —— 推到安静结束 */
    Date cd = new Date(candidate);
    if (WakeEngine.inQuiet(ctx, cd)) {
      Calendar q = Calendar.getInstance();
      q.setTime(cd);
      q.set(Calendar.HOUR_OF_DAY, WakePrefs.num(ctx, WakePrefs.QUIET_END, 8));
      q.set(Calendar.MINUTE, 5);
      q.set(Calendar.SECOND, 0);
      q.set(Calendar.MILLISECOND, 0);
      if (q.getTimeInMillis() <= cd.getTime()) q.add(Calendar.DAY_OF_MONTH, 1);
      candidate = q.getTimeInMillis();
    }

    WakePrefs.putLong(ctx, WakePrefs.NEXT_AT_MS, candidate);
    return candidate;
  }

  /** 排下一次；返回真正定下的时刻（排不上返回 0） */
  static long schedule(Context ctx) {
    long at = nextAt(ctx, new Date());
    AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return 0;
    PendingIntent pi = pending(ctx);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
        /* 用户没给"闹钟和提醒"权限：退成不精确的——总比完全不排强 */
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
      } else {
        am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
      }
      return at;
    } catch (Exception e) {
      return 0;
    }
  }

  /** 用户从 App 里指定一个时刻（设置页/调试用） */
  static boolean scheduleAt(Context ctx, long atMs) {
    if (atMs <= System.currentTimeMillis()) return false;
    AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return false;
    PendingIntent pi = pending(ctx);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi);
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi);
      } else {
        am.setExact(AlarmManager.RTC_WAKEUP, atMs, pi);
      }
      WakePrefs.putLong(ctx, WakePrefs.NEXT_AT_MS, atMs);
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  static void cancel(Context ctx) {
    AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    am.cancel(pending(ctx));
    WakePrefs.putLong(ctx, WakePrefs.NEXT_AT_MS, 0);
  }
}
