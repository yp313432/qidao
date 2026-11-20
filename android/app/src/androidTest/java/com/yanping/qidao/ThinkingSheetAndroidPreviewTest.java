package com.yanping.qidao;

import android.app.Instrumentation;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ThinkingSheetAndroidPreviewTest {
  private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
  private ActivityScenario<MainActivity> scenario;

  private String evaluate(String script) throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    AtomicReference<String> value = new AtomicReference<>();
    scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, result -> {
      value.set(result);
      done.countDown();
    }));
    assertTrue("WebView callback timed out", done.await(20, TimeUnit.SECONDS));
    return value.get();
  }

  private void until(String label, String predicate) throws Exception {
    long end = SystemClock.uptimeMillis() + 35000;
    while (SystemClock.uptimeMillis() < end) {
      if ("true".equals(evaluate("Boolean(" + predicate + ")"))) return;
      SystemClock.sleep(120);
    }
    fail(label + " timed out. " + evaluate("String(window.qidaoPreviewSeed) + ' | ' + document.body?.innerText?.slice(-3000)"));
  }

  private void openThinkingSheet() throws Exception {
    String entry = "Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('想了 15 秒') && button.textContent.includes('点开看'))";
    until("chat thinking entry", entry);
    evaluate("(" + entry + ").click()");
    until("thinking sheet", "document.querySelector('.lq-dialog--sheet.backdrop-blur-2xl')");
    assertEquals("true", evaluate("""
      (() => {
        const sheet = document.querySelector('.lq-dialog--sheet.backdrop-blur-2xl');
        const translate = sheet.querySelector('button[aria-label="思考内容中文翻译"]');
        const close = sheet.querySelector('button[aria-label="关闭"]');
        const style = getComputedStyle(sheet);
        return translate?.nextElementSibling === close &&
          translate.getBoundingClientRect().right <= close.getBoundingClientRect().left &&
          translate.getBoundingClientRect().width >= 44 &&
          translate.querySelector('svg.lucide-languages') &&
          !sheet.matches('[data-contrast]') &&
          style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
          style.backgroundImage.includes('255, 255, 255') &&
          style.backdropFilter.includes('blur(40px)');
      })()"""));
  }

  private void screenshot(String filename) throws Exception {
    until("production fonts loaded", "document.fonts.status === 'loaded'");
    CountDownLatch drawn = new CountDownLatch(1);
    scenario.onActivity(activity -> activity.getBridge().getWebView().postVisualStateCallback(
      SystemClock.uptimeMillis(), new WebView.VisualStateCallback() {
        @Override public void onComplete(long requestId) {
          drawn.countDown();
        }
      }));
    assertTrue("WebView did not finish drawing the sheet", drawn.await(15, TimeUnit.SECONDS));
    SystemClock.sleep(1250);
    Bitmap shot = instrumentation.getUiAutomation().takeScreenshot();
    assertNotNull("Android screen capture failed", shot);
    try (FileOutputStream output = new FileOutputStream(
        new File(instrumentation.getTargetContext().getFilesDir(), filename))) {
      assertTrue("Android screenshot could not be written", shot.compress(Bitmap.CompressFormat.PNG, 100, output));
    } finally {
      shot.recycle();
    }
  }

  @Test public void captureProductionThinkingSheet() throws Exception {
    scenario = ActivityScenario.launch(MainActivity.class);
    try {
      scenario.onActivity(activity -> activity.getBridge().getWebView()
        .loadUrl("https://localhost/scripts/chat-page-fixture.html?thinkingPreview"));
      until("Android production chat preview", "window.qidaoFixture && window.Capacitor?.isNativePlatform?.() && document.documentElement.dataset.material === 'liquid' && document.body?.innerText?.includes('你想从哪儿说')");
      until("wallpaper loaded", "document.querySelector('.background-canvas img')?.naturalWidth > 0");
      System.out.println("QIDAO_THINKING_APP_READY");
      openThinkingSheet();
      System.out.println("QIDAO_THINKING_DIALOG_READY");
      screenshot("thinking-original.png");

      String translate = "document.querySelector('.lq-dialog--sheet button[aria-label=\"思考内容中文翻译\"]')";
      evaluate(translate + ".click()");
      until("translated sample visible", translate + ".getAttribute('aria-pressed') === 'true' && document.body?.innerText?.includes('给她留出说话的空间')");
      screenshot("thinking-translated.png");
      evaluate(translate + ".click()");
      until("original restored", translate + ".getAttribute('aria-pressed') === 'false' && document.body?.innerText?.includes('Give her room to talk')");

      evaluate("document.querySelector('.lq-dialog--sheet button[aria-label=关闭]').click()");
      until("thinking sheet closed", "!document.querySelector('.lq-dialog--sheet.backdrop-blur-2xl')");
      evaluate("window.qidaoFixture.setThinkingPreviewTone('light')");
      until("light text settings applied", "window.qidaoFixture.read().settings.textTone === 'light'");
      openThinkingSheet();
      screenshot("thinking-light-text.png");
      System.out.println("QIDAO_THINKING_PASS actual Android app, white glass with both text tones, translation and return to original");
    } finally {
      scenario.close();
    }
  }
}
