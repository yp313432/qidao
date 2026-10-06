/**
 * 验收脚本：**句子级"边说边念"**（通话模式的第二刀）。
 *
 * 原来：等模型把整段回完 → 一次性合成 → 播放（到听见第一个字 = 转写 + 整段生成 + 合成）。
 * 现在：流式文本一凑满一句就送去合成，成一句念一句。
 *
 * 两段验（跟 VAD 那次同一个思路 —— 判定最怕"看着像对的"）：
 *   ① **切句子**是纯逻辑：喂流式片段，断言该切才切、尾巴不丢、不重复。
 *   ② **接线**：真语音页跑一轮 —— 假麦克风喂"1 秒声音 + 2 秒静音"（VAD 会自己收尾），
 *      假上游**分三段、每段隔 700ms** 慢慢吐一句回复，假 TTS 每次立刻返回一小段音频。
 *      核心指标：**第一次合成请求发生在整段回复吐完之前**。
 *
 * 跑法：node verify-voice-stream.mjs （要 dev server 在 8080）
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = process.env.QIDAO_BASE ?? "http://127.0.0.1:8080";
const WORK = "C:\\Users\\yanping\\Desktop\\ds-workspace\\preview-shots";
const UP_PORT = 4612;
const UP_BASE = `http://127.0.0.1:${UP_PORT}/v1`;

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/* ── 0. 造两段 WAV：TTS 的"一小句"、麦克风的"1 秒声音+2 秒静音" ── */
function makeWav({ toneMs = 400, silenceMs = 0, sampleRate = 16000 } = {}) {
  const total = Math.round((sampleRate * (toneMs + silenceMs)) / 1000);
  const toneSamples = Math.round((sampleRate * toneMs) / 1000);
  const data = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i += 1) {
    let v = 0;
    if (i < toneSamples) {
      const env = Math.min(1, i / 300, (toneSamples - i) / 300);
      v = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5 * env;
    }
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
mkdirSync(WORK, { recursive: true });
const micWav = `${WORK}\\vad-tone.wav`;
if (!existsSync(micWav)) writeFileSync(micWav, makeWav({ toneMs: 1000, silenceMs: 2000 }));
const lineWav = makeWav({ toneMs: 400 });

/* ── 1. 假上游：分三段、每段隔 700ms 吐一句回复 ── */
const REPLY_PARTS = ["好呀，", "我在听。今天想聊点什么？", "我随时都在。"];
const ttsCalls = [];
const sttCalls = [];
/** 只记**第一轮**那次上游请求的起止 —— 比较必须同一轮内才有意义 */
let firstUp = { start: 0, end: 0 };
const readBody = (req) =>
  new Promise((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => r(b));
  });

const up = createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  // 语音服务：转写
  if (req.url?.includes("/audio/transcriptions")) {
    await readBody(req);
    sttCalls.push(Date.now());
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ text: "你好呀，今天天气不错" }));
    return;
  }
  // 语音服务：合成
  if (req.url?.includes("/audio/speech")) {
    await readBody(req);
    ttsCalls.push(Date.now());
    res.writeHead(200, { "content-type": "audio/wav", ...cors });
    res.end(lineWav);
    return;
  }
  if (req.method === "GET" && req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
    return;
  }
  if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
    await readBody(req);
    const startedAt = Date.now();
    const isFirst = firstUp.start === 0;
    if (isFirst) firstUp.start = startedAt;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...cors });
    for (const part of REPLY_PARTS) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 700));
    }
    res.write("data: [DONE]\n\n");
    res.end();
    if (isFirst) firstUp.end = Date.now();
    return;
  }
  res.writeHead(404, { "content-type": "application/json", ...cors });
  res.end("{}");
});
await new Promise((r) => up.listen(UP_PORT, "127.0.0.1", r));

/* ── 2. 浏览器 ── */
const browser = await chromium.launch({
  channel: "msedge",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${micWav}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("  ⚠️ 页面报错:", e.message));

await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded", timeout: 60000 });

/* ── ① 纯逻辑：切句子 ── */
console.log("=== ① 切句子（纯逻辑）===");
const split = await page.evaluate(async () => {
  const { createSentenceStreamer } = await import("/src/lib/speech-queue.ts");
  const s = createSentenceStreamer();
  const first = [...s.push("好呀，")];
  const second = [...s.push("我在听。今天想聊"), ...s.push("点什么？"), ...s.push("我随时都在。")];
  const tail = s.flush();

  const s2 = createSentenceStreamer();
  const long = `${"啊".repeat(30)}，${"呀".repeat(30)}，${"哦".repeat(30)}`;
  const chunks = s2.push(long);
  const tail2 = s2.flush();
  return { first, second, tail, chunks, tail2 };
});
check("① 半句不会提前切出来（还没到句号就先攒着）", split.first.length === 0, JSON.stringify(split.first));
check(
  "① 凑满有标点的一句就切出来（逗号攒着、句号成句）",
  split.second.length === 3 && split.second[0] === "好呀，我在听。",
  JSON.stringify(split.second),
);
check("① 尾巴是空的（没有丢字也没重复）", split.tail === "", JSON.stringify(split.tail));
check(
  "① 没标点的长句在逗号处先断（首句不用无限等）",
  split.chunks.length >= 1 && split.chunks[0].endsWith("，") && split.chunks[0].length <= 62,
  JSON.stringify(split.chunks.map((c) => c.length)),
);
check("① 断完之后剩下的还能交出来", split.tail2.length > 0, `剩余 ${split.tail2.length} 字`);

/* ── ② 接线 ── */
console.log("\n=== ② 接线（真语音页 + 假上游慢慢吐 + 假 TTS）===");
// 先把"自定义上游 + 语音服务"写进 IndexedDB，否则走不到我们要验的那条路
await page.evaluate(
  async ([upBase]) => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("qidao-store", 1);
      r.onsuccess = () => res(r.result);
    });
    const raw = await new Promise((res) => {
      const tx = db.transaction("kv", "readonly");
      const g = tx.objectStore("kv").get("aster-app");
      g.onsuccess = () => res(g.result);
    });
    const parsed = JSON.parse(raw);
    parsed.state.settings = {
      ...parsed.state.settings,
      customBaseUrl: upBase,
      customApiKey: "stub-key",
      upstreamModel: "stub-model",
      voiceBaseUrl: upBase,
      voiceApiKey: "stub-voice-key",
      voiceSubtitles: true,
    };
    await new Promise((res) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(parsed), "aster-app");
      tx.oncomplete = res;
    });
  },
  [UP_BASE],
);

await page.goto(`${BASE}/voice`, { waitUntil: "domcontentloaded", timeout: 60000 });
// 进页面就会开始听；VAD 约 1.7 秒收尾 → 转写 → 上游分三段吐 → 边吐边合成
for (let i = 0; i < 90 && ttsCalls.length < 2; i += 1) await page.waitForTimeout(500);
await page.waitForTimeout(1200);

const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
console.log(`   转写请求 ${sttCalls.length} 次；合成请求 ${ttsCalls.length} 次`);
console.log(`   页面片段: ${bodyText.slice(0, 110)}`);

check("② 录音被转写了（这一轮真的转起来了）", sttCalls.length >= 1, `${sttCalls.length} 次`);
check("② 假 TTS 被调用（他真的开口了）", ttsCalls.length >= 1, `${ttsCalls.length} 次`);
check(
  "② 句子被拆成多次合成（不是整段一次）",
  ttsCalls.length >= 2,
  `${ttsCalls.length} 次 / 回复共 ${REPLY_PARTS.length} 段`,
);
if (ttsCalls.length >= 1 && firstUp.end > 0) {
  // 必须是**同一轮**里的比较：第一轮的首次合成 vs 第一轮上游吐完
  const early = Math.round(firstUp.end - ttsCalls[0]);
  check(
    "② **第一句的合成发生在同一轮回复吐完之前**（这就是边生成边念）",
    ttsCalls[0] > firstUp.start && early > 300,
    `首次合成比这一轮吐完早 ${early}ms（这一轮共约 ${Math.round(firstUp.end - firstUp.start)}ms）`,
  );
}

console.log("-".repeat(64));
console.log(`边说边念验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);

await browser.close();
up.close();
process.exit(bad === 0 ? 0 : 1);
