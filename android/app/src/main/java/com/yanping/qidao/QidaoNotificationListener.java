package com.yanping.qidao;

import android.app.Notification;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * **「最近几条通知」的收信箱** —— 跟 `SenseBridgePlugin` 配对。
 *
 * 为什么必须是一个 Service：安卓**不允许**普通应用"去系统里翻通知"。
 * 唯一合法的通道是用户亲手在
 *   设置 → 应用 → 特殊应用权限 → 通知使用权
 * 里给栖岛打勾；打勾之后系统会把**新来的通知**推给我们这个 Service
 * （`onNotificationPosted`）。所以我们能做的只有一件事：
 * **把它推过来的攒起来**，等 AI 调 `sense.notifications` 时由插件读走。
 *
 * ── 三条纪律 ────────────────────────────────────────────────
 *   1. **只留最近 12 条**（`MAX`）：这是"看一眼"的料，不是归档。
 *      用户问"我刚才收到什么了"够用；攒多了既占内存又像监控。
 *   2. **不记栖岛自己发的通知**（否则"最近通知"里全是我们自己的提醒）。
 *   3. 权限没给时**这个类根本不会被实例化** —— 所以"有没有权限"由插件那边
 *      去问系统（见 `SenseBridgePlugin.notificationAccessGranted()`），
 *      这里不做判断、也不假装成功。
 *
 * ⚠️ 缓存是**静态的**（进程内共享）：`NotificationListenerService` 由系统绑定，
 *    跟 Activity 不是同一个生命周期，用实例字段插件那边读不到。
 */
public class QidaoNotificationListener extends NotificationListenerService {

  /** 最多留几条（"看一眼"的料，不是归档） */
  private static final int MAX = 12;

  /** 新的在前（`onNotificationPosted` 里 addFirst） */
  private static final Deque<JSONObject> RECENT = new ArrayDeque<>();

  private static final Object LOCK = new Object();

  /**
   * 系统**一共回调过我们几次** + 最后一次是什么时候。
   *
   * 为什么单独记这个：用户 2026-11 真机实测"权限开了却还说没开"。
   * 「名单里有我们」和「服务真被绑定了」是**两件事** ——
   * 只记下攒下来的条目分不清它们（没收到通知也可能是这阵子真没通知），
   * 而**回调次数**能：一次都没回调过 = 服务压根没被绑上，那是另一种问题。
   */
  private static int CALLBACKS = 0;
  private static long LAST_CALLBACK_AT = 0L;

  @Override
  public void onNotificationPosted(StatusBarNotification sbn) {
    synchronized (LOCK) {
      CALLBACKS += 1;
      LAST_CALLBACK_AT = System.currentTimeMillis();
    }
    if (sbn == null || sbn.getNotification() == null) return;
    // 自己的通知不记（不然"最近通知"里全是我们自己的提醒和定时任务）
    if (getPackageName().equals(sbn.getPackageName())) return;

    Notification n = sbn.getNotification();
    Bundle extras = n.extras;
    CharSequence title = extras == null ? null : extras.getCharSequence(Notification.EXTRA_TITLE);
    CharSequence text = extras == null ? null : extras.getCharSequence(Notification.EXTRA_TEXT);
    // 标题正文都没有的通知（纯图标那种）就别占位置了
    if ((title == null || title.length() == 0) && (text == null || text.length() == 0)) return;

    JSONObject item = new JSONObject();
    try {
      item.put("package", sbn.getPackageName());
      item.put("app", appLabel(sbn.getPackageName()));
      item.put("title", title == null ? "" : title.toString());
      item.put("text", text == null ? "" : text.toString());
      // 系统给的投递时间（插件那边拿它算"几分钟前"）
      item.put("at", sbn.getPostTime());
    } catch (Exception e) {
      return;
    }

    synchronized (LOCK) {
      RECENT.addFirst(item);
      while (RECENT.size() > MAX) RECENT.removeLast();
    }
  }

  /** 插件那边读它（同进程内直接调静态方法，不走任何 IPC） */
  static JSONArray recentJson() {
    JSONArray out = new JSONArray();
    synchronized (LOCK) {
      for (JSONObject o : RECENT) out.put(o);
    }
    return out;
  }

  /** 手滑清了缓存时用（目前没有界面入口，留给排查） */
  static void clear() {
    synchronized (LOCK) {
      RECENT.clear();
    }
  }

  /** 系统回调过几次（0 = 服务没被绑定，跟"这阵子没通知"是两件事）—— 自检用 */
  static int callbackCount() {
    synchronized (LOCK) {
      return CALLBACKS;
    }
  }

  /** 最后一次回调的时刻（0 = 从来没有）—— 自检用 */
  static long lastCallbackAt() {
    synchronized (LOCK) {
      return LAST_CALLBACK_AT;
    }
  }

  /**
   * 包名 → 应用名。
   *
   * ⚠️ 安卓 11+ 有**包可见性**限制：没在 manifest 里声明过的应用，这里会抛
   * `NameNotFoundException`。抛了就**退回包名**（比如 `com.tencent.mm`）——
   * 难看，但那是真的，比编一个"微信"出来强（要好看得在 manifest 里加
   * queries / QUERY_ALL_PACKAGES，见交付说明里的清单）。
   */
  private String appLabel(String pkg) {
    try {
      PackageManager pm = getPackageManager();
      return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
    } catch (Exception e) {
      return pkg;
    }
  }
}
