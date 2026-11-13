#!/usr/bin/env bash
set -euo pipefail
capture_device() {
  adb logcat -d > /tmp/native-logcat.txt 2>&1 || true
  adb exec-out screencap -p > /tmp/native-mcp.png || true
  tail -100 /tmp/native-logcat.txt || true
}
trap capture_device EXIT
adb reverse tcp:8767 tcp:8767
adb reverse tcp:4650 tcp:4650
chmod +x android/gradlew
cd android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest --no-daemon
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell pm grant com.yanping.qidao android.permission.POST_NOTIFICATIONS
adb logcat -c
./gradlew :app:connectedDebugAndroidTest --no-daemon -Pandroid.testInstrumentationRunnerArguments.class=com.yanping.qidao.McpNativeRoundTripTest
