package com.yanping.qidao;

import android.content.Intent;
import android.provider.AlarmClock;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 把闹钟交给**手机自带的时钟 App**。
 *
 * 为什么不只用我们自己的全屏响铃：系统闹钟是唯一"连省电模式都拦不住"的东西，
 * 响铃界面、贪睡、关机重开都由系统管，比 WebView 里可靠得多。
 * 这个插件只做一件事：发一个 ACTION_SET_ALARM，把闹钟塞进系统时钟。
 *
 * 用户的原话就是想要这个："能调系统闹钟……这样给权限就行，简单点。"
 */
@CapacitorPlugin(name = "SystemAlarm")
public class SystemAlarmPlugin extends Plugin {

  @PluginMethod
  public void setAlarm(PluginCall call) {
    Integer hour = call.getInt("hour");
    Integer minute = call.getInt("minute");
    if (hour == null || minute == null) {
      call.reject("缺少 hour / minute");
      return;
    }
    String message = call.getString("message", "");

    Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM);
    intent.putExtra(AlarmClock.EXTRA_HOUR, hour);
    intent.putExtra(AlarmClock.EXTRA_MINUTES, minute);
    if (message != null && !message.isEmpty()) {
      intent.putExtra(AlarmClock.EXTRA_MESSAGE, message);
    }
    // 不弹系统那个确认界面：用户已经在我们这边点过一次了
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
