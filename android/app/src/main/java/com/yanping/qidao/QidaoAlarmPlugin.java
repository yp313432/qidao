package com.yanping.qidao;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * **栖岛自己的闹钟**（不是"塞进系统时钟"，那个见 `SystemAlarmPlugin`）。
 *
 * ── 为什么必须走原生 ─────────────────────────────────────────────
 * 用户实测报的 bug："现在闹钟只能在 App 点开的时候响，其他时候不响。"
 *
 * 根因是**排定时的位置错了**：App 内的闹钟原来是
 *   ① JS 里一个 `setInterval` 检查（App 一进后台/被划掉就停）
 *   ② `@capacitor/local-notifications` 的定时通知（那种只会"弹一条通知"，
 *      不会亮屏、不会一直响，睡着的人根本不知道响过）
 * 现在改成：
 *   `AlarmManager.setAlarmClock()` → `AlarmReceiver` → `AlarmActivity`（全屏 + 铃声 + 震动）
 *
 * ── 为什么是 `setAlarmClock` 而不是别的 ──────────────────────────
 * 它是安卓里**优先级最高的一档**定时：
 *   · Doze / 省电模式下照样准时（`setExactAndAllowWhileIdle` 有配额，一天几十次就被限）
 *   · 系统会把它显示成"下一个闹钟"（状态栏那个小闹钟图标也算我们一条）
 *   · **闹钟类应用有"后台启动 Activity"的豁免** —— 这是全屏响铃页能真的弹到眼前的
 *     唯一合法前提（Android 10 之后普通后台 App 不许 startActivity）
 *   · 需要一个 `AlarmClockInfo` 里的 showIntent（点状态栏那个闹钟图标要跳去哪）
 *
 * ── 精确闹钟权限 ────────────────────────────────────────────────
 * Android 12 起 `SCHEDULE_EXACT_ALARM` 是**用户可撤销**的（设置 → 应用 → 特殊权限 →
 * 闹钟和提醒）。没有它的时候 `setAlarmClock` 会抛 `SecurityException`。
 * 所以这里：查得到就正常排；查不到就退回 `setAndAllowWhileIdle`（会晚几分钟到几十分钟），
 * 并把这个事实**如实回报给 JS** —— 界面上要能说"现在不是精确定时"。
 */
@CapacitorPlugin(name = "QidaoAlarm")
public class QidaoAlarmPlugin extends Plugin {

  /** broadcast 的 action：闹钟响了 */
  public static final String ACTION_RING = "com.yanping.qidao.ALARM_RING";

  @Override
  public void load() {
    super.load();
    /*
     * 开机 / App 升级之后系统会把所有共享的 JS 定时清掉 —— 那由 JS 侧重新推一次。
     * 这里不主动重排：闹钟的真相在 JS 的 store 里（改名、改时间、删掉都只在那里发生），
     * 原生这份只是"照着排定的影子"，开机时由 App 冷启动后重新同步最可靠。
     */
  }

  /** 现在能不能精确定时（Android 12+ 由用户开关决定） */
  @PluginMethod
  public void canExact(PluginCall call) {
    JSObject ret = new JSObject();
    boolean exact = true;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
      exact = am != null && am.canScheduleExactAlarms();
    }
    ret.put("exact", exact);
    ret.put("sdk", Build.VERSION.SDK_INT);
    call.resolve(ret);
  }

  /** 跳到"闹钟和提醒"这个特殊权限页（用户自己开） */
  @PluginMethod
  public void openExactSettings(PluginCall call) {
    try {
      Intent intent;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
      } else {
        intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve(new JSObject().put("ok", true));
    } catch (Exception e) {
      call.reject("打不开设置页：" + e.getMessage());
    }
  }

  /**
   * 同步全部闹钟（App 里那份是真相）。
   *
   * 参数：`alarms: [{ id, hour, minute, text, daily }]`、`removed: [id…]`（可选）
   *
   * 语义：`alarms` 里每一条都按当前时间重排一次；`removed` 里的 id 撤掉。
   * 为什么要 `removed` 而不是"没传进来的就自动撤"：安卓没有"列出我排了哪些"的 API，
   * 原生侧根本不知道全集是什么，只能由记着这份表的 JS 侧告诉它（见下面那段注释）。
   */
  @PluginMethod
  public void sync(PluginCall call) {
    JSArray arr = call.getArray("alarms");
    if (arr == null) {
      call.reject("缺少 alarms");
      return;
    }
    AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
    if (am == null) {
      call.reject("这台设备没有 AlarmManager");
      return;
    }
    boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();

    JSArray acceptedIds = new JSArray();
    android.content.SharedPreferences delivery =
        getContext().getSharedPreferences("alarm-delivery", Context.MODE_PRIVATE);
    int count = 0;
    java.util.HashSet<Integer> keep = new java.util.HashSet<>();
    try {
      for (int i = 0; i < arr.length(); i += 1) {
        JSONObject o = arr.getJSONObject(i);
        int id = o.optInt("id", 0);
        int hour = o.optInt("hour", 7);
        int minute = o.optInt("minute", 0);
        String text = o.optString("text", "闹钟");
        boolean daily = o.optBoolean("daily", true);
        if (id == 0) continue;
        long at = daily ? nextTrigger(hour, minute) : o.optLong("at", 0);
        if (at <= 0) continue;
        String key = Integer.toString(id);
        if (!daily && at <= System.currentTimeMillis()) {
          boolean fired = delivery.getLong(key, 0) == at;
          boolean pending = delivery.getLong("pending:" + key, 0) == at
              && alarmIntent(getContext(), id, hour, minute, text, false, at,
                  PendingIntent.FLAG_NO_CREATE) != null;
          if (!fired && !pending) continue;
        } else {
          scheduleStatic(getContext(), am, id, hour, minute, text, daily, exact, at);
          if (!daily) delivery.edit().putLong("pending:" + key, at).apply();
          count += 1;
        }
        keep.add(id);
        acceptedIds.put(id);
      }
    } catch (Exception e) {
      call.reject("排闹钟时出错：" + e.getMessage());
      return;
    }

    /*
     * 撤掉那些"已经被删掉"的（用户删了闹钟 / 把响铃改成只提醒）。
     *
     * ⚠️ 为什么让 JS 传一份 `removed` 而不是在原生侧扫一遍"现在排着哪些 id"：
     * 安卓没有"列出我的所有 PendingIntent"的 API，只能对每个可能的 requestCode 用
     * `FLAG_NO_CREATE` 去问 —— 那是十万次 binder 调用，主线程上直接卡死。
     * JS 侧本来就记着上一次排了哪些（`qidao:alarms-scheduled`），差分由它算最省。
     */
    JSArray removed = call.getArray("removed");
    if (removed != null) {
      try {
        for (int i = 0; i < removed.length(); i += 1) {
          int id = removed.getInt(i);
          if (id != 0 && !keep.contains(id)) cancelOne(am, id);
        }
      } catch (Exception ignored) {
        /* 差分数组格式不对不影响主流程：最坏情况只是旧的那条多响一次 */
      }
    }

    JSObject ret = new JSObject();
    ret.put("ok", true);
    ret.put("count", count);
    ret.put("acceptedIds", acceptedIds);
    ret.put("exact", exact);
    call.resolve(ret);
  }

  /** 单个撤销（界面上删掉一条闹钟时立刻调，比等下一次全量同步快） */
  @PluginMethod
  public void cancel(PluginCall call) {
    Integer id = call.getInt("id");
    if (id == null) {
      call.reject("缺少 id");
      return;
    }
    AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
    if (am != null) cancelOne(am, id);
    call.resolve(new JSObject().put("ok", true));
  }

  @PluginMethod
  public void cancelAll(PluginCall call) {
    /* 只撤"JS 告诉我它还排着的那些"（见 sync 里关于 removed 的说明） */
    JSArray ids = call.getArray("ids");
    AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
    if (am != null && ids != null) {
      try {
        for (int i = 0; i < ids.length(); i += 1) cancelOne(am, ids.getInt(i));
      } catch (Exception ignored) {
        /* 同上：格式不对就当全撤销不掉，不影响 App */
      }
    }
    call.resolve(new JSObject().put("ok", true));
  }

  /** 立刻响一次（"听一下铃声"按钮用：不必等到明天早上才知道响不响） */
  @PluginMethod
  public void ringNow(PluginCall call) {
    String text = call.getString("text", "这是测试铃声");
    Intent i = new Intent(getContext(), AlarmActivity.class);
    i.putExtra("text", text);
    i.putExtra("hour", -1);
    i.putExtra("minute", -1);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    try {
      getContext().startActivity(i);
      call.resolve(new JSObject().put("ok", true));
    } catch (Exception e) {
      call.reject("没能弹出响铃页：" + e.getMessage());
    }
  }

  /* ───────────── 内部 ───────────── */

  private static PendingIntent alarmIntent(Context ctx, int id, int hour, int minute, String text, boolean daily, long at, int flags) {
    Intent i = new Intent(ctx, AlarmReceiver.class);
    i.setAction(ACTION_RING);
    i.putExtra("id", id);
    i.putExtra("hour", hour);
    i.putExtra("minute", minute);
    i.putExtra("text", text);
    i.putExtra("daily", daily);
    i.putExtra("at", at);
    /* requestCode 必须每条不同，否则后一条会把前一条覆盖掉（PendingIntent 按 requestCode 去重） */
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getBroadcast(ctx, id, i, flags);
  }

  /**
   * 排一条闹钟（静态版 —— `AlarmReceiver` 里"每天的排下一次"也要用它）。
   *
   * 抽成静态的原因：广播接收器里没有 Plugin 实例，硬要拿 `getContext()` 只能靠静态引用，
   * 那比"把这段逻辑做成无状态的静态函数"更容易出错。
   */
  static void scheduleStatic(
      Context ctx,
      AlarmManager am,
      int id,
      int hour,
      int minute,
      String text,
      boolean daily,
      boolean exact,
      long at) {
    PendingIntent pi = alarmIntent(ctx, id, hour, minute, text, daily, at, PendingIntent.FLAG_UPDATE_CURRENT);

    /* 点状态栏那个"下一个闹钟"图标时跳到哪：直接进 App */
    Intent show = new Intent(ctx, MainActivity.class);
    show.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    int showFlags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) showFlags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent showPi = PendingIntent.getActivity(ctx, id + 100000, show, showFlags);

    try {
      if (exact) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showPi), pi);
        } else {
          am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
        }
      } else {
        /*
         * 没有精确定时权限：退回 setAndAllowWhileIdle。
         * 它会晚几分钟到几十分钟（系统按批次合并），但不至于"完全不响" ——
         * 而且 `exact:false` 会让界面显示提示，用户能去把权限打开。
         */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else {
          am.set(AlarmManager.RTC_WAKEUP, at, pi);
        }
      }
    } catch (SecurityException e) {
      /* 极少数机型（省电白名单外的国产 ROM）连 setAlarmClock 都拦 —— 至少排个普通闹钟 */
      am.set(AlarmManager.RTC_WAKEUP, at, pi);
    }
  }

  /** `AlarmReceiver` 用：到了点之后把"明天这一次"排上 */
  static void scheduleFromReceiver(Context ctx, int id, int hour, int minute, String text, boolean daily) {
    AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
    scheduleStatic(ctx, am, id, hour, minute, text, daily, exact, nextTrigger(hour, minute));
  }

  private void cancelOne(AlarmManager am, int id) {
    Context ctx = getContext();
    PendingIntent pi = alarmIntent(ctx, id, 0, 0, "", true, 0, PendingIntent.FLAG_NO_CREATE);
    if (pi != null) {
      am.cancel(pi);
      pi.cancel();
    }
    ctx.getSharedPreferences("alarm-delivery", Context.MODE_PRIVATE)
        .edit().remove(Integer.toString(id)).remove("pending:" + id).apply();
  }

  /**
   * 下一次该响的时刻（毫秒）。
   *
   * "每天 7:30" 的语义是**下一个 7:30**：今天还没到就是今天，过了就明天。
   * 原来这里是 JS 算的（`scheduleNative` 的 `daily`），交给原生之后同样要算 ——
   * 差别是现在算的是**响铃时刻**，不是"发通知的时刻"。
   */
  static long nextTrigger(int hour, int minute) {
    Calendar c = Calendar.getInstance();
    c.set(Calendar.HOUR_OF_DAY, hour);
    c.set(Calendar.MINUTE, minute);
    c.set(Calendar.SECOND, 0);
    c.set(Calendar.MILLISECOND, 0);
    long at = c.getTimeInMillis();
    if (at <= System.currentTimeMillis() + 1000) c.add(Calendar.DAY_OF_YEAR, 1);
    return c.getTimeInMillis();
  }
}
