/**
 * Native wake policy regression tests. Run with Node + Java 21 (no Android SDK).
 * Executes the production decision/tick preflight and AlarmManager scheduling code
 * on the JVM with in-memory Android boundaries; does not test device delivery.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = "android/app/src/main/java/com/yanping/qidao/";
const read = (name) => readFileSync(root + name + ".java", "utf8");
const stripImports = (s) => s.replace(/^package .*;\s*/m, "").replace(/^import .*;\s*/gm, "");
const engine = read("WakeEngine");
const tickStart = engine.indexOf("  static Outcome tick(Context ctx)");
const tickEnd = engine.indexOf("    String prompt = buildSystemPrompt", tickStart);
const headEnd = engine.indexOf("  private static String postChat");
assert.ok(headEnd > 0 && tickStart > headEnd && tickEnd > tickStart);
// Keep the actual production gate ordering; stop immediately before HTTP work.
const enginePolicy = stripImports(engine.slice(0, headEnd)) +
  engine.slice(tickStart, tickEnd) + '    return new Outcome("ready", false, false);\n  }\n}\n';
const constants = [...read("WakePrefs").matchAll(/static final String \w+ = "[^"]*";/g)].map((m) => m[0]).join("\n");

const harness = `
import java.util.*;
import java.text.SimpleDateFormat;

class NativeWakeRegression {
  static final Context ctx = new Context();
  static void check(boolean ok, String name) {
    if (!ok) throw new AssertionError(name);
    System.out.println("PASS " + name);
  }
  static void config() {
    WakePrefs.values.clear();
    WakePrefs.put(ctx, WakePrefs.ENABLED, "1");
    WakePrefs.put(ctx, WakePrefs.BASE_URL, "https://example.invalid/v1");
    WakePrefs.put(ctx, WakePrefs.API_KEY, "test-key");
    WakePrefs.put(ctx, WakePrefs.MODEL, "test-model");
    WakePrefs.put(ctx, WakePrefs.QUIET_START, "0");
    WakePrefs.put(ctx, WakePrefs.QUIET_END, "0");
  }
  public static void main(String[] args) {
    config();
    check("ready".equals(WakeEngine.tick(ctx).what), "first background wake reaches HTTP boundary");
    check(WakePrefs.numLong(ctx, WakePrefs.LAST_WAKE_MS, 0) > 0, "wake timestamp is recorded");
    check(WakeEngine.tick(ctx).what.contains("离上次太近"), "immediate second wake is throttled");
    config();
    WakePrefs.putLong(ctx, WakePrefs.LAST_WAKE_MS, System.currentTimeMillis() - 41 * 60000L);
    check("ready".equals(WakeEngine.tick(ctx).what), "wake after minimum gap can generate");
    config();
    WakePrefs.putLong(ctx, WakePrefs.LAST_SPOKE_AT, System.currentTimeMillis());
    check(WakeEngine.tick(ctx).what.contains("离上次太近"), "JS runner speech shares throttle");
    config();
    WakePrefs.putLong(ctx, WakePrefs.BUSY_UNTIL, System.currentTimeMillis() + 60000);
    check(WakeEngine.tick(ctx).what.contains("他说自己在忙"), "busy policy still prevents requests");
    config();
    int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
    WakePrefs.put(ctx, WakePrefs.QUIET_START, String.valueOf(hour));
    WakePrefs.put(ctx, WakePrefs.QUIET_END, String.valueOf((hour + 1) % 24));
    check(WakeEngine.tick(ctx).what.contains("安静"), "quiet hours still prevent requests");
    config();
    WakePrefs.put(ctx, WakePrefs.SPOKE_DAY, WakeEngine.jsDayKey(new Date()));
    WakePrefs.put(ctx, WakePrefs.SPOKE_DAY_COUNT, "8");
    check(WakeEngine.tick(ctx).what.contains("今天说够"), "daily limit still prevents requests");
    config();
    WakePrefs.put(ctx, WakePrefs.ENABLED, "0");
    check(WakeEngine.tick(ctx).what.contains("没打开"), "disabled wake does not request");

    config();
    long earlier = System.currentTimeMillis() + 5 * 60000;
    WakePrefs.putLong(ctx, WakePrefs.NEXT_AT_MS, earlier);
    for (int n = 0; n < 20; n++) {
      check(WakeAlarm.schedule(ctx) == earlier, "context sync preserves earlier alarm " + n);
    }
    check(ctx.alarm.at == earlier, "system alarm matches stored next wake");
    WakePrefs.putLong(ctx, WakePrefs.NEXT_AT_MS, System.currentTimeMillis() - 1);
    check(WakeAlarm.schedule(ctx) > System.currentTimeMillis(), "expired alarm advances");
    WakePrefs.put(ctx, WakePrefs.MODEL, "");
    check(WakeAlarm.schedule(ctx) == 0 && ctx.alarm.at == 0, "missing model cancels alarm");
    config();
    ctx.alarm.fail = true;
    check(WakeAlarm.schedule(ctx) == 0 && WakePrefs.numLong(ctx, WakePrefs.NEXT_AT_MS, -1) == 0,
        "failed schedule does not report a future alarm");
  }
}

class TextUtils { static boolean isEmpty(String s) { return s == null || s.isEmpty(); } }
class Context {
  static final String ALARM_SERVICE = "alarm";
  final AlarmManager alarm = new AlarmManager();
  Object getSystemService(String service) { return alarm; }
}
class Intent {
  Intent(Context c, Class<?> cls) {}
  void setAction(String action) {}
}
class PendingIntent {
  static final int FLAG_UPDATE_CURRENT = 1, FLAG_IMMUTABLE = 2;
  static PendingIntent getBroadcast(Context c, int req, Intent i, int flags) { return new PendingIntent(); }
}
class Build {
  static class VERSION { static final int SDK_INT = 36; }
  static class VERSION_CODES { static final int M = 23, S = 31; }
}
class AlarmManager {
  static final int RTC_WAKEUP = 0;
  long at;
  boolean fail;
  boolean canScheduleExactAlarms() { return true; }
  void setExactAndAllowWhileIdle(int type, long time, PendingIntent pi) {
    if (fail) throw new SecurityException("test");
    at = time;
  }
  void setAndAllowWhileIdle(int t, long at, PendingIntent pi) { setExactAndAllowWhileIdle(t, at, pi); }
  void setExact(int t, long at, PendingIntent pi) { setExactAndAllowWhileIdle(t, at, pi); }
  void cancel(PendingIntent pi) { at = 0; }
}
class WakeReceiver {}
class WakePrefs {
  ${constants}
  static final Map<String, String> values = new HashMap<>();
  static String str(Context ctx, String k) { return values.getOrDefault(k, ""); }
  static void put(Context ctx, String k, String v) { values.put(k, v); }
  static void putLong(Context ctx, String k, long v) { put(ctx, k, String.valueOf(v)); }
  static long numLong(Context ctx, String k, long fallback) {
    try { return Long.parseLong(str(ctx, k)); } catch (Exception e) { return fallback; }
  }
  static int num(Context ctx, String k, int fallback) { return (int) numLong(ctx, k, fallback); }
}
${enginePolicy}
${stripImports(read("WakeAlarm"))}
`;

const dir = mkdtempSync(join(tmpdir(), "qidao-native-wake-"));
try {
  const file = join(dir, "NativeWakeRegression.java");
  writeFileSync(file, harness);
  const status = await new Promise((resolve, reject) => {
    const child = spawn("java", [file], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(status, 0, "native wake regression checks failed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
