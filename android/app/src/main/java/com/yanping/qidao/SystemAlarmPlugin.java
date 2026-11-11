package com.yanping.qidao;

import android.content.Intent;
import android.provider.AlarmClock;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 把响铃闹钟交给手机的时钟 App。 */
@CapacitorPlugin(name = "SystemAlarm")
public class SystemAlarmPlugin extends Plugin {

  @PluginMethod
  public void setAlarm(PluginCall call) {
    Integer hour = call.getInt("hour");
    Integer minute = call.getInt("minute");
    if (hour == null || minute == null || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      call.reject("闹钟时间无效");
      return;
    }
    String message = call.getString("message", "");

    Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM);
    intent.putExtra(AlarmClock.EXTRA_HOUR, hour);
    intent.putExtra(AlarmClock.EXTRA_MINUTES, minute);
    if (message != null && !message.isEmpty()) {
      intent.putExtra(AlarmClock.EXTRA_MESSAGE, message);
    }
    if (Boolean.TRUE.equals(call.getBoolean("daily", false))) {
      intent.putIntegerArrayListExtra(AlarmClock.EXTRA_DAYS, new ArrayList<>(Arrays.asList(
          Calendar.SUNDAY, Calendar.MONDAY, Calendar.TUESDAY, Calendar.WEDNESDAY,
          Calendar.THURSDAY, Calendar.FRIDAY, Calendar.SATURDAY)));
    }
    intent.putExtra(AlarmClock.EXTRA_SKIP_UI, true);

    try {
      getActivity().startActivity(intent);
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("这台手机没有可用的时钟 App：" + e.getMessage());
    }
  }
}
