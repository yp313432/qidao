package com.yanping.qidao;

import android.app.Instrumentation;
import android.graphics.Bitmap;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
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

  private void seed(String textTone) throws Exception {
    evaluate("""
      (async (textTone) => {
        window.qidaoPreviewSeed = 'writing';
        try {
          const now = Date.now();
          const id = 'android-preview';
          const message = (suffix, role, content, elapsed) => ({
            id: id + '-' + suffix, role, content, createdAt: now - elapsed, thinking: '', thinkingDurationMs: 0,
          });
          const thoughts = [
            'Give her room to talk, and let her choose what to share.',
            'Keep the reply short and warm. There is no rush to find a solution.',
          ];
          const assistant = {
            ...message('4', 'assistant', '我在。你想从哪儿说，我们就从哪儿说。', 5000),
            thinking: thoughts.join(' '),
            thinkingDurationMs: 15000,
            steps: [
              {kind: 'think', text: thoughts[0]},
              {kind: 'call', call: {kind: 'memory.add', name: 'memory_add', ok: true,
                args: JSON.stringify({text: '她累的时候想有人陪着'}), result: '她累的时候想有人陪着'}},
              {kind: 'think', text: thoughts[1]},
            ],
          };
          const resource = performance.getEntriesByType('resource')
            .find(entry => new URL(entry.name).pathname.split('/').at(-1).startsWith('store-') &&
              !new URL(entry.name).pathname.split('/').at(-1).startsWith('store-ready-'));
          if (!resource) throw new Error('The production store chunk did not load');
          const appModule = await import(resource.name);
          const store = Object.values(appModule).find(value =>
            typeof value?.getState === 'function' && typeof value.getState().patchSettings === 'function');
          if (!store) throw new Error('The production chat store export is unavailable');
          const state = {
            activeId: id,
            conversations: [{id, title: '傍晚的对话', pinned: false, incognito: false,
              createdAt: now - 90000, updatedAt: now, messages: [
                message('1', 'user', '今天有点累，想说说话。', 85000),
                message('2', 'assistant', '想说就慢慢说，我听着。', 65000),
                message('3', 'user', '好像有很多话，不知道该从哪里说起。', 45000),
                assistant,
              ]}],
            settings: {
              material: 'liquid', textTone, showThinking: true, motion: 'off',
              aiName: '星芒', displayName: 'yan', notifications: false,
              wakeEnabled: false, autonomyEnabled: false, voiceReplies: false,
              chatCrab: {enabled: false, size: 32, activity: 'quiet'},
              background: {image: '/memory-universe/nebula.jpg', blur: 0, dim: 0.12, opacity: 1},
              customBaseUrl: 'http://127.0.0.1:4661/v1', customApiKey: 'android-preview', upstreamModel: 'android-preview',
            },
          };
          store.setState(previous => ({...state, settings: {...previous.settings, ...state.settings}}));
          window.qidaoPreviewSeed = 'saved';
        } catch (error) {
          window.qidaoPreviewSeed = String(error);
        }
      })
      """.strip() + "(" + JSONObject.quote(textTone) + ")");
    until("test conversation loaded into the running app", "window.qidaoPreviewSeed === 'saved'");
    System.out.println("QIDAO_THINKING_TEST_DATA_READY " + textTone);
    until("production chat with sample conversation",
      "window.Capacitor?.isNativePlatform?.() && document.documentElement.dataset.material === 'liquid' && document.body?.innerText?.includes('你想从哪儿说') && !document.querySelector('.boot-veil')");
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
    SystemClock.sleep(550);
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
      until("Capacitor WebView and app boot", "location.hostname === 'localhost' && window.Capacitor?.isNativePlatform?.() && !document.querySelector('.boot-veil') && document.body?.innerText.length > 0");
      SystemClock.sleep(1500);
      System.out.println("QIDAO_THINKING_APP_READY");
      seed("dark");
      openThinkingSheet();
      System.out.println("QIDAO_THINKING_DIALOG_READY");
      screenshot("thinking-original.png");

      String translate = "document.querySelector('.lq-dialog--sheet button[aria-label=\"思考内容中文翻译\"]')";
      evaluate(translate + ".click()");
      until("translated sample visible", translate + ".getAttribute('aria-pressed') === 'true' && document.body?.innerText?.includes('给她留出说话的空间')");
      screenshot("thinking-translated.png");
      evaluate(translate + ".click()");
      until("original restored", translate + ".getAttribute('aria-pressed') === 'false' && document.body?.innerText?.includes('Give her room to talk')");

      evaluate("document.querySelector('.lq-dialog--sheet button[aria-label=\"关闭\"]').click()");
      until("thinking sheet closed", "!document.querySelector('.lq-dialog--sheet.backdrop-blur-2xl')");
      seed("light");
      openThinkingSheet();
      screenshot("thinking-light-text.png");
      System.out.println("QIDAO_THINKING_PASS actual Android app, white glass with both text tones, translation and return to original");
    } finally {
      scenario.close();
    }
  }
}
