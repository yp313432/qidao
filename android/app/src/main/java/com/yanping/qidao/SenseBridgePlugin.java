package com.yanping.qidao;

import android.app.AppOpsManager;
import android.app.KeyguardManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.Process;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * **「看一眼系统状态」的原生入口** —— 跟 `src/lib/sense-bridge.ts`（JS 侧）
 * 和 `src/lib/sense-core.ts`（措辞与判定）配对。
 *
 * 用户的原话："我给开他那么多权限，其实是希望他**主动的去用**。"
 * 所以这个插件只做**读**（零副作用），每个方法都对应 JS 那边一个感知动作：
 *
 *   device()        电量 / 充电 / 网络类型      ← sense.device（不需要权限）
 *   screen()        屏幕亮不亮、锁没锁          ← sense.screen（不需要权限）
 *   notifications() 最近几条通知                ← sense.notifications（要「通知使用权」）
 *   foreground()    当前前台是哪个 App          ← sense.foreground（要「使用情况访问」）
 *   （`sense.time` 和 `sense.place` 不走这里：一个纯 JS 就能算，
 *     一个复用现成的定位 + 和风那一套。）
 *
 * ── 两条纪律（这一层最容易犯的错）──────────────────────────────
 *
 * 1. **权限没给不是"报错"，是"如实回答"**：返回 `granted:false` + 一句
 *    人话原因，让 JS 那边照 `sense-core.ts` 里那份设置页路径转告用户。
 *    ⛔ 不许 `call.reject("失败")` —— 那句到了模型手里就成了"我做不到"，
 *    而用户需要知道的是**去哪个开关**（通知使用权 / 使用情况访问）。
 *
 * 2. **读不到就别编**：电量拿不到就**不写**这个键（JS 那边当 null 处理），
 *    不许填 0 / 100 这种看着像真数据的假值。
 */
@CapacitorPlugin(name = "SenseBridge")
public class SenseBridgePlugin extends Plugin {

  /* ─────────────────────── 1. 电量 / 充电 / 网络 ─────────────────────── */

  @PluginMethod
  public void device(PluginCall call) {
    Context ctx = getContext();
    JSObject ret = new JSObject();

    // 电量百分比（BATTERY_PROPERTY_CAPACITY 直接给 0~100）
    try {
      BatteryManager bm = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
      if (bm != null) {
        int pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        // 拿不到时安卓给的是 Integer.MIN_VALUE / 负数 —— 那就**不写这个键**，别编 0
        if (pct >= 0 && pct <= 100) ret.put("battery", pct);
      }
    } catch (Exception ignored) {
      /* 读不到就不写，JS 那边当 null */
    }

    // 充没充电：粘性广播（registerReceiver(null, ...) 只查当前值，不注册监听）
    try {
      Intent batt = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
      if (batt != null) {
        int status = batt.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        ret.put(
            "charging",
            status == BatteryManager.BATTERY_STATUS_CHARGING
                || status == BatteryManager.BATTERY_STATUS_FULL);
      }
    } catch (Exception ignored) {
      /* 同上 */
    }

    // 网络类型：有网才谈得上类型；没网就明说"none"
    String network = "none";
    boolean online = false;
    try {
      ConnectivityManager cm =
          (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
      if (cm != null) {
        NetworkCapabilities caps = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          Network active = cm.getActiveNetwork();
          if (active != null) caps = cm.getNetworkCapabilities(active);
        }
        if (caps != null) {
          online = true;
          if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) network = "wifi";
          else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) network = "cellular";
          else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) network = "ethernet";
          else network = "unknown";
        }
      }
    } catch (Exception ignored) {
      network = "unknown";
    }
    ret.put("network", network);
    ret.put("online", online);

    call.resolve(ret);
  }

  /* ───────────────────────── 2. 屏幕亮没亮 ───────────────────────── */

  @PluginMethod
  public void screen(PluginCall call) {
    Context ctx = getContext();
    JSObject ret = new JSObject();
    boolean interactive = false;
    boolean locked = false;
    try {
      PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
      // isInteractive() = 屏幕亮着且设备醒着（不需要任何权限）
      if (pm != null) interactive = pm.isInteractive();
    } catch (Exception ignored) {
      /* 读不到就当"黑着"，JS 那边会如实说 */
    }
    try {
      KeyguardManager km = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);
      if (km != null) locked = km.isKeyguardLocked();
    } catch (Exception ignored) {
      /* 同上 */
    }
    ret.put("interactive", interactive);
    ret.put("locked", locked);
    call.resolve(ret);
  }

  /* ─────────────────────── 3. 最近几条通知 ─────────────────────── */

  @PluginMethod
  public void notifications(PluginCall call) {
    JSObject ret = new JSObject();
    if (!notificationAccessGranted()) {
      // ⚠️ 不 reject：让 JS 那边照 sense-core 的措辞告诉用户去哪个设置页开
      ret.put("granted", false);
      ret.put("reason", "还没打开「通知使用权」");
      call.resolve(ret);
      return;
    }
    ret.put("granted", true);

    JSArray items = new JSArray();
    long now = System.currentTimeMillis();
    JSONArray cached = QidaoNotificationListener.recentJson();
    for (int i = 0; i < cached.length(); i++) {
      JSONObject o = cached.optJSONObject(i);
      if (o == null) continue;
      JSObject item = new JSObject();
      item.put("app", o.optString("app"));
      item.put("title", o.optString("title"));
      item.put("text", o.optString("text"));
      item.put("minutesAgo", Math.max(0, (now - o.optLong("at", now)) / 60000L));
      items.put(item);
    }
    ret.put("items", items);
    call.resolve(ret);
  }

  /**
   * 「通知使用权」给了没有？
   *
   * 直接读系统那份名单（`enabled_notification_listeners`），**不引 androidx**：
   * 这是一个稳定且公开的 Settings.Secure 键，格式是
   * `包名/服务类名:包名/服务类名`。名单里有我们就算给了。
   */
  private boolean notificationAccessGranted() {
    try {
      String flat =
          Settings.Secure.getString(
              getContext().getContentResolver(), "enabled_notification_listeners");
      if (flat == null || flat.isEmpty()) return false;
      return flat.contains(getContext().getPackageName());
    } catch (Exception e) {
      return false;
    }
  }

  /* ──────────────────── 4. 前台是哪个 App ──────────────────── */

  @PluginMethod
  public void foreground(PluginCall call) {
    JSObject ret = new JSObject();
    if (!usageAccessGranted()) {
      ret.put("granted", false);
      ret.put("reason", "还没打开「使用情况访问」");
      call.resolve(ret);
      return;
    }
    ret.put("granted", true);

    String pkg = currentForegroundPackage();
    if (pkg == null) {
      // 权限给了、但系统这次没给出答案（刚开机 / 刚从后台回来）—— 如实说
      ret.put("reason", "系统这次没给出当前应用");
      call.resolve(ret);
      return;
    }
    ret.put("package", pkg);
    ret.put("app", appLabel(pkg));
    call.resolve(ret);
  }

  /**
   * 「使用情况访问」给了没有？
   *
   * 这是**特殊权限**（不在运行时权限弹窗里，要去
   * 设置 → 应用 → 特殊应用权限 → 使用情况访问 打勾），
   * 所以只能问 AppOps。
   */
  private boolean usageAccessGranted() {
    try {
      AppOpsManager ops =
          (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
      if (ops == null) return false;
      String pkg = getContext().getPackageName();
      int uid = Process.myUid();
      int mode;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, uid, pkg);
      } else {
        mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, uid, pkg);
      }
      return mode == AppOpsManager.MODE_ALLOWED;
    } catch (Exception e) {
      return false;
    }
  }

  /**
   * 当前前台包名。
   *
   * 安卓**没有**"给我当前前台应用"的公开 API（那是系统自己的事），
   * 通行做法是查最近这段时间里 `lastTimeUsed` 最新的那个 —— 也是"使用情况访问"
   * 这项权限存在的意义。太旧（5 分钟前）就当没答案，免得报"你正在用相机"
   * 而其实是五分钟前用过。
   */
  private String currentForegroundPackage() {
    try {
      UsageStatsManager usm =
          (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
      if (usm == null) return null;
      long now = System.currentTimeMillis();
      List<UsageStats> stats =
          usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 10 * 60 * 1000L, now);
      if (stats == null || stats.isEmpty()) return null;

      String best = null;
      long bestAt = 0;
      for (UsageStats s : stats) {
        if (s == null) continue;
        if (s.getLastTimeUsed() > bestAt) {
          bestAt = s.getLastTimeUsed();
          best = s.getPackageName();
        }
      }
      if (best == null) return null;
      // 太旧的不算（5 分钟）—— 宁可说"没给出"，也别报一个过时的
      if (now - bestAt > 5 * 60 * 1000L) return null;
      return best;
    } catch (Exception e) {
      return null;
    }
  }

  /** 包名 → 应用名（拿不到就退回包名，别编） */
  private String appLabel(String pkg) {
    try {
      PackageManager pm = getContext().getPackageManager();
      return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
    } catch (Exception e) {
      return pkg;
    }
  }
}
