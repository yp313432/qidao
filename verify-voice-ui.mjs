/**
 * 验收脚本：语音通话页的**界面**（头像 / 光环 / 波形 / 按键）+ **屏幕不自动锁**。
 *
 * 要证明的几件事（不能只看"画出来了"）：
 *   ① 头像 + 两层光环 + 17 根波形柱都在；按键是「再说一次 / 挂断」；底部导航还在
 *   ② **波形真的由麦克风音量驱动** —— 喂**纯静音**和**持续声音**各跑一次，
 *      两次都在"听你说"那一段采样：有声音的柱子必须明显更高。
 *      （这一条是"真音量"和"固定动画"的分水岭：如果是动画，两次会一样高。）
 *   ③ **"屏幕别自己锁"的锁：进页面申请、离开页面释放**（用桩记调用时机；
 *      离开用**客户端跳转**，整页跳转会重置桩）
 *   ④ 全程没有 hydration 不一致
 *
 * ⚠️ ③ 验的是**我们的调用时机**，不是"真机上锁屏会不会断" ——
 *    后者要安卓前台服务 + 真机（文档写明了）。
 *
 * 跑法：node verify-voice-ui.mjs （要 dev server 在 8080）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const WORK = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";
mkdirSync(WORK, { recursive: true });

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/** 造一段 WAV：durationMs 里前 toneMs 出声，其余静音 */
function makeWav({ toneMs, durationMs, sampleRate = 16000 }) {
  const total = Math.round((sampleRate * durationMs) / 1000);
  const tone = Math.round((sampleRate * toneMs) / 1000);
  const data = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i += 1) {
    let v = 0;
    if (i < tone) {
      const env = i < 300 ? i / 300 : 1;
      v = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.55 * env;
    }
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const loudWav = `${WORK}\\ui-loud.wav`;
const quietWav = `${WORK}\\ui-quiet.wav`;
writeFileSync(loudWav, makeWav({ toneMs: 30000, durationMs: 30000 })); // 一直有声音
writeFileSync(quietWav, makeWav({ toneMs: 0, durationMs: 30000 })); // 一直安静

/** 起一个浏览器，进通话页；可选采样波形高度；返回结果后关掉 */
async function run({ wav, sampleMs = 0 }) {
  const browser = await chromium.launch({
    channel: "msedge",
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    permissions: ["microphone"],
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.addInitScript(() => {
    const w = window;
    w.__wake = { requests: [], releases: 0 };
    // ⚠️ 必须 defineProperty：navigator.wakeLock 是只读访问器，直接赋值会**静默失败**
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async (type) => {
          w.__wake.requests.push(type);
          return {
            released: false,
            release: async () => {
              w.__wake.releases += 1;
            },
            addEventListener: () => undefined,
          };
        },
      },
    });
  });

  await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  /*
    ⚠️ 必须配「语音服务」：否则 startListening 会走浏览器自带识别那条路，
    那条路**没有 VAD、拿不到麦克风音量** → 波形不动，② 会假失败
    （第一版就是这么白跑一场）。地址指向一个不存在的端口没关系 ——
    我们要的是"录音 + 音量分析"这一段真的跑起来。
  */
  await page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("qidao-store", 1);
      r.onsuccess = () => res(r.result);
    });
    const raw = await new Promise((res) => {
      const tx = db.transaction("kv", "readonly");
      const g = tx.objectStore("kv").get("aster-app");
      g.onsuccess = () => res(g.result);
    });
    const p = JSON.parse(raw);
    p.state.settings = {
      ...p.state.settings,
      voiceBaseUrl: "http://127.0.0.1:4620/v1",
      voiceApiKey: "stub-voice-key",
    };
    await new Promise((res) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(p), "aster-app");
      tx.oncomplete = res;
    });
  });

  await page.goto(`${BASE}/voice`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(700);

  let heights = [];
  let sawListening = false;
  if (sampleMs > 0) {
    // 直接连续采样：有声音那版会一直停在「听你说」（持续有声 → VAD 不会收尾）
    const deadline = Date.now() + sampleMs;
    while (Date.now() < deadline) {
      if ((await page.locator("body").innerText()).includes("听你说")) sawListening = true;
      const hs = await page.$$eval("span.w-\\[3px\\]", (els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().height)),
      );
      heights = heights.concat(hs);
      await page.waitForTimeout(120);
    }
  }

  return {
    page,
    browser,
    consoleErrors,
    heights,
    sawListening,
    stats: {
      max: heights.length ? Math.max(...heights) : 0,
      min: heights.length ? Math.min(...heights) : 0,
    },
  };
}

/* ── ① + ② + ③ 一次跑（有声音那版）── */
const runA = await run({ wav: loudWav, sampleMs: 1500 });
const page = runA.page;
const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");

check("① 头像在（AI 头像那圈）", (await page.locator("button[aria-label='开始聆听'] span.overflow-hidden").count()) === 1);
check("① 两层光环都在", (await page.locator(".voice-halo").count()) === 2, `${await page.locator(".voice-halo").count()} 层`);
check("① 波形柱子在（17 根）", (await page.locator("span.w-\\[3px\\]").count()) === 17);
check("① 按键是「再说一次 / 挂断」", text.includes("再说一次") && text.includes("挂断"));
check("① 底部导航还在（这一页不是全屏页）", (await page.locator('nav[aria-label="主导航"]').count()) === 1);
check("① 如实写着半双工", text.includes("半双工"));
await page.screenshot({ caret: "initial", path: `${WORK}\\voice-call.png` });

const wakeOnEnter = await page.evaluate(() => window.__wake);
check(
  "③ 进通话页申请了 screen 锁",
  wakeOnEnter.requests.includes("screen"),
  JSON.stringify(wakeOnEnter.requests),
);

// ③ 离开：用**底部导航客户端跳转**（整页 goto 会把桩重置，第一版就白测了一场）
await page.locator('nav[aria-label="主导航"] a[href="/me"]').first().click();
await page.waitForTimeout(1200);
const wakeAfter = await page.evaluate(() => window.__wake);
check("③ 离开通话页把锁放了（不然屏幕一直不锁，费电）", wakeAfter.releases >= 1, `释放 ${wakeAfter.releases} 次`);

const hydration = runA.consoleErrors.filter((t) => /hydration/i.test(t));
check("全程没有 hydration 不一致", hydration.length === 0, hydration[0]?.slice(0, 110) ?? "");
await runA.browser.close();

/* ── ② 对照：一直安静那版 ── */
const runB = await run({ wav: quietWav, sampleMs: 1500 });
await runB.browser.close();

check(
  "② 波形由**真实音量**驱动（有声音明显更高，不是固定动画）",
  runA.stats.max - runB.stats.max >= 8,
  `有声最高 ${runA.stats.max}px（最低 ${runA.stats.min}）vs 安静最高 ${runB.stats.max}px`,
);
check("② 采样时确实处在「听你说」（脚本自检，防止测了个空）", runA.sawListening && runB.sawListening);

console.log("-".repeat(64));
console.log(`通话页界面验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
