package com.yanping.qidao;

import android.app.AppOpsManager;
import android.app.KeyguardManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.Process;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;

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
 *   diag()          上面那些权限的**原始事实**  ← 「环境自检」页（用户能截图发回来）
 *   openSettings()  一键跳到那个特殊权限页      ← 同上（那两级菜单各家 ROM 还不一样）
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

    /*
      ⚠️ 2026-11 补：**勾了权限 ≠ 服务绑上了**。
      真机上出现过"名字在名单里、服务一次都没被回调过"的状态 —— 那时权限检查会
      一路"通过"，但最近通知永远是空的，用户看到的就是"明明开了还是不行"。
      所以这里发现"从没回调过"就**主动请系统重绑一次**（官方口子，已绑时是空操作）。
    */
    if (QidaoNotificationListener.callbackCount() == 0) requestListenerRebind();

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
   * `包名/服务类名:包名/服务类名`。
   *
   * ⚠️ 2026-11 改：原来是 `flat.contains(包名)` —— 只要**字符串里出现过**包名就算给了。
   *    这有两个毛病：一是别的包名里恰好含我们的包名时会误判；二是它回答不了
   *    "到底有没有我们这一项"。现在按 `:` 拆开、逐项比对**包名那一段**，
   *    并把匹配到的那一项原样带出来（自检页要看它）。
   */
  private boolean notificationAccessGranted() {
    return listenerItemInList() != null;
  }

  /** 名单里属于我们的那一项（原样，如 `com.yanping.qidao/.QidaoNotificationListener`）；没有就 null */
  private String listenerItemInList() {
    try {
      String flat =
          Settings.Secure.getString(
              getContext().getContentResolver(), "enabled_notification_listeners");
      if (flat == null || flat.isEmpty()) return null;
      String me = getContext().getPackageName();
      for (String raw : flat.split(":")) {
        if (raw == null) continue;
        String one = raw.trim();
        if (one.isEmpty()) continue;
        int slash = one.indexOf('/');
        String pkg = slash > 0 ? one.substring(0, slash) : one;
        if (me.equals(pkg)) return one;
      }
      return null;
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * 请系统**重新绑定**一次通知监听服务。
   *
   * 为什么需要：真机上存在"名单里有我们、但服务从来没被回调过"的状态
   * （刚授权完 / 系统还没重绑 / 被省电策略掐掉）。那种情况下光有权限也收不到通知，
   * 而 `requestRebind` 是官方给的口子（服务本来就绑着时它是空操作）。
   */
  private void requestListenerRebind() {
    try {
      NotificationListenerService.requestRebind(
          new ComponentName(getContext(), QidaoNotificationListener.class));
    } catch (Exception ignored) {
      /* 个别 ROM 不给重绑 —— 那就只能如实报"还没绑上"，见 diag() */
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
    // 前台就是栖岛自己（用户正在跟我说话）—— 这时说"你在用栖岛"等于没说，
    // 标出来让 JS 那边说人话（sense-core 的 senseForeground）
    if (getContext().getPackageName().equals(pkg)) ret.put("self", true);
    call.resolve(ret);
  }

  /**
   * 「使用情况访问」给了没有？
   *
   * 这是**特殊权限**（不在运行时权限弹窗里，要去
   * 设置 → 应用 → 特殊应用权限 → 使用情况访问 打勾），
   * 所以只能问 AppOps。
   *
   * ⚠️ 但**不能只看那个数字**：有些 ROM（华为/荣耀这一类）用户明明已经在设置里给了，
   *    AppOps 仍然回 `MODE_DEFAULT` —— 只看它就会一辈子报"没授权"，
   *    而用户已经在设置里开过了（2026-11 真机实测撞到："我权限都打开了还是不行"）。
   *    所以补一句**实际能不能读到数据**：读得到就是给了（权限是手段，读得到才是目的）。
   */
  private boolean usageAccessGranted() {
    if (usageOpMode() == AppOpsManager.MODE_ALLOWED) return true;
    return usageStatsReadable();
  }

  /** AppOps 里 `GET_USAGE_STATS` 的**原始**模式（0=ALLOWED、3=DEFAULT、-1=问不到）—— 只给自检看 */
  private int usageOpMode() {
    try {
      AppOpsManager ops =
          (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
      if (ops == null) return -1;
      String pkg = getContext().getPackageName();
      int uid = Process.myUid();
      return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
          ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, uid, pkg)
          : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, uid, pkg);
    } catch (Exception e) {
      return -1;
    }
  }

  /** 真的读得到使用数据吗？（事件流或统计表任一个有东西就算） */
  private boolean usageStatsReadable() {
    try {
      UsageStatsManager usm =
          (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
      if (usm == null) return false;
      long now = System.currentTimeMillis();
      List<UsageStats> stats =
          usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 24 * 3600 * 1000L, now);
      if (stats != null && !stats.isEmpty()) return true;
      UsageEvents ev = usm.queryEvents(now - 5 * 60 * 1000L, now);
      return ev != null && ev.hasNextEvent();
    } catch (Exception e) {
      return false;
    }
  }

  /**
   * 当前前台包名。
   *
   * 安卓**没有**"给我当前前台应用"的公开 API（那是系统自己的事），
   * 通行做法是查使用情况 —— 也是这项权限存在的意义。
   *
   * ⚠️ 两条路，顺序不能反（2026-11 真机实测："系统这次没给出当前应用"）：
   *   ① **事件流**（`queryEvents` + `ACTIVITY_RESUMED`/`MOVE_TO_FOREGROUND`）——
   *      短时间窗里可靠；"我现在在用哪个 App"要的恰恰是短窗。
   *   ② 退回 `queryUsageStats`：它是**按天分桶**的，短窗经常直接返回空列表，
   *      所以只能当兜底，不能当主路。（原来只有 ②，于是经常"没答案"。）
   */
  private String currentForegroundPackage() {
    long now = System.currentTimeMillis();

    /* ① 事件流 */
    try {
      UsageStatsManager usm =
          (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
      if (usm != null) {
        UsageEvents events = usm.queryEvents(now - 15 * 60 * 1000L, now);
        if (events != null) {
          UsageEvents.Event e = new UsageEvents.Event();
          String best = null;
          long bestAt = 0;
          while (events.hasNextEvent()) {
            events.getNextEvent(e);
            if (!isForegroundEvent(e.getEventType())) continue;
            if (e.getTimeStamp() >= bestAt) {
              bestAt = e.getTimeStamp();
              best = e.getPackageName();
            }
          }
          // 太旧的不算（5 分钟）：宁可说"没给出"，也别报一个过时的
          if (best != null && now - bestAt <= 5 * 60 * 1000L) return best;
        }
      }
    } catch (Exception ignored) {
      /* 落到 ② */
    }

    /* ② 按使用时长统计（老办法，短窗可能为空） */
    try {
      UsageStatsManager usm =
          (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
      if (usm == null) return null;
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
      if (now - bestAt > 5 * 60 * 1000L) return null;
      return best;
    } catch (Exception e) {
      return null;
    }
  }

  /** 「有东西到前台了」的事件类型（API 29 起叫 ACTIVITY_RESUMED，之前叫 MOVE_TO_FOREGROUND） */
  private boolean isForegroundEvent(int type) {
    if (type == UsageEvents.Event.MOVE_TO_FOREGROUND) return true;
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
        && type == UsageEvents.Event.ACTIVITY_RESUMED;
  }

  /* ──────────────── 5. 自检：这两项特殊权限的原始事实 ──────────────── */

  /**
   * **把原始事实吐出来**（给「环境自检」页看）。
   *
   * 为什么必须有这一条：这两项都是**特殊权限**，不在普通权限弹窗里；
   * 真机上"我明明开了却说没开"的时候，靠猜永远猜不出来。这里交出去的是：
   *   · `listenersRaw` —— 系统那份**原始名单**（一个字没改）
   *   · `notifGranted` + `notifCallbacks` —— 名单里有我们、但服务**收到过几条**
   *     （收到 0 条 = 勾在那儿、服务没被绑定，那是**另一个**问题，不能混）
   *   · `usageOpMode` —— AppOps 的**原始数字**（0=ALLOWED 3=DEFAULT），不翻译
   *   · `usageReadable` —— 绕过 AppOps 直接问"到底读得到吗"
   *   · `foregroundPkg` —— 前台那条路这次给出的答案
   * 有了这些，一眼就能分清是哪一种，不用再来回猜。
   */
  @PluginMethod
  public void diag(PluginCall call) {
    Context ctx = getContext();
    JSObject ret = new JSObject();
    ret.put("package", ctx.getPackageName());
    ret.put("uid", Process.myUid());
    ret.put("sdk", Build.VERSION.SDK_INT);
    ret.put("device", Build.MANUFACTURER + " " + Build.MODEL);

    String flat = null;
    try {
      flat =
          Settings.Secure.getString(
              ctx.getContentResolver(), "enabled_notification_listeners");
    } catch (Exception ignored) {
      /* 读不到就当没有 */
    }
    ret.put("listenersRaw", flat == null ? "（这个键读不到）" : clip(flat, 300));
    ret.put("listenerItem", listenerItemInList() == null ? "（名单里没有我们）" : listenerItemInList());
    ret.put("notifGranted", notificationAccessGranted());
    ret.put("notifCallbacks", QidaoNotificationListener.callbackCount());
    ret.put("notifLastCallbackAt", QidaoNotificationListener.lastCallbackAt());
    try {
      ret.put(
          "listenerEnabled",
          ctx.getPackageManager()
              .getComponentEnabledSetting(new ComponentName(ctx, QidaoNotificationListener.class)));
    } catch (Exception ignored) {
      /* 问不到就不给这个键 */
    }

    ret.put("usageOpMode", usageOpMode());
    ret.put("usageReadable", usageStatsReadable());
    ret.put("usageGranted", usageAccessGranted());
    String fg = currentForegroundPackage();
    ret.put("foregroundPkg", fg == null ? "（系统没给出）" : fg);

    call.resolve(ret);
  }

  /**
   * **一键跳到那个特殊权限的设置页**。
   *
   * 用户原话（2026-11）："这个通知使用权我忘记他是干嘛要做了" ——
   * 连入口在哪都记不住，光给一句文字路径（"设置 → 应用 → 特殊应用权限 → …"）
   * 是不够的：各家 ROM 的层级还不一样。所以给个按钮直接跳。
   * 跳不过去（个别 ROM 没这个页面）就退回**应用详情页**，那里至少能到权限那一层。
   */
  @PluginMethod
  public void openSettings(PluginCall call) {
    JSObject ret = new JSObject();
    String which = call.getString("which", "");
    String action =
        "notifications".equals(which)
            ? Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
            : Settings.ACTION_USAGE_ACCESS_SETTINGS;
    try {
      Intent intent = new Intent(action);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      ret.put("ok", true);
      call.resolve(ret);
      return;
    } catch (Exception ignored) {
      /* 落到下面的兜底 */
    }
    try {
      Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
      fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
      fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(fallback);
      ret.put("ok", true);
      ret.put("fallback", true);
    } catch (Exception e) {
      ret.put("ok", false);
      ret.put("reason", "这台手机没有那个设置页：" + e.getMessage());
    }
    call.resolve(ret);
  }

  /** 截断长字符串（给自检看，别把整份名单塞进界面） */
  private static String clip(String s, int n) {
    if (s == null) return "";
    return s.length() > n ? s.substring(0, n) + "…" : s;
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
