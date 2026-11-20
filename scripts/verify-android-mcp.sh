#!/usr/bin/env bash
set -euo pipefail

app=com.yanping.qidao
capture_dir=android/app/build/reports/androidTests/thinking-sheet
service_log=/tmp/thinking-translation.log

capture_result() {
  status=$?
  trap - EXIT
  if [[ -n "${translation_server:-}" ]]; then kill "$translation_server" 2>/dev/null || true; fi
  mkdir -p "$capture_dir"
  for name in thinking-original.png thinking-translated.png thinking-light-text.png; do
    if adb exec-out run-as "$app" cat "files/$name" > "$capture_dir/$name" 2>/dev/null && [[ -s "$capture_dir/$name" ]]; then
      echo "Android screenshot captured: $name"
    else
      rm -f "$capture_dir/$name"
    fi
  done
  if [[ -s "$capture_dir/thinking-original.png" ]]; then cp "$capture_dir/thinking-original.png" /tmp/native-mcp.png; fi
  if [[ -f "$service_log" ]]; then cp "$service_log" "$capture_dir/translation-endpoint.log"; fi
  timeout 10s adb logcat -d > /tmp/native-logcat.txt 2>&1 || true
  exit "$status"
}
trap capture_result EXIT

adb shell wm size 432x936
adb shell wm density 160
adb shell settings put system font_scale 1.0
adb reverse tcp:4661 tcp:4661
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell pm grant "$app" android.permission.POST_NOTIFICATIONS || true

node --input-type=module > "$service_log" 2>&1 <<'NODE' &
import { createServer } from "node:http";

const translated = [
  "给她留出说话的空间，让她自己决定想分享什么。",
  "回复要简短而温暖。先陪着她，慢慢来就好。",
];

createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  if (request.method === "GET" || request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  if (!body.includes("Give her room to talk") || !body.includes("Keep the reply short")) {
    response.writeHead(400).end("Expected both test passages");
    return;
  }
  console.log("Received the two sample thinking passages");
  const content = JSON.stringify(translated);
  if (JSON.parse(body).stream) {
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    const frame = JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] });
    response.end("data: " + frame + "\n\ndata: [DONE]\n\n");
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }));
}).listen(4661, "127.0.0.1");
NODE
translation_server=$!
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4661/health >/dev/null; then break; fi
  sleep 0.5
done
curl -fsS http://127.0.0.1:4661/health >/dev/null

adb logcat -c
mkdir -p "$capture_dir"
adb shell am instrument -w -r \
  -e class com.yanping.qidao.ThinkingSheetAndroidPreviewTest \
  "$app.test/androidx.test.runner.AndroidJUnitRunner" | tee "$capture_dir/instrumentation.txt"
grep -Fq 'OK (1 test)' "$capture_dir/instrumentation.txt"
