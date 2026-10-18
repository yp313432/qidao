package com.yanping.qidao;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * **原生唤醒的抽屉读写层**（与 `WakeBridgePlugin.PREFS` 同一个 SharedPreferences）。
 *
 * 为什么要单开一个类：唤醒现在跑在 Kotlin 里（`WakeService`），
 * 它和 `WakeBridgePlugin`、以及网页那边（`lib/wake-bridge.ts` 的 `WAKE_KEYS`）
 * 必须看到**同一份键**。键名集中在这里，改一个字母只改这一处。
 *
 * ⚠️ 抽屉名必须与 `capacitor.config.ts` 的 `plugins.BackgroundRunner.label` 一字不差，
 * 否则网页写的配置原生读不到（而且不会报错）。
 */
final class WakePrefs {

  /** ⚠️ 与 `WakeBridgePlugin.PREFS`、`capacitor.config.ts` 的 label 完全一致 */
  static final String NAME = "com.yanping.qidao.wake";

  /* ── 网页推过来的配置（键名与 lib/wake-bridge.ts 的 WAKE_KEYS 一致）── */
  static final String BASE_URL = "cfg_base_url";
  static final String API_KEY = "cfg_api_key";
  static final String MODEL = "cfg_model";
  static final String AI_NAME = "cfg_ai_name";
  static final String ENABLED = "cfg_enabled";
  static final String QUIET_START = "cfg_quiet_start";
  static final String QUIET_END = "cfg_quiet_end";
  static final String PROMPT_NORMAL = "cfg_prompt_normal";
  static final String PROMPT_FORCE = "cfg_prompt_force";
  static final String BUSY_UNTIL = "cfg_busy_until";
  static final String MIN_GAP_MIN = "cfg_min_gap_min";
  static final String DAILY_MAX = "cfg_daily_max";
  static final String MOOD = "cfg_mood";
  static final String AUTONOMY_ON = "cfg_autonomy_on";
  static final String ACTION_DIARY = "cfg_action_diary";
  static final String ACTION_FREE = "cfg_action_free";
  static final String ACTION_HOUR = "cfg_action_hour";
  static final String ACTION_MINUTE = "cfg_action_minute";
  static final String ACTION_DAY = "cfg_action_day";
  static final String ACTION_PROMPT = "cfg_action_prompt";

  /* ── 原生自己记的（网页只读不写）── */
  static final String NEXT_AT_MS = "cfg_wake_next_ms";
  static final String LAST_WAKE_MS = "wake_last_at_ms";
  static final String LAST_SAID_MS = "wake_last_said_ms";
  static final String WAKE_COUNT = "wake_count";
  static final String SKIP_STREAK = "wake_skip_streak";
  static final String LEDGER = "wake_ledger";
  static final String LEDGER_ACKED = "wake_ledger_acked";

  /**
   * ── **跟后台那段 JS 共用的账**（这一批新加）────────────────────────
   *
   * `public/runners/wake.js` 那套（WorkManager 每小时）**还在**：测试脚本按它的
   * 键名契约对账，删了会红一片。于是两边跑，最怕的就是"同一小时他说两遍"。
   *
   * 解法：把"上一次说话 / 今天说了几条"记成**同一批键**（JS 那边的原名），
   * 谁说的另一方都看得见 → 最短间隔和每日上限这两道闸门对两边同时生效。
   *
   * ⚠️ `spoke_day` 的格式要**照抄 JS**：`getFullYear()+"-"+(getMonth()+1)+"-"+getDate()`
   * （不补零）。写得不一样就跨天对不上，会出现"每天多说一条"。
   */
  static final String LAST_SPOKE_AT = "last_spoke_at";
  static final String SPOKE_DAY = "spoke_day";
  static final String SPOKE_DAY_COUNT = "spoke_day_count";

  private WakePrefs() {}

  static SharedPreferences of(Context ctx) {
    return ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE);
  }

  static String str(Context ctx, String key) {
    return of(ctx).getString(key, "");
  }

  static int num(Context ctx, String key, int fallback) {
    try {
      String v = str(ctx, key).trim();
      return v.isEmpty() ? fallback : (int) Double.parseDouble(v);
    } catch (Exception e) {
      return fallback;
    }
  }

  static long numLong(Context ctx, String key, long fallback) {
    try {
      String v = str(ctx, key).trim();
      return v.isEmpty() ? fallback : (long) Double.parseDouble(v);
    } catch (Exception e) {
      return fallback;
    }
  }

  static void put(Context ctx, String key, String value) {
    of(ctx).edit().putString(key, value == null ? "" : value).apply();
  }

  static void putLong(Context ctx, String key, long value) {
    put(ctx, key, String.valueOf(value));
  }
}
