package com.yanping.qidao;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.WindowManager;
import android.widget.TextView;

import java.util.Calendar;
import java.util.Locale;

/**
 * 到点之后真正"响"的那一页。
 *
 * 为什么必须是一个真 Activity，而不能是通知：
 *   睡着的人不会看通知栏。要"响到人醒"，得 ①亮屏 ②出声 ③震动 ④盖在锁屏上面。
 *   这四件事只有 Activity 能做（配合 `setShowWhenLocked` / `setTurnScreenOn`）。
 *
 * 三个容易踩的点，都在代码里标了：
 *   · 声音用 `USAGE_ALARM`，否则静音/勿扰下会被当媒体音量压掉；
 *   · `MediaPlayer` 必须 `isLooping`，不然响 5 秒就没了；
 *   · 必须自己 `WakeLock` —— `setTurnScreenOn` 只负责点亮那一下，屏幕会自己再睡回去。
 */
public class AlarmActivity extends Activity {

  private MediaPlayer player;
  private Vibrator vibrator;
  private PowerManager.WakeLock wakeLock;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_alarm);

    /* 锁屏上也显示、并且点亮屏幕（API 27+ 才有 setShowWhenLocked/setTurnScreenOn） */
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
      KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
      if (km != null) km.requestDismissKeyguard(this, null); /* 让用户不用先解锁就能关闹钟 */
    } else {
      getWindow().addFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
              | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    String rawText = getIntent().getStringExtra("text");
    /* 一次赋值：下面「稍后再响」的 lambda 要捕获它，javac 要求 final / effectively final */
    final String text = (rawText == null || rawText.isEmpty()) ? "闹钟" : rawText;
    int hour = getIntent().getIntExtra("hour", -1);
    int minute = getIntent().getIntExtra("minute", -1);

    TextView timeView = findViewById(R.id.alarm_time);
    TextView titleView = findViewById(R.id.alarm_title);
    if (hour >= 0 && minute >= 0) {
      timeView.setText(String.format(Locale.US, "%02d:%02d", hour, minute));
      titleView.setText(text);
    } else {
      /* 从通知 / "听一下铃声"进来的：没有具体时间 */
      timeView.setText("响铃");
      titleView.setText(text);
    }

    findViewById(R.id.alarm_stop).setOnClickListener(v -> finish());
    findViewById(R.id.alarm_snooze).setOnClickListener(v -> {
      snooze(text);
      finish();
    });

    /*
     * 5 分钟后自动停。
     *
     * 真闹钟的常识行为：一直响到人按掉，但**也得有个上限** ——
     * 手机被落在桌上、人已经出门的场合，无限循环的铃声会一直耗电、也扰民。
     * 5 分钟够把人叫醒，又不会响一整天。
     */
    mainHandler.postDelayed(() -> {
      try {
        if (!isFinishing()) finish();
      } catch (Exception ignored) {
      }
    }, 5 * 60 * 1000L);

    startRinging();
  }

  /* 用来挂"5 分钟后自己关"那条定时（不能用匿名 Timer，Activity 结束要能取消） */
  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  @Override
  protected void onStop() {
    super.onStop();
    /*
     * 用户切走（或按了 home）就停 —— 闹钟页不该在后台继续叫。
     * 但"稍后再响"已经另排了系统闹钟，所以这里停掉是安全的。
     */
    stopRinging();
  }

  @Override
  protected void onDestroy() {
    stopRinging();
    mainHandler.removeCallbacksAndMessages(null);
    super.onDestroy();
  }

  private void startRinging() {
    /* ① 屏幕别睡 */
    try {
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      if (pm != null) {
        wakeLock = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "qidao:alarm");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(10 * 60 * 1000L); /* 最多 10 分钟，防呆 */
      }
    } catch (Exception ignored) {
    }

    /* ② 声音：循环播闹铃 */
    try {
      Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
      if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
      player = new MediaPlayer();
      player.setAudioAttributes(new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM) /* ← 关键：闹钟用途，静音也响 */
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build());
      player.setDataSource(this, sound);
      player.setLooping(true);
      player.prepare();
      player.start();
    } catch (Exception e) {
      /* 放不出来声音也别崩 —— 还有震动和亮屏 */
      player = null;
    }

    /* ③ 震动：两短一停地来，跟铃声错开 */
    try {
      vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
      if (vibrator != null && vibrator.hasVibrator()) {
        long[] pattern = { 0, 700, 500, 700, 500, 700, 1200 };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); /* 0 = 无限重复 */
        } else {
          vibrator.vibrate(pattern, 0);
        }
      }
    } catch (Exception ignored) {
    }
  }

  private void stopRinging() {
    try {
      if (player != null) {
        if (player.isPlaying()) player.stop();
        player.release();
      }
    } catch (Exception ignored) {
    }
    player = null;

    try {
      if (vibrator != null) vibrator.cancel();
    } catch (Exception ignored) {
    }
    vibrator = null;

    try {
      if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    } catch (Exception ignored) {
    }
    wakeLock = null;
  }

  /** "5 分钟后再响"：直接排一条 5 分钟后的系统闹钟（不依赖 App 进程还活着） */
  private void snooze(String text) {
    try {
      AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
      if (am == null) return;
      long at = System.currentTimeMillis() + 5 * 60 * 1000L;
      Intent intent = new Intent(this, AlarmReceiver.class);
      intent.setAction(QidaoAlarmPlugin.ACTION_RING);
      intent.putExtra("id", 99999); /* 固定的"再响一次"槽位，不跟用户闹钟的 id 撞 */
      /* 用"到点时刻"当小时/分钟，这样 AlarmReceiver 的 daily 逻辑不会误排明天的 */
      Calendar c = Calendar.getInstance();
      c.setTimeInMillis(at);
      intent.putExtra("hour", c.get(Calendar.HOUR_OF_DAY));
      intent.putExtra("minute", c.get(Calendar.MINUTE));
      intent.putExtra("text", text);
      intent.putExtra("daily", false);
      int flags = PendingIntent.FLAG_UPDATE_CURRENT;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
      PendingIntent pi = PendingIntent.getBroadcast(this, 99999, intent, flags);

      AlarmManager.AlarmClockInfo info = null;
      try {
        Intent show = new Intent(this, MainActivity.class);
        show.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent showPi = PendingIntent.getActivity(this, 199999, show, flags);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          info = new AlarmManager.AlarmClockInfo(at, showPi);
        }
      } catch (Exception ignored) {
      }
      if (info != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms())) {
        am.setAlarmClock(info, pi);
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
      } else {
        am.set(AlarmManager.RTC_WAKEUP, at, pi);
      }
    } catch (Exception ignored) {
      /* 排不上就算了：用户已经醒着，最多是这次没再响 */
    }
  }
}
