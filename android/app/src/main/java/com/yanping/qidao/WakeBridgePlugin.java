package com.yanping.qidao;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Iterator;
import java.util.Map;

/**
 * 「他主动找你」的**配置抽屉**。
 *
 * 用户的原话："不是 app 问哎吗" —— 对，**问 AI 的是后台那段 JS**（系统叫醒它，
 * 不需要界面、App 关着也在）。但安卓不允许"网页那边"直接往"后台那段 JS 的存储"里写东西，
 * 所以需要这个很小的抽屉：
 *
 *     前台（界面／App 打开时）──把要用的东西放进抽屉──▶ 抽屉（SharedPreferences）
 *                                                          ▲
 *                                        后台那段 JS 醒来时自己去拿 ──┘
 *
 * ── 抽屉里放什么（都是 App 每次变化时推过来的）────────────────────
 *   · `cfg_base_url` / `cfg_api_key` / `cfg_model` —— 你的上游（**直接问它，不经过 Worker**）
 *   · `cfg_prompt_0`…`cfg_prompt_4` —— 五段指令（对应程度 0/25/50/75/100），
 *     里面带 `{{TIME}}` 这种占位符，由后台在**醒来那一刻**替换成当前时间
 *   · `cfg_ai_name` / `cfg_enabled` / `cfg_quiet_start` / `cfg_quiet_end`
 *
 * ⚠️ **关键：抽屉的名字必须跟后台那段 JS 用的是同一个**。
 * 插件那边（`@capacitor/background-runner` 的 `CapacitorKV`）用的是
 * `context.getSharedPreferences(label, MODE_PRIVATE)`，而 `label` 就是
 * `capacitor.config.ts` 里 `plugins.BackgroundRunner.label` 的值 ——
 * 所以下面 `PREFS` 必须跟它**一字不差**，改一个字母两边就谁也见不到谁（而且不报错）。
 *
 * ⚠️ 为什么不用插件的 `dispatchEvent` 直接推：那个方法在安卓侧用 `runBlocking`
 * 挡主线程、再无限期等回调，**会让整个 App 卡死**（真机踩过）。见 `lib/wake-sync.ts`。
 */
@CapacitorPlugin(name = "WakeBridge")
public class WakeBridgePlugin extends Plugin {

  /** ⚠️ 必须与 `capacitor.config.ts` 里 `plugins.BackgroundRunner.label` 完全一致 */
  private static final String PREFS = "com.yanping.qidao.wake";

  /** 把一批「键 → 值」写进抽屉（值统一按字符串存，后台那边读的也是字符串） */
  @PluginMethod
  public void put(PluginCall call) {
    JSObject data = call.getObject("data");
    if (data == null) {
      call.reject("缺少 data");
      return;
    }
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    SharedPreferences.Editor editor = prefs.edit();
    Iterator<String> keys = data.keys();
    while (keys.hasNext()) {
      String key = keys.next();
      Object value = data.opt(key);
      editor.putString(key, value == null ? "" : String.valueOf(value));
    }
    editor.apply();

    JSObject ret = new JSObject();
    ret.put("ok", true);
    call.resolve(ret);
  }

  /** 读回来（自检 / 排查用：能看出"到底写进去了没有"） */
  @PluginMethod
  public void get(PluginCall call) {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    JSObject ret = new JSObject();
    for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
      Object v = entry.getValue();
      // 密钥只报"有没有"，不回显内容（跟 Worker 那边一条纪律）
      if (entry.getKey().contains("api_key")) {
        ret.put(entry.getKey(), v == null || String.valueOf(v).isEmpty() ? "" : "已设置");
      } else {
        ret.put(entry.getKey(), v == null ? "" : String.valueOf(v));
      }
    }
    call.resolve(ret);
  }

  /** 清空抽屉（"忘掉这些"；也用于排查） */
  @PluginMethod
  public void clear(PluginCall call) {
    getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    JSObject ret = new JSObject();
    ret.put("ok", true);
    call.resolve(ret);
  }
}
