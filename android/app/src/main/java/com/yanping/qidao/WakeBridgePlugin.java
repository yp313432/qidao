package com.yanping.qidao;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

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

    /**
     * 配置一到就**重排一次闹钟** —— 用户改完设置（开/关、日记时间、安静时段）不用再等
     * 下一次整点才生效。上游不齐时不排（排了也只会白醒一次）。
     */
    try {
      boolean enabled = "1".equals(WakePrefs.str(getContext(), WakePrefs.ENABLED));
      boolean hasUpstream = !WakePrefs.str(getContext(), WakePrefs.BASE_URL).trim().isEmpty()
          && !WakePrefs.str(getContext(), WakePrefs.API_KEY).trim().isEmpty();
      if (enabled && hasUpstream) {
        WakeAlarm.schedule(getContext());
      } else {
        WakeAlarm.cancel(getContext());
      }
    } catch (Exception ignored) {
      /* 排不上不该让"写配置"失败 */
    }

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
    WakeAlarm.cancel(getContext());
    JSObject ret = new JSObject();
    ret.put("ok", true);
    call.resolve(ret);
  }

  /* ─────────────────────────────────────────────────────────────
   * 从这一批开始，**唤醒本体也搬到了原生**（`WakeService` + `WakeEngine`）。
   * 下面几个方法就是网页那一层需要的口子：
   *   · `ledger` / `ackLedger` —— 小本子（他在后台做过的事，等 App 打开补落库）
   *   · `schedule`             —— 网页指定下一次几点醒（不写就走原生自己的排班）
   *   · `status`               —— 设置页看一眼：排上了没有、上次什么时候醒的
   * ───────────────────────────────────────────────────────────── */

  /** 读小本子（返回 JSON 字符串，网页自己解析） */
  @PluginMethod
  public void ledger(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("entries", WakeLedger.dump(getContext()));
    ret.put("lastWakeMs", WakePrefs.numLong(getContext(), WakePrefs.LAST_WAKE_MS, 0));
    call.resolve(ret);
  }

  /** 网页说"这几条已经落进库了" → 从本子上划掉（传空数组 = 全清） */
  @PluginMethod
  public void ackLedger(PluginCall call) {
    JSONArray ids = new JSONArray();
    JSArray arr = call.getArray("ids");
    if (arr != null) {
      for (int i = 0; i < arr.length(); i++) {
        try {
          ids.put(arr.getLong(i));
        } catch (Exception ignored) {
          /* 单条坏的跳过 */
        }
      }
    }
    WakeLedger.ack(getContext(), ids);
    JSObject ret = new JSObject();
    ret.put("ok", true);
    ret.put("entries", WakeLedger.dump(getContext()));
    call.resolve(ret);
  }

  /** 网页指定下一次醒来的时刻（毫秒时间戳；0 = 交回原生自己排） */
  @PluginMethod
  public void schedule(PluginCall call) {
    Double at = call.getDouble("atMs");
    boolean ok;
    if (at == null || at <= 0) {
      ok = WakeAlarm.schedule(getContext()) > 0;
    } else {
      ok = WakeAlarm.scheduleAt(getContext(), at.longValue());
    }
    JSObject ret = new JSObject();
    ret.put("ok", ok);
    ret.put("nextAtMs", WakePrefs.numLong(getContext(), WakePrefs.NEXT_AT_MS, 0));
    call.resolve(ret);
  }

  /** 立刻醒一次（设置页那个"现在就叫醒他看看"） */
  @PluginMethod
  public void runNow(PluginCall call) {
    try {
      android.content.Intent svc = new android.content.Intent(getContext(), WakeService.class);
      svc.setAction(WakeService.ACTION_TICK);
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
        getContext().startForegroundService(svc);
      } else {
        getContext().startService(svc);
      }
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("起不来：" + e.getMessage());
    }
  }

  /** 排班状态（设置页展示 + 真机排查） */
  @PluginMethod
  public void status(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("nextAtMs", WakePrefs.numLong(getContext(), WakePrefs.NEXT_AT_MS, 0));
    ret.put("lastWakeMs", WakePrefs.numLong(getContext(), WakePrefs.LAST_WAKE_MS, 0));
    ret.put("wakeCount", WakePrefs.num(getContext(), WakePrefs.WAKE_COUNT, 0));
    ret.put("hasConfig", !WakePrefs.str(getContext(), WakePrefs.BASE_URL).trim().isEmpty()
        && !WakePrefs.str(getContext(), WakePrefs.API_KEY).trim().isEmpty());
    ret.put("ledgerSize", WakeLedger.dump(getContext()).length() > 2);
    call.resolve(ret);
  }
}
