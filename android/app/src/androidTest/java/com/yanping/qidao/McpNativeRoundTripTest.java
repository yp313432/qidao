package com.yanping.qidao;

import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** The actual APK WebView and Java HTTP plugin, forwarded to a real token-protected Node bridge. */
@RunWith(AndroidJUnit4.class)
public class McpNativeRoundTripTest {
  private ActivityScenario<MainActivity> scenario;
  private String evaluate(String script) throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    AtomicReference<String> value = new AtomicReference<>();
    scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
    assertTrue("WebView callback timed out", done.await(5, TimeUnit.SECONDS));
    return value.get();
  }
  private void until(String label, String predicate, long timeout) throws Exception {
    long end = SystemClock.uptimeMillis() + timeout;
    while (SystemClock.uptimeMillis() < end) {
      if ("true".equals(evaluate("Boolean(" + predicate + ")"))) return;
      Thread.sleep(100);
    }
    fail(label + " timed out. State: " + evaluate("JSON.stringify(window.qidaoFixture?.read())") + "; page: " + evaluate("document.body.innerText.slice(-8000)"));
  }
  private void click(String text, boolean prefix) throws Exception {
    String target = org.json.JSONObject.quote(text);
    String predicate = "Array.from(document.querySelectorAll('button')).find(b=>!b.disabled && b.textContent.trim()." + (prefix ? "startsWith" : "includes") + "(" + target + "))";
    until("button " + text, predicate, 15000);
    evaluate("(" + predicate + ").click()");
  }

  @Test public void nativeHandshakeFailureRecoveryAndAiExecution() throws Exception {
    scenario = ActivityScenario.launch(MainActivity.class);
    try {
      scenario.onActivity(activity -> {
        WebView web = activity.getBridge().getWebView();
        web.loadUrl("https://localhost/scripts/chat-page-fixture.html?tools&nativeMcp");
      });
      until("native fixture", "window.qidaoFixture && window.Capacitor?.isNativePlatform?.()", 45000);
      assertEquals("true", evaluate("Boolean(window.Capacitor.nativePromise && window.Capacitor.addListener)"));
      click("MCP", false); click("Termux 终端", true); click("测试连接", false);
      until("real Android MCP handshake", "window.qidaoFixture.read().mcp[0]?.status?.ok === true", 25000);
      assertEquals("4", evaluate("window.qidaoFixture.read().mcp[0].tools.length"));
      evaluate("window.qidaoFixture.setMcpUrl('http://127.0.0.1:8779/mcp')");
      click("测试连接", false);
      until("native connection error", "window.qidaoFixture.read().mcp[0]?.status?.ok === false", 25000);
      until("spinner stopped", "!document.body.innerText.includes('握手中')", 3000);
      assertEquals("true", evaluate("window.qidaoFixture.read().mcp[0].status.message.includes('初始化握手')"));
      evaluate("window.qidaoFixture.setMcpUrl('http://127.0.0.1:8767/mcp/__qidao_terminal')");
      click("测试连接", false);
      until("native recovery", "window.qidaoFixture.read().mcp[0]?.status?.ok === true", 25000);
      evaluate("window.qidaoFixture.navigate('/')");
      until("chat input", "document.querySelector('textarea[aria-label=\"消息输入框\"]')", 15000);
      evaluate("(function(){const el=document.querySelector('textarea[aria-label=\"消息输入框\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'调用 MCP 外部工具：检查 Termux 环境并执行测试命令');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
      click("发送", false);
      until("AI native terminal execution", "window.qidaoFixture.read().messages.at(-1)?.content === 'MCP_NATIVE_ANDROID_OK'", 60000);
      assertEquals("4", evaluate("window.qidaoFixture.read().messages.at(-1).rounds.flatMap(r=>r.calls).length"));
      assertEquals("true", evaluate("window.qidaoFixture.read().messages.at(-1).rounds.flatMap(r=>r.calls).every(c=>c.ok === true)"));
      assertEquals("true", evaluate("window.qidaoFixture.read().messages.at(-1).rounds.flatMap(r=>r.calls).some(c=>c.result.includes('NATIVE_TERMUX_OK'))"));
      System.out.println("ANDROID_MCP_PASS actual WebView native handshake, failure/spinner recovery and four AI tool calls");
    } finally { scenario.close(); }
  }
}
