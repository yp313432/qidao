/**
 * 验收脚本：**说完自动停**（轻量 VAD）。
 *
 * 用户的原话："那个说完等 6 秒时间也太长"。改法是连续静音 700ms 就收尾。
 *
 * 为什么分两段验：
 *   ① **判定逻辑**：喂合成的音量序列（纯函数，时间是我自己给的），
 *      断言"该停的时候停、不该停的时候别停" —— 阈值/抖动这类事只能这么验。
 *   ② **接线**：用 Chrome 的假音频设备 + **我自己合成的 WAV**
 *      （1 秒声音 + 2 秒静音），跑真的 MediaRecorder + AnalyserNode，
 *      看它是不是在 ~1.7 秒就收尾了（而不是等到上限）。
 *
 * 跑法：node verify-voice-vad.mjs （要 dev server 在 8080）
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const WORK = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ── 0. 合成一段 WAV：1 秒 440Hz 正弦（=有人在说话）+ 2 秒静音 ── */
function makeWav({ sampleRate = 16000, toneMs = 1000, silenceMs = 2000 }) {
  const total = Math.round((sampleRate * (toneMs + silenceMs)) / 1000);
  const toneSamples = Math.round((sampleRate * toneMs) / 1000);
  const data = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i += 1) {
    let v = 0;
    if (i < toneSamples) {
      // 淡入淡出，免得一上来一个爆音
      const env = Math.min(1, i / 400, (toneSamples - i) / 400);
      v = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.6 * env;
    }
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // 单声道
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

mkdirSync(WORK, { recursive: true });
const wavPath = `${WORK}\\vad-tone.wav`;
writeFileSync(wavPath, makeWav({}));
console.log(`合成测试音频：${wavPath}\n`);

/* ── 浏览器：假麦克风 = 上面那段 WAV（自动允许权限）── */
const browser = await chromium.launch({
  channel: "msedge",
  args: [
    "--use-fake-ui-for-media-stream",
    // ⚠️ 两个开关都要：只给文件不开"假设备"，那个文件会被忽略 → 拿到的是纯静音
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wavPath}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));
await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });

/* ── ① 判定逻辑（纯函数，时间自己给）── */
console.log("=== ① 判定逻辑（合成音量序列）===");
const logic = await page.evaluate(async () => {
  const { createVad } = await import("/src/lib/vad.ts");
  const step = 50;
  const QUIET = 0.002;
  const LOUD = 0.08;

  /** 按毫秒序列喂数据，返回每一步的判定 */
  function feed(vad, spec) {
    let t = 0;
    const out = [];
    for (const [rms, ms] of spec) {
      for (let acc = 0; acc < ms; acc += step) {
        out.push({ t, d: vad.push(rms, t) });
        t += step;
      }
    }
    return out;
  }
  const last = (arr) => arr[arr.length - 1]?.d;
  const firstDone = (arr) => arr.find((x) => x.d === "done")?.t ?? null;

  // A: 300ms 静音 → 800ms 说话 → 700ms 静音
  const A = feed(createVad({ silenceMs: 700, minSpeechMs: 150, noSpeechMs: 3000, maxMs: 10000 }), [
    [QUIET, 300],
    [LOUD, 800],
    [QUIET, 700],
  ]);
  const quietPart = A.filter((x) => x.t < 300);
  const doneAt = firstDone(A);

  // B: 说话中夹一个 300ms 的短停顿（不该判成"说完"）
  const B = feed(createVad({ silenceMs: 700, minSpeechMs: 150, maxMs: 10000 }), [
    [LOUD, 500],
    [QUIET, 300],
    [LOUD, 500],
    [QUIET, 700],
  ]);
  const gapStart = 500;
  const doneInGap = B.find((x) => x.d === "done" && x.t < 1300) ?? null;

  // C: 一直没说话
  const C = feed(createVad({ silenceMs: 700, noSpeechMs: 1000, maxMs: 10000 }), [[QUIET, 1500]]);

  // D: 一直说个没完 → 到上限才结束
  const D = feed(createVad({ silenceMs: 700, maxMs: 2000 }), [[LOUD, 3000]]);

  return {
    quietAllWaiting: quietPart.every((x) => x.d === "waiting"),
    spokeData: last(A),
    doneAt,
    bDoneEarly: Boolean(doneInGap),
    bLast: last(B),
    cLast: last(C),
    dDoneAt: firstDone(D),
    gapStart,
  };
});

check("① 还没开始说话时不会秒停（都是 waiting）", logic.quietAllWaiting);
check("① 说过话之后判成「speaking」", logic.spokeData === "speaking" || logic.spokeData === "done");
check(
  "① 静音 700ms 才收尾（≈1000+700=1700ms，不是一静音就停）",
  logic.doneAt !== null && logic.doneAt >= 1650 && logic.doneAt <= 1800,
  `doneAt=${logic.doneAt}ms`,
);
check("① 短停顿（300ms）不会被误判成说完", !logic.bDoneEarly, `最后一次判定=${logic.bLast}`);
check("① 一直没说话 → 超时给出 silent（界面好提示「没听到」）", logic.cLast === "silent");
check("① 说个没完 → 到上限强制结束", logic.dDoneAt !== null && logic.dDoneAt <= 2050, `doneAt=${logic.dDoneAt}ms`);

/* ── ② 接线：真 MediaRecorder + AnalyserNode + 那段 WAV ── */
console.log("\n=== ② 接线（真录音设备，输入 = 1 秒声音 + 2 秒静音）===");
const wired = await page.evaluate(async () => {
  const { startRecording } = await import("/src/lib/record.ts");
  const levels = [];
  const stamps = [];
  const t0 = performance.now();
  const rec = await startRecording(undefined, {
    stopOnSilenceMs: 700,
    maxMs: 8000,
    onLevel: (r) => {
      levels.push(Number(r.toFixed(4)));
      if (stamps.length < 40) stamps.push(`${Math.round(performance.now() - t0)}ms:${r.toFixed(3)}`);
    },
  });
  const att = await rec.done;
  const ms = Math.round(performance.now() - t0);
  // 录音器有没有把麦克风还回去？再开一次就知道（这个项目被占死过）
  let reacquired = false;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    reacquired = true;
    for (const t of s.getTracks()) t.stop();
  } catch {
    reacquired = false;
  }
  return {
    ms,
    hasAudio: Boolean(att?.dataUrl),
    size: att?.size ?? 0,
    durationMs: att?.durationMs ?? 0,
    sampleCount: levels.length,
    maxLevel: levels.length ? Math.max(...levels) : 0,
    stamps,
    reacquired,
  };
});
console.log(`   采样 ${wired.sampleCount} 次，最大音量 ${wired.maxLevel}`);
console.log(`   前若干次采样: ${wired.stamps.slice(0, 14).join("  ")}`);

check("② 录音**自己结束了**（不是等上限 8 秒）", wired.ms < 5000, `实际 ${wired.ms}ms`);
check("② 那一刻大约在「声音结束 + 700ms」附近", wired.ms >= 1200, `实际 ${wired.ms}ms`);
check("② 拿到了真实音频（不是空录音）", wired.hasAudio && wired.size > 1000, `${wired.size} 字节 / ${wired.durationMs}ms`);
check("② 采样到的音量确实有起伏（听见了那段声音）", wired.maxLevel > 0.05, `最大音量=${wired.maxLevel.toFixed(3)}`);
check("② 录完把麦克风还回去了（能再开一次）", wired.reacquired);

console.log("-".repeat(64));
console.log(`说完自动停验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
process.exit(bad === 0 ? 0 : 1);
