package com.yanping.qidao;

import android.content.Context;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * **他醒来的那一次**（原生版，替代原来跑在 webview 外面的 `public/runners/wake.js`）。
 *
 * 用户拍板的边界（m02828）：
 *   · 叫醒、问模型、弹通知、记账 —— **全是原生**，App 关着也照做
 *   · 但落库（动态/日记/棋谱）在 WebView 的 IndexedDB 里，原生碰不到
 *     → 所以这里只把结果写进**小本子**（`WakeLedger`）和"交接键"（`wake_pending_*`），
 *       等 App 打开时网页那边补落库
 *
 * 一次醒来只做一件事，优先级：日记保底 > 自由活动 > 主动说话。
 * 这些判断都读 `WakePrefs` 里网页推过来的配置，原生**不猜**用户的设置。
 */
final class WakeEngine {

  private static final int MAX_REPLY_CHARS = 2000;

  /** 这次醒来干了什么（给日志和状态页看） */
  static final class Outcome {
    final String what;
    final boolean notified;
    final boolean accepted;

    Outcome(String what, boolean notified, boolean accepted) {
      this.what = what;
      this.notified = notified;
      this.accepted = accepted;
    }
  }

  private WakeEngine() {}

  /* ── 时间小工具 ──────────────────────────────────────────── */

  static String stamp(Date d) {
    return new SimpleDateFormat("M月d日 HH:mm", Locale.CHINA).format(d);
  }

  static String dayKey(Date d) {
    return new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(d);
  }

  /** 与 `public/runners/wake.js` 的 `dayStamp()` **一字不差**：不补零的 年-月-日 */
  static String jsDayKey(Date d) {
    Calendar c = Calendar.getInstance();
    c.setTime(d);
    return c.get(Calendar.YEAR) + "-" + (c.get(Calendar.MONTH) + 1) + "-" + c.get(Calendar.DAY_OF_MONTH);
  }

  /** 今天"他主动说话"的总条数 = 原生记的 + JS 那套记的（两边各算各的，取大的那个） */
  private static int spokeTodayTotal(Context ctx, Date now) {
    int mine = countToday(ctx, dayKey(now), "wake_said_count");
    String jsDay = jsDayKey(now);
    int js = jsDay.equals(WakePrefs.str(ctx, WakePrefs.SPOKE_DAY))
        ? WakePrefs.num(ctx, WakePrefs.SPOKE_DAY_COUNT, 0)
        : 0;
    return Math.max(mine, js);
  }

  private static int hourOf(Date d) {
    Calendar c = Calendar.getInstance();
    c.setTime(d);
    return c.get(Calendar.HOUR_OF_DAY);
  }

  private static int minuteOf(Date d) {
    Calendar c = Calendar.getInstance();
    c.setTime(d);
    return c.get(Calendar.MINUTE);
  }

  /** 现在是不是"安静时段"（跨午夜也认） */
  static boolean inQuiet(Context ctx, Date now) {
    int start = WakePrefs.num(ctx, WakePrefs.QUIET_START, 1);
    int end = WakePrefs.num(ctx, WakePrefs.QUIET_END, 8);
    int h = hourOf(now);
    if (start == end) return false;
    if (start < end) return h >= start && h < end;
    return h >= start || h < end;
  }

  /** "隔了多久"（分钟），文本用 */
  private static long elapsedMin(Context ctx, Date now) {
    long last = lastSpokeAt(ctx);
    if (last <= 0) last = WakePrefs.numLong(ctx, WakePrefs.LAST_WAKE_MS, 0);
    if (last <= 0) return -1;
    return Math.max(0, (now.getTime() - last) / 60000L);
  }

  /** 上一次"他开口"的时刻：原生记的 和 后台 JS 记的，取更近的那个（两边共用一本账） */
  private static long lastSpokeAt(Context ctx) {
    return Math.max(
        WakePrefs.numLong(ctx, WakePrefs.LAST_SAID_MS, 0),
        WakePrefs.numLong(ctx, WakePrefs.LAST_SPOKE_AT, 0));
  }

  private static String elapsedText(long min) {
    if (min < 0) return "不记得多久了";
    if (min < 60) return min + " 分钟";
    long h = min / 60;
    if (h < 24) return h + " 小时" + (min % 60 > 0 ? " " + (min % 60) + " 分钟" : "");
    return (h / 24) + " 天";
  }

  /* ── 今天做了几次（跨天自动归零） ───────────────────────── */

  private static int countToday(Context ctx, String dayKey, String counterKey) {
    String savedDay = WakePrefs.str(ctx, counterKey + "_day");
    if (!dayKey.equals(savedDay)) return 0;
    return WakePrefs.num(ctx, counterKey, 0);
  }

  private static void bumpToday(Context ctx, String dayKey, String counterKey) {
    int n = countToday(ctx, dayKey, counterKey) + 1;
    WakePrefs.put(ctx, counterKey + "_day", dayKey);
    WakePrefs.put(ctx, counterKey, String.valueOf(n));
  }

  /* ── 决定这次做什么 ─────────────────────────────────────── */

  /** 回来 null = 这次什么都不做（有原因，写进日志） */
  private static String decide(Context ctx, Date now) {
    if (!"1".equals(WakePrefs.str(ctx, WakePrefs.ENABLED))) return "没打开（或者还没接模型）";
    if (WakePrefs.numLong(ctx, WakePrefs.BUSY_UNTIL, 0) > now.getTime()) return "他说自己在忙";
    if (inQuiet(ctx, now)) return "安静时段";

    int gap = WakePrefs.num(ctx, WakePrefs.MIN_GAP_MIN, 40);
    /**
     * "离上次太近"要看**两边**：原生自己的 `wake_last_at_ms`（上一次醒来）和
     * 共用账里的 `last_spoke_at`（上一次真的开口，可能正是后台那段 JS 说的）。
     */
    long last = Math.max(
        WakePrefs.numLong(ctx, WakePrefs.LAST_WAKE_MS, 0),
        lastSpokeAt(ctx));
    if (last > 0 && (now.getTime() - last) < gap * 60000L) return "离上次太近";

    String today = dayKey(now);
    int max = WakePrefs.num(ctx, WakePrefs.DAILY_MAX, 8);
    if (spokeTodayTotal(ctx, now) >= max) return "今天说够了";

    /* ① 日记保底：20:30 之后、今天还没写 → 这一次就写日记 */
    boolean autonomy = "1".equals(WakePrefs.str(ctx, WakePrefs.AUTONOMY_ON));
    boolean diaryOn = "1".equals(WakePrefs.str(ctx, WakePrefs.ACTION_DIARY));
    int dh = WakePrefs.num(ctx, WakePrefs.ACTION_HOUR, 20);
    int dm = WakePrefs.num(ctx, WakePrefs.ACTION_MINUTE, 30);
    boolean pastSlot = hourOf(now) > dh || (hourOf(now) == dh && minuteOf(now) >= dm);
    boolean wroteToday = today.equals(WakePrefs.str(ctx, WakePrefs.ACTION_DAY));
    if (autonomy && diaryOn && pastSlot && !wroteToday) return "diary";

    /* ② 自由活动：不定时，命中就做（一天最多 freeMax 次） */
    boolean freeOn = "1".equals(WakePrefs.str(ctx, WakePrefs.ACTION_FREE));
    int freeMax = WakePrefs.num(ctx, "cfg_action_free_max", 1);
    int freePct = WakePrefs.num(ctx, "cfg_action_free_pct", 30);
    if (autonomy && freeOn && hourOf(now) >= 9 && hourOf(now) < 22
        && countToday(ctx, today, "wake_free_count") < Math.max(1, freeMax)
        && Math.random() * 100 < freePct) {
      return "free";
    }

    /* ③ 主动说话（原来的骰子：上一轮没说 → 这一轮必定开口） */
    return "say";
  }

  /* ── 问一次上游 ─────────────────────────────────────────── */

  private static String buildSystemPrompt(Context ctx, String mode, Date now) {
    if ("diary".equals(mode) || "free".equals(mode)) {
      String p = WakePrefs.str(ctx, WakePrefs.ACTION_PROMPT);
      if (!TextUtils.isEmpty(p)) return fill(p, ctx, now);
    }
    boolean force = WakePrefs.num(ctx, WakePrefs.SKIP_STREAK, 0) > 0;
    String p = WakePrefs.str(ctx, force ? WakePrefs.PROMPT_FORCE : WakePrefs.PROMPT_NORMAL);
    return fill(p, ctx, now);
  }

  /** 替换 `{{TIME}}` / `{{ELAPSED}}`（占位符由网页生成，时间只有醒来那一刻才知道） */
  private static String fill(String prompt, Context ctx, Date now) {
    String time = new SimpleDateFormat("M月d日 HH:mm", Locale.CHINA).format(now);
    String elapsed = elapsedText(elapsedMin(ctx, now));
    return prompt.replace("{{TIME}}", time).replace("{{ELAPSED}}", elapsed);
  }

  private static String postChat(String base, String key, String model, String systemPrompt) throws Exception {
    String url = base.replaceAll("/+$", "") + "/chat/completions";
    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
    conn.setRequestMethod("POST");
    conn.setConnectTimeout(15000);
    conn.setReadTimeout(45000);
    conn.setDoOutput(true);
    conn.setRequestProperty("Content-Type", "application/json");
    conn.setRequestProperty("Authorization", "Bearer " + key);

    JSONObject body = new JSONObject();
    body.put("model", model);
    body.put("stream", false);
    JSONArray messages = new JSONArray();
    JSONObject sys = new JSONObject();
    sys.put("role", "system");
    sys.put("content", systemPrompt);
    messages.put(sys);
    body.put("messages", messages);

    byte[] data = body.toString().getBytes("UTF-8");
    OutputStream os = conn.getOutputStream();
    os.write(data);
    os.flush();
    os.close();

    int code = conn.getResponseCode();
    InputStream in = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
    StringBuilder sb = new StringBuilder();
    if (in != null) {
      BufferedReader br = new BufferedReader(new InputStreamReader(in, "UTF-8"));
      String line;
      while ((line = br.readLine()) != null) {
        sb.append(line).append('\n');
        if (sb.length() > 200000) break;
      }
      br.close();
    }
    String raw = sb.toString();
    if (code < 200 || code >= 300) {
      throw new Exception("上游返回 " + code + "：" + raw.substring(0, Math.min(80, raw.length())));
    }
    return extractContent(raw);
  }

  /**
   * 从上游返回里抠正文。
   * 有的中转无视 `stream:false` 照样回 SSE → 这里两种都认（不然会当"没答上来"）。
   */
  private static String extractContent(String raw) throws Exception {
    String trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      JSONObject obj = new JSONObject(trimmed);
      JSONArray choices = obj.optJSONArray("choices");
      if (choices != null && choices.length() > 0) {
        JSONObject c0 = choices.optJSONObject(0);
        if (c0 != null) {
          JSONObject msg = c0.optJSONObject("message");
          if (msg != null) return msg.optString("content", "");
          String text = c0.optString("text", "");
          if (!TextUtils.isEmpty(text)) return text;
        }
      }
      return "";
    }
    /* SSE：把每一帧的 delta.content 拼起来 */
    StringBuilder out = new StringBuilder();
    String[] lines = trimmed.split("\n");
    for (String line : lines) {
      String s = line.trim();
      if (!s.startsWith("data:")) continue;
      s = s.substring(5).trim();
      if (s.isEmpty() || "[DONE]".equals(s)) continue;
      try {
        JSONObject obj = new JSONObject(s);
        JSONArray choices = obj.optJSONArray("choices");
        if (choices == null || choices.length() == 0) continue;
        JSONObject delta = choices.optJSONObject(0) == null ? null : choices.optJSONObject(0).optJSONObject("delta");
        if (delta != null) out.append(delta.optString("content", ""));
      } catch (Exception ignored) {
        /* 单帧坏了不影响别的 */
      }
    }
    return out.toString();
  }

  /** 从回复里抠出第一段 ```qidao 围栏（动作 JSON）；没有就返回空 */
  private static String extractAction(String text) {
    int fence = text.indexOf("```qidao");
    if (fence >= 0) {
      int start = text.indexOf('\n', fence);
      int end = text.indexOf("```", start + 1);
      if (start > 0 && end > start) return text.substring(start + 1, end).trim();
    }
    int brace = text.indexOf('{');
    int close = text.lastIndexOf('}');
    if (brace >= 0 && close > brace) {
      String maybe = text.substring(brace, close + 1).trim();
      if (maybe.contains("\"kind\"")) return maybe;
    }
    return "";
  }

  /* ── 主流程 ─────────────────────────────────────────────── */

  static Outcome tick(Context ctx) {
    Date now = new Date();
    String today = dayKey(now);
    WakePrefs.putLong(ctx, WakePrefs.LAST_WAKE_MS, now.getTime());
    WakePrefs.put(ctx, WakePrefs.WAKE_COUNT, String.valueOf(WakePrefs.num(ctx, WakePrefs.WAKE_COUNT, 0) + 1));

    String mode = decide(ctx, now);
    if ("没打开（或者还没接模型）".equals(mode) || mode.startsWith("安静") || mode.startsWith("离上次")
        || mode.startsWith("他说自己") || mode.startsWith("今天说够")) {
      return new Outcome("没醒：" + mode, false, false);
    }

    String base = WakePrefs.str(ctx, WakePrefs.BASE_URL).trim();
    String key = WakePrefs.str(ctx, WakePrefs.API_KEY).trim();
    String model = WakePrefs.str(ctx, WakePrefs.MODEL).trim();
    String aiName = WakePrefs.str(ctx, WakePrefs.AI_NAME).trim();
    if (aiName.isEmpty()) aiName = "他";
    if (base.isEmpty() || key.isEmpty() || model.isEmpty()) {
      return new Outcome("没醒：抽屉里没有上游配置（先在 App 里填好）", false, false);
    }

    String prompt = buildSystemPrompt(ctx, mode, now);
    if (TextUtils.isEmpty(prompt)) return new Outcome("没醒：抽屉里没有指令", false, false);

    String reply;
    try {
      reply = postChat(base, key, model, prompt);
    } catch (Exception e) {
      return new Outcome("问不到上游：" + String.valueOf(e.getMessage()).substring(0, Math.min(80, String.valueOf(e.getMessage()).length())), false, false);
    }
    reply = reply == null ? "" : reply.trim();
    if (reply.isEmpty()) return new Outcome("他这次没答上来", false, false);

    boolean wantAction = "diary".equals(mode) || "free".equals(mode);
    String action = wantAction ? extractAction(reply) : "";
    String text;
    if (wantAction) {
      if (action.isEmpty()) {
        /* 该给动作却没给 → 不算数，下一轮再说（不弹通知） */
        return new Outcome("他说了话但没给动作，跳过", false, false);
      }
      text = action;
    } else {
      String body = stripFences(reply);
      if (body.isEmpty() || body.toUpperCase(Locale.ROOT).startsWith("SKIP")) {
        WakePrefs.put(ctx, WakePrefs.SKIP_STREAK, String.valueOf(WakePrefs.num(ctx, WakePrefs.SKIP_STREAK, 0) + 1));
        return new Outcome("他这次选择不说", false, false);
      }
      if (body.length() > MAX_REPLY_CHARS) body = body.substring(0, MAX_REPLY_CHARS);
      text = body;
    }

    /* 记账：小本子 + 交接键（网页打开时补落库） */
    long id = now.getTime();
    String at = stamp(now);
    String kind = wantAction ? "action" : "say";
    try {
      JSONObject entry = new JSONObject();
      entry.put("id", id);
      entry.put("at", at);
      entry.put("atMs", id);
      entry.put("kind", kind);
      entry.put("text", text);
      WakeLedger.append(ctx, entry);
    } catch (Exception ignored) {
      /* 小本子写不进去也要把交接键和通知做完 */
    }

    WakePrefs.put(ctx, "wake_pending_text", text);
    WakePrefs.put(ctx, "wake_pending_kind", kind);
    WakePrefs.put(ctx, "wake_pending_at", at);
    WakePrefs.putLong(ctx, "wake_pending_at_ms", id);
    WakePrefs.put(ctx, "wake_pending_urge", "");

    WakePrefs.putLong(ctx, WakePrefs.LAST_SAID_MS, id);
    /**
     * **跟后台那段 JS 共用的账**（见 `WakePrefs` 顶部的说明）：两边都写同一批键，
     * 这样"最短间隔 / 每日上限"对两个唤醒器同时生效，不会同一小时说两遍。
     */
    WakePrefs.putLong(ctx, WakePrefs.LAST_SPOKE_AT, id);
    String jsDay = jsDayKey(now);
    int jsCount = jsDay.equals(WakePrefs.str(ctx, WakePrefs.SPOKE_DAY))
        ? WakePrefs.num(ctx, WakePrefs.SPOKE_DAY_COUNT, 0)
        : 0;
    WakePrefs.put(ctx, WakePrefs.SPOKE_DAY, jsDay);
    WakePrefs.put(ctx, WakePrefs.SPOKE_DAY_COUNT, String.valueOf(jsCount + 1));
    WakePrefs.put(ctx, WakePrefs.SKIP_STREAK, "0");
    if (wantAction) {
      if ("diary".equals(mode)) WakePrefs.put(ctx, WakePrefs.ACTION_DAY, today);
      bumpToday(ctx, today, "wake_free_count");
    } else {
      bumpToday(ctx, today, "wake_said_count");
    }

    String notifyText = wantAction ? actionSummary(text) : text;
    int seq = WakePrefs.num(ctx, WakePrefs.WAKE_COUNT, 0);
    if (wantAction) {
      WakeNotify.show(ctx, aiName, notifyText, seq);
    } else {
      /* 主动说话也弹（用户要的：他说了我要知道） */
      WakeNotify.show(ctx, aiName, notifyText, seq);
    }

    return new Outcome(("diary".equals(mode) ? "他写了日记" : "free".equals(mode) ? "他自己做了件事" : "他主动说了一句"), true, true);
  }

  /** 动作 JSON → 人看的一句摘要（通知上不能摊参数） */
  private static String actionSummary(String json) {
    try {
      JSONObject o = new JSONObject(json);
      String kind = o.optString("kind", "");
      if ("diary.add".equals(kind)) return "他把今天的日记写了";
      if ("moment.post".equals(kind)) return "他发了一条动态：" + o.optString("text", "");
      if ("letter.write".equals(kind)) return "他写了一封信：" + o.optString("title", "");
      if ("emotion.report".equals(kind)) return "他心里" + o.optString("primaryEmotion", "有点动静");
      return "他做了件事";
    } catch (Exception e) {
      return "他做了件事";
    }
  }

  /** 去掉正文里的代码围栏（动作块不该出现在气泡里） */
  private static String stripFences(String text) {
    String s = text.replaceAll("(?s)```[a-zA-Z]*\\s*.*?```", " ");
    return s.trim();
  }
}
