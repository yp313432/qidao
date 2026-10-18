package com.yanping.qidao;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * **原生小本子**：他在后台做过的事，一条条记在这儿。
 *
 * 为什么不能直接写进 App 的数据库：动态/日记/棋谱都在 WebView 的 IndexedDB 里，
 * 原生读不到也写不进（这是用户 m02828 问"A 是啥意思"时对齐过的边界）。
 * 所以后台只负责**记下来 + 弹通知**，等 App 打开时由网页那边按白名单补落库
 * （复用 `lib/wake-sync.ts` 里既有的 pending/action 执行路径）。
 *
 * 存法：同一个 SharedPreferences 里一格 JSON 数组，最多 30 条，越新越靠后。
 * 每条长这样：
 *   { "id": 1729..., "at": "10月18日 20:30", "atMs": 1729...,
 *     "kind": "say" | "action", "text": "…" }
 */
final class WakeLedger {

  private static final int MAX = 30;

  private WakeLedger() {}

  private static JSONArray readArray(Context ctx) {
    String raw = WakePrefs.str(ctx, WakePrefs.LEDGER).trim();
    if (raw.isEmpty()) return new JSONArray();
    try {
      JSONArray arr = new JSONArray(raw);
      return arr == null ? new JSONArray() : arr;
    } catch (Exception e) {
      return new JSONArray();
    }
  }

  /** 记一条（同 id 覆盖，不会重复） */
  static void append(Context ctx, JSONObject entry) {
    try {
      long id = entry.optLong("id", System.currentTimeMillis());
      JSONArray old = readArray(ctx);
      JSONArray next = new JSONArray();
      for (int i = 0; i < old.length(); i++) {
        JSONObject it = old.optJSONObject(i);
        if (it == null) continue;
        if (it.optLong("id", -1) == id) continue;
        next.put(it);
      }
      next.put(entry);
      while (next.length() > MAX) {
        JSONArray trimmed = new JSONArray();
        for (int i = 1; i < next.length(); i++) trimmed.put(next.opt(i));
        next = trimmed;
      }
      WakePrefs.put(ctx, WakePrefs.LEDGER, next.toString());
    } catch (Exception ignored) {
      /* 记不进去不能把这次唤醒搞崩：通知照发 */
    }
  }

  /** 全部条目（网页那边读这个来补落库） */
  static String dump(Context ctx) {
    return readArray(ctx).toString();
  }

  /**
   * 网页说"这几条我已经落进库了" → 删掉。
   * 传空数组 = 全清（"清空重来"用）。
   */
  static void ack(Context ctx, JSONArray ids) {
    try {
      JSONArray old = readArray(ctx);
      if (ids == null || ids.length() == 0) {
        WakePrefs.put(ctx, WakePrefs.LEDGER, "[]");
        return;
      }
      JSONArray next = new JSONArray();
      for (int i = 0; i < old.length(); i++) {
        JSONObject it = old.optJSONObject(i);
        if (it == null) continue;
        long id = it.optLong("id", -1);
        boolean drop = false;
        for (int k = 0; k < ids.length(); k++) {
          if (ids.optLong(k, -2) == id) {
            drop = true;
            break;
          }
        }
        if (!drop) next.put(it);
      }
      WakePrefs.put(ctx, WakePrefs.LEDGER, next.toString());
    } catch (Exception ignored) {
      /* 同上：清理失败不该影响别的 */
    }
  }
}
