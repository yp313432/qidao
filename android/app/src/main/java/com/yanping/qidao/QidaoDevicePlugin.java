package com.yanping.qidao;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.CalendarContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * **零权限层**：不需要任何特殊权限就能做到的那些"动作"（2026-11，用户 m05769）。
 *
 * 这一层和 `SenseBridgePlugin`（只看不动）是互补的：
 *   · SenseBridge = 读：电量、网络、通知、前台 App、使用情况
 *   · QidaoDevice = 动：开 App、分享、剪贴板、导航、日历
 *
 * 为什么这些能"零权限"：它们全都是**把请求交给系统做**（Intent），
 * 由系统弹自己的界面让用户确认。栖岛自己既没偷读别人的数据，也没代用户点确认。
 * 所以：
 *   · `openApp` 走 `getLaunchIntentForPackage`，就是"点了一下桌面图标"
 *   · `share` 走 `ACTION_SEND` 系统分享面板，发不发、发给谁由用户当场定
 *   · `addCalendar` 走 `ACTION_INSERT` 日历编辑页，用户看到内容自己按保存
 *   · `openMap` 走 `geo:` 协议，交给用户装的地图 App（高德/百度/Google 都认）
 *   · 剪贴板读写在**前台**才允许（Android 10+ 限制后台读，这是系统的规矩）
 *
 * ⚠️ 与"无障碍 / Shizuku"那两层的分界线：这一层**不能**点别人 App 里的按钮、
 * 也读不到别人 App 的字。想做到那些，得要无障碍或 Shizuku（P2b / P2c，另做）。
 */
@CapacitorPlugin(name = "QidaoDevice")
public class QidaoDevicePlugin extends Plugin {

  /** 能打开的 App 上限：手机装上几百个 App 时，全列出来会把提示词撑爆 */
  private static final int MAX_APPS = 120;

  /**
   * 列出"能打开的 App"（有桌面图标的那种）。
   *
   * 安卓 11+ 的包可见性：manifest 里已经声明了 MAIN/LAUNCHER 的 `<queries>`，
   * 所以这里查得到（这也是为什么没用 `QUERY_ALL_PACKAGES` 那种全量权限 —— 上架会被拒）。
   */
  @PluginMethod
  public void listApps(PluginCall call) {
    try {
      PackageManager pm = getContext().getPackageManager();
      Intent main = new Intent(Intent.ACTION_MAIN, null);
      main.addCategory(Intent.CATEGORY_LAUNCHER);
      List<ResolveInfo> list = pm.queryIntentActivities(main, 0);

      List<JSObject> out = new ArrayList<>();
      String self = getContext().getPackageName();
      for (ResolveInfo ri : list) {
        if (ri.activityInfo == null) continue;
        String pkg = ri.activityInfo.packageName;
        if (pkg == null || pkg.equals(self)) continue; /* 别把自己列进去（已经在眼前了） */
        String label = String.valueOf(ri.loadLabel(pm));
        JSObject o = new JSObject();
        o.put("pkg", pkg);
        o.put("label", label);
        out.add(o);
      }
      out.sort(Comparator.comparing(a -> String.valueOf(a.optString("label", "")), java.text.Collator.getInstance(Locale.CHINA)));

      JSArray arr = new JSArray();
      for (int i = 0; i < out.size() && i < MAX_APPS; i += 1) arr.put(out.get(i));

      JSObject ret = new JSObject();
      ret.put("ok", true);
      ret.put("apps", arr);
      ret.put("total", out.size());
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("列不出应用列表：" + e.getMessage());
    }
  }

  /**
   * 打开一个 App。
   *
   * 匹配顺序：包名完全一致 → 名字完全一致（忽略大小写与空格）→ 名字包含。
   * 都不中就把候选名字带回去，让模型知道"应该改成哪个"，而不是干瞪眼。
   */
  @PluginMethod
  public void openApp(PluginCall call) {
    String query = call.getString("query", "");
    if (query == null) query = "";
    query = query.trim();
    if (query.isEmpty()) {
      call.reject("没说打开哪个 App");
      return;
    }
    try {
      PackageManager pm = getContext().getPackageManager();

      /* ① 先按包名试（用户/模型直接给 com.tencent.mm 的情况） */
      Intent byPkg = pm.getLaunchIntentForPackage(query);
      if (byPkg != null) {
        JSObject r = launch(byPkg);
        if (r != null) {
          r.put("pkg", query);
          r.put("label", appLabel(pm, query));
          call.resolve(r);
          return;
        }
      }

      /* ② 再按名字试 */
      Intent main = new Intent(Intent.ACTION_MAIN, null);
      main.addCategory(Intent.CATEGORY_LAUNCHER);
      List<ResolveInfo> list = pm.queryIntentActivities(main, 0);
      String want = query.toLowerCase(Locale.ROOT).replace(" ", "");
      String self = getContext().getPackageName();

      String exactPkg = null;
      String containsPkg = null;
      JSArray candidates = new JSArray();
      for (ResolveInfo ri : list) {
        if (ri.activityInfo == null) continue;
        String pkg = ri.activityInfo.packageName;
        if (pkg == null || pkg.equals(self)) continue;
        String label = String.valueOf(ri.loadLabel(pm));
        String norm = label.toLowerCase(Locale.ROOT).replace(" ", "");
        if (norm.equals(want) && exactPkg == null) exactPkg = pkg;
        else if (exactPkg == null && containsPkg == null && (norm.contains(want) || want.contains(norm))) {
          containsPkg = pkg;
        }
        if ((norm.contains(want) || want.contains(norm)) && candidates.length() < 8) candidates.put(label);
      }

      String target = exactPkg != null ? exactPkg : containsPkg;
      if (target != null) {
        Intent it = pm.getLaunchIntentForPackage(target);
        JSObject r = it == null ? null : launch(it);
        if (r != null) {
          r.put("pkg", target);
          r.put("label", appLabel(pm, target));
          call.resolve(r);
          return;
        }
      }

      JSObject ret = new JSObject();
      ret.put("ok", false);
      ret.put("reason", "没找到这个 App");
      ret.put("candidates", candidates);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("打开 App 出错：" + e.getMessage());
    }
  }

  /** 系统分享面板：文本 / 链接都可以，发给谁由用户当场决定 */
  @PluginMethod
  public void share(PluginCall call) {
    String text = call.getString("text", "");
    String title = call.getString("title", null);
    if (text == null || text.trim().isEmpty()) {
      call.reject("没有要分享的内容");
      return;
    }
    try {
      Intent send = new Intent(Intent.ACTION_SEND);
      send.setType("text/plain");
      send.putExtra(Intent.EXTRA_TEXT, text);
      if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);

      Intent chooser = Intent.createChooser(send, title == null || title.isEmpty() ? "分享到" : title);
      chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(chooser);

      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("没能打开分享面板：" + e.getMessage());
    }
  }

  /** 打开链接（系统浏览器 / 对应 App 的 App Links） */
  @PluginMethod
  public void openUrl(PluginCall call) {
    String url = call.getString("url", "");
    if (url == null || url.trim().isEmpty()) {
      call.reject("没有链接");
      return;
    }
    try {
      Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()));
      view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(view);
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("打不开这个链接：" + e.getMessage());
    }
  }

  /**
   * 交给地图 App 导航 / 搜索。
   *
   * 有坐标就用 `geo:lat,lng?q=名字`，没有就 `geo:0,0?q=地点名` —— 这两种写法
   * 高德/百度/Google/系统地图都认（系统会弹"用哪个打开"）。
   */
  @PluginMethod
  public void openMap(PluginCall call) {
    String query = call.getString("query", "");
    Double lat = call.getDouble("lat");
    Double lng = call.getDouble("lng");
    if ((query == null || query.trim().isEmpty()) && (lat == null || lng == null)) {
      call.reject("没说要导航去哪");
      return;
    }
    try {
      String q = query == null ? "" : query.trim();
      String uri;
      if (lat != null && lng != null) {
        uri = "geo:" + lat + "," + lng + (q.isEmpty() ? "" : "?q=" + Uri.encode(q));
      } else {
        uri = "geo:0,0?q=" + Uri.encode(q);
      }
      Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
      view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(view);
      JSObject ret = new JSObject();
      ret.put("ok", true);
      ret.put("uri", uri);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("没能打开地图：" + e.getMessage());
    }
  }

  /**
   * 写日历：**不是**偷偷写进你的日历，而是打开系统的新建日程页把内容填好，
   * 你看一眼按保存才真的进日历（`ACTION_INSERT` 的语义就是这样）。
   */
  @PluginMethod
  public void addCalendar(PluginCall call) {
    String title = call.getString("title", "");
    String begin = call.getString("begin", null); /* ISO 8601，如 2026-11-08T07:30:00 */
    String end = call.getString("end", null);
    Boolean allDay = call.getBoolean("allDay", false);
    String location = call.getString("location", null);
    String notes = call.getString("notes", null);

    if (title == null || title.trim().isEmpty()) {
      call.reject("日程没有标题");
      return;
    }
    long startMs;
    long endMs;
    try {
      startMs = begin == null ? System.currentTimeMillis() : parseIso(begin);
      endMs = end == null ? startMs + 60 * 60 * 1000L : parseIso(end);
    } catch (Exception e) {
      call.reject("时间格式看不懂（要 2026-11-08T07:30:00 这样）：" + e.getMessage());
      return;
    }
    try {
      Intent insert = new Intent(Intent.ACTION_INSERT);
      insert.setData(CalendarContract.Events.CONTENT_URI);
      insert.putExtra(CalendarContract.Events.TITLE, title.trim());
      insert.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startMs);
      insert.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs);
      if (allDay != null && allDay) insert.putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true);
      if (location != null && !location.isEmpty()) insert.putExtra(CalendarContract.Events.EVENT_LOCATION, location);
      if (notes != null && !notes.isEmpty()) insert.putExtra(CalendarContract.Events.DESCRIPTION, notes);
      insert.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(insert);

      JSObject ret = new JSObject();
      ret.put("ok", true);
      ret.put("begin", startMs);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("没能打开日历：" + e.getMessage());
    }
  }

  /** 读剪贴板（Android 10+ 只有前台能读，这是系统规矩，不是我们的限制） */
  @PluginMethod
  public void clipboardRead(PluginCall call) {
    try {
      ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
      JSObject ret = new JSObject();
      if (cm == null || !cm.hasPrimaryClip()) {
        ret.put("ok", true);
        ret.put("text", "");
        call.resolve(ret);
        return;
      }
      ClipData clip = cm.getPrimaryClip();
      StringBuilder sb = new StringBuilder();
      if (clip != null) {
        for (int i = 0; i < clip.getItemCount(); i += 1) {
          CharSequence t = clip.getItemAt(i).coerceToText(getContext());
          if (t != null) sb.append(t);
        }
      }
      ret.put("ok", true);
      ret.put("text", sb.toString());
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("读不到剪贴板：" + e.getMessage());
    }
  }

  @PluginMethod
  public void clipboardWrite(PluginCall call) {
    String text = call.getString("text", "");
    if (text == null) text = "";
    try {
      ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
      if (cm == null) {
        call.reject("这台设备没有剪贴板");
        return;
      }
      cm.setPrimaryClip(ClipData.newPlainText("栖岛", text));
      call.resolve(new JSObject().put("ok", true));
    } catch (Exception e) {
      call.reject("写不进剪贴板：" + e.getMessage());
    }
  }

  /* ───────────── 内部 ───────────── */

  private JSObject launch(Intent it) {
    try {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(it);
      return new JSObject().put("ok", true);
    } catch (Exception e) {
      return null;
    }
  }

  private String appLabel(PackageManager pm, String pkg) {
    try {
      return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
    } catch (Exception e) {
      return pkg;
    }
  }

  /** ISO 8601（不带时区的当本机时区，带 Z 的当 UTC）—— 与前端 `datetime` 的写法对齐 */
  private long parseIso(String s) throws Exception {
    String v = s.trim();
    if (v.endsWith("Z")) {
      SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
      f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
      return f.parse(v.substring(0, v.length() - 1)).getTime();
    }
    SimpleDateFormat f = new SimpleDateFormat(v.length() <= 10 ? "yyyy-MM-dd" : "yyyy-MM-dd'T'HH:mm:ss", Locale.US);
    Date d = f.parse(v);
    if (d == null) throw new Exception("空时间");
    return d.getTime();
  }
}
