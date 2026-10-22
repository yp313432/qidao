/**
 * 「按住说话、松手发送」的验证（用户 m11719 / m11723）。
 *
 * 手势规则只有一种：按下就录、松手就停并直接发出去（不需要再点一次）、上滑取消。
 * 这个探针模拟一次真实的 press → hold 1.2s → release，检查：
 *   1) 按下后出现录音条（时间在走）
 *   2) 松手后录音条消失
 *   3) 松手后**自动**多出一条语音气泡（不用再点）
 *   4) 控制台没有报错
 *
 * 麦克风用 chrome 的 fake device，不需要真声卡。
 */
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://localhost:8080";

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  permissions: ["microphone"],
  hasTouch: false,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);

// 干净的会话
await page.evaluate(async () => {
  const { useApp } = await import("/src/lib/store.ts");
  useApp.getState().newChat();
});
await page.waitForTimeout(700);

const mic = page.locator('button[aria-label="按住说话"]');
const micCount = await mic.count();
if (!micCount) {
  console.log(JSON.stringify({ ok: false, why: "找不到麦克风按钮（aria-label=按住说话）" }));
  await browser.close();
  process.exit(0);
}

const box = await mic.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

async function pointer(type) {
  await page.evaluate(
    ({ type, cx, cy }) => {
      const el = document.elementFromPoint(cx, cy);
      const target = el?.closest("button") ?? el;
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse",
          clientX: cx,
          clientY: cy,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    },
    { type, cx, cy },
  );
}

// 按下 → 保持 1.2 秒
await pointer("pointerdown");
await page.waitForTimeout(1200);
const duringRec = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    recBar: /松开发送/.test(txt),
    secs: (txt.match(/(\d+)"\s*松开发送/) ?? [])[1] ?? null,
  };
});

// 松手 → 应当自动停 + 发
await pointer("pointerup");
await page.waitForTimeout(3500);

/**
 * 只看 DOM —— **不要**用 `import("/src/lib/store.ts")` 读状态：那是探针自己的
 * 一份模块实例，跟页面里跑的不是同一个，读到的 `conversations` 永远是空的
 * （这个坑已经踩过两次，m05603 / 本轮）。
 */
const after = await page.evaluate(() => {
  const txt = document.body.innerText;
  const audios = [...document.querySelectorAll("audio")];
  return {
    recBarGone: !/松开发送/.test(txt),
    audioBubbles: audios.length,
    voiceBubble: /\d+"/.test(txt),
    errText: /没录到声音|再试一次/.test(txt) ? "没录到声音" : "",
    tailText: txt.slice(-120).replace(/\s+/g, " "),
  };
});

await page.screenshot({ path: "shot-press-to-talk.png" });

console.log(
  JSON.stringify(
    {
      ok:
        duringRec.recBar &&
        after.recBarGone &&
        after.audioBubbles >= 1 &&
        after.voiceBubble,
      duringRec,
      after,
      errors,
    },
    null,
    2,
  ),
);

await browser.close();
