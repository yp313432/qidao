package com.yanping.qidao;

import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Dedicated streamed transport. Never patches WebView fetch or chat streaming. */
@CapacitorPlugin(name = "QidaoMcpNetwork")
public class QidaoMcpNetworkPlugin extends Plugin {
  private static class Request { volatile HttpURLConnection connection; volatile boolean cancelled; }
  private final Map<String, Request> requests = new ConcurrentHashMap<>();
  private final ExecutorService workers = Executors.newFixedThreadPool(16);
  private final Handler main = new Handler(Looper.getMainLooper());

  private void emit(String id, String type, JSObject detail) {
    detail.put("id", id); detail.put("type", type);
    main.post(() -> notifyListeners("response", detail));
  }

  @PluginMethod
  public void start(PluginCall call) {
    String id = call.getString("id", "");
    String raw = call.getString("url", "");
    try {
      URL url = new URL(raw);
      if ((!url.getProtocol().equals("https") && !url.getProtocol().equals("http")) || url.getUserInfo() != null) {
        call.reject("只支持无内嵌密码的 HTTP 或 HTTPS 地址"); return;
      }
      if (id.isEmpty() || requests.size() >= 16) { call.reject("MCP 请求过多，请稍后重试"); return; }
      Request request = new Request();
      if (requests.putIfAbsent(id, request) != null) { call.reject("重复的 MCP 请求"); return; }
      String method = call.getString("method", "GET").toUpperCase(java.util.Locale.ROOT);
      JSObject headers = call.getObject("headers", new JSObject());
      String body = call.getString("body");
      call.resolve();
      workers.execute(() -> perform(id, request, url, method, headers, body));
    } catch (Exception error) { call.reject("MCP 地址无效"); }
  }

  private void perform(String id, Request request, URL initial, String method, JSObject headers, String body) {
    try {
      URL target = initial;
      for (int redirect = 0; redirect <= 5; redirect++) {
        if (request.cancelled) return;
        HttpURLConnection connection = (HttpURLConnection) target.openConnection();
        request.connection = connection;
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(90000);
        connection.setRequestMethod(method);
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
          String key = keys.next();
          connection.setRequestProperty(key, headers.optString(key));
        }
        if (body != null && !method.equals("GET") && !method.equals("HEAD")) {
          connection.setDoOutput(true);
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          connection.setFixedLengthStreamingMode(bytes.length);
          try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
        }
        int status = connection.getResponseCode();
        String location = connection.getHeaderField("Location");
        if (status >= 300 && status <= 308 && status != 304 && location != null) {
          URL next = new URL(target, location);
          connection.disconnect();
          // MCP endpoints and OAuth credential POSTs must not silently forward secrets elsewhere.
          if (!target.getProtocol().equals(next.getProtocol()) || !target.getHost().equalsIgnoreCase(next.getHost())
              || target.getPort() != next.getPort()) throw new SecurityException("cross-origin redirect");
          if (redirect == 5) throw new IllegalStateException("redirect limit");
          if (status == 303 || ((status == 301 || status == 302) && method.equals("POST"))) { method = "GET"; body = null; }
          target = next; continue;
        }
        JSObject responseHeaders = new JSObject();
        for (Map.Entry<String, java.util.List<String>> entry : connection.getHeaderFields().entrySet()) {
          if (entry.getKey() != null) responseHeaders.put(entry.getKey(), String.join(", ", entry.getValue()));
        }
        JSObject response = new JSObject(); response.put("status", status); response.put("headers", responseHeaders);
        emit(id, "headers", response);
        InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (input != null) try (InputStream in = input) {
          byte[] buffer = new byte[8192]; int count; long total = 0;
          while (!request.cancelled && (count = in.read(buffer)) != -1) {
            total += count;
            if (total > 16_000_000) throw new IllegalStateException("response limit");
            JSObject chunk = new JSObject();
            chunk.put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP));
            emit(id, "chunk", chunk);
          }
        }
        if (!request.cancelled) emit(id, "end", new JSObject());
        return;
      }
    } catch (Exception error) {
      if (!request.cancelled) {
        JSObject detail = new JSObject();
        detail.put("message", error instanceof SecurityException ? "MCP 地址发生跨站跳转，请填写最终服务地址"
          : "MCP 网络请求失败（" + error.getClass().getSimpleName() + "），请检查地址、网络或服务状态");
        emit(id, "error", detail);
      }
    } finally {
      if (request.connection != null) request.connection.disconnect();
      requests.remove(id, request);
    }
  }

  @PluginMethod
  public void cancel(PluginCall call) {
    Request request = requests.remove(call.getString("id", ""));
    if (request != null) { request.cancelled = true; if (request.connection != null) request.connection.disconnect(); }
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() {
    for (Request request : requests.values()) { request.cancelled = true; if (request.connection != null) request.connection.disconnect(); }
    requests.clear(); workers.shutdownNow(); super.handleOnDestroy();
  }
}
