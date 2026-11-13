#!/usr/bin/env bash
set -euo pipefail
live_log_pid=""
capture_device() {
  if [[ -n "$live_log_pid" ]]; then kill "$live_log_pid" 2>/dev/null || true; fi
  python3 - <<'PYREPORT'
from pathlib import Path
for report in Path("app/build/outputs/androidTest-results").rglob("*.xml"):
    print(str(report))
    print(report.read_text(errors="replace")[:40000])
PYREPORT
  timeout 10s adb logcat -d > /tmp/native-logcat.txt 2>&1 || true
  timeout 10s adb exec-out screencap -p > /tmp/native-mcp.png || true
  tail -100 /tmp/native-logcat.txt || true
}
trap capture_device EXIT
adb reverse tcp:8767 tcp:8767
adb reverse tcp:4650 tcp:4650
cd android
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell pm grant com.yanping.qidao android.permission.POST_NOTIFICATIONS
adb logcat -c
adb logcat -v time > /tmp/native-logcat-live.txt 2>&1 &
live_log_pid=$!
./gradlew :app:connectedDebugAndroidTest --no-daemon --max-workers=2 -Pandroid.testInstrumentationRunnerArguments.class=com.yanping.qidao.McpNativeRoundTripTest
