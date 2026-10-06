import type { Attachment } from "@/lib/types";
import { createVad, rmsOfWaveform } from "@/lib/vad";
import { uid } from "@/lib/utils";

/**
 * 语音消息：录一段，像微信那样发出去。
 *
 * 两件事同时做：
 *  1. MediaRecorder 录**真实音频** —— 气泡里能点开听，是原声不是合成。
 *  2. 浏览器的语音识别**顺带转写** —— 这样他才「听得懂」。模型本身收不到音频，
 *     文字才是他能读到的部分。转写失败不影响发送，只是他看不懂内容。
 *
 * 需要 https 或 localhost：局域网明文 http 下浏览器不给麦克风。
 */

const MAX_MS = 60_000;

export function recordSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export type Recorder = {
  startedAt: number;
  elapsed: () => number;
  /** 停止并产出附件；取消过、或没录到东西就返回 null */
  stop: () => Promise<Attachment | null>;
  cancel: () => void;
  /**
   * 录音**自己结束**时（说完自动停）带着附件 resolve。
   *
   * 为什么要有它：开着"说完自动停"时，没有任何人去点停止 ——
   * 调用方得有个东西可以 await。手动 `stop()` 也会让同一个 promise 落地，
   * 所以两种情况用同一个等待点，不需要判断谁先谁后。
   */
  done: Promise<Attachment | null>;
};

export type RecordOptions = {
  /**
   * **说完自动停**：连续这么久没声音就结束录音（毫秒）。
   * 不传 = 老行为（录到手动停或到上限）—— 语音消息那条路不受影响。
   */
  stopOnSilenceMs?: number;
  /** 最长录多久（默认 60 秒；通话模式会传更短的值） */
  maxMs?: number;
  /** 每次采样回调音量（0-1），给界面画波形/显示"听见了"用 */
  onLevel?: (rms: number) => void;
};

export async function startRecording(
  onTick?: (ms: number) => void,
  opts: RecordOptions = {},
): Promise<Recorder> {
  if (!recordSupported()) {
    throw new Error("这个浏览器不支持录音（需要 https 或 localhost）");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: Blob[] = [];
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";

  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const startedAt = Date.now();
  let cancelled = false;
  let finalized = false;

  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  rec.start(250);

  /**
   * ── 这里**原来**还开了一个 webkitSpeechRecognition 想"顺带转写" ──────────
   *
   * 已删除（用户报"语音时不顺畅很卡、有时候能反应过来有时候不能"）。
   *
   * 为什么必须删：**两个东西同时向系统要麦克风**。
   * MediaRecorder 已经占住了输入设备，再让 SpeechRecognition 去开一路，
   * 安卓上经常直接抛 NotReadableError，或者把录音这一路也打断 ——
   * 表现就是"时好时坏"，因为谁先抢到设备是随机的。
   *
   * 而且配了「语音服务」时**根本不需要它**：那条路是
   * "自己录音 → 上传给语音服务转文字（transcribe）"，识别在上游做，
   * 这里再开一个浏览器识别纯属多余，只会抢设备。
   *
   * 语音消息里显示的文字，现在由**语音服务**负责（voice-service.transcribe）；
   * 没配语音服务时不显示文字，但录音本身是干净、稳定的 —— 这个取舍是对的：
   * 宁可没有转写文字，也不能把录音搞坏。
   */
  const transcript = "";

  /**
   * ── 说完自动停（通话模式）────────────────────────────────────────────
   *
   * 原来的语音服务那条路是**固定录 6 秒**：你说 1 秒说完，还要再干等 5 秒。
   * 这里接上一路音量分析：连续 `stopOnSilenceMs` 低于阈值就自己收尾。
   *
   * 用的是**同一个 stream**（不再开第二个麦克风 —— 这个项目已经被
   * "两路抢设备"坑过一次，见上面那段注释）。
   */
  let audioCtx: AudioContext | null = null;
  let levelTimer = 0;
  if (opts.stopOnSilenceMs && opts.stopOnSilenceMs > 0) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      try {
        audioCtx = new Ctor();
        // 有些环境（含安卓 WebView）新建的 AudioContext 是 suspended 的 ——
        // 那样 analyser 只会读到全零，等于永远"没声音"，说完自动停就废了
        if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => undefined);
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const wave = new Uint8Array(analyser.fftSize);
        const vad = createVad({
          silenceMs: opts.stopOnSilenceMs,
          maxMs: opts.maxMs ?? MAX_MS,
        });
        levelTimer = window.setInterval(() => {
          analyser.getByteTimeDomainData(wave);
          const rms = rmsOfWaveform(wave);
          opts.onLevel?.(rms);
          const decision = vad.push(rms, Date.now());
          // done = 说完了；silent = 一直没说话（界面会提示"没听到"）
          if (decision === "done" || decision === "silent") void finish(false);
        }, 50);
      } catch {
        // 拿不到 AudioContext 就退回"手动停/到上限"的老行为，不能让录音整个废掉
        audioCtx = null;
        levelTimer = 0;
      }
    }
  }

  const timer = onTick
    ? window.setInterval(() => {
        const ms = Date.now() - startedAt;
        onTick(ms);
        if (ms >= (opts.maxMs ?? MAX_MS)) void finish(false);
      }, 200)
    : 0;

  function shutdown() {
    if (timer) window.clearInterval(timer);
    if (levelTimer) window.clearInterval(levelTimer);
    if (audioCtx) {
      void audioCtx.close().catch(() => undefined);
      audioCtx = null;
    }
    for (const t of stream.getTracks()) t.stop();
  }

  /**
   * ⚠️ `finish` 必须**记住那一次的结果**。
   *
   * 踩过的坑：说完自动停会自己调一次 `finish(false)`，而调用方随后 `stop()`
   * 又会调一次 —— 原来的写法第二次会直接 `return null`（`finalized` 已经 true），
   * 于是**自动停辛苦录到的那段音频被丢掉**，调用方拿到 null 报"没录到声音"。
   * 所以第一次调用就把 promise 存下来，谁问都返回同一个。
   */
  let finished: Promise<Attachment | null> | null = null;

  /**
   * `done`：**录音自己结束**时落地的 promise。
   *
   * ⚠️ 它必须在**录音创建时就挂好**，而不是"读它的时候才去收尾"。
   * 第一版就是写成 getter → `finish(false)`，结果调用方一 `await rec.done`
   * 就立刻把录音掐了（实测 90ms、0 字节）—— 名字叫"done"却干着"stop"的事，
   * 这种错最阴的地方是**测试里看着像"自动停生效了"**（它确实立刻停了）。
   */
  let resolveDone: ((att: Attachment | null) => void) | null = null;
  const donePromise = new Promise<Attachment | null>((resolve) => {
    resolveDone = resolve;
  });

  function finish(wasCancelled: boolean): Promise<Attachment | null> {
    if (!finished) {
      finished = doFinish(wasCancelled).then((att) => {
        resolveDone?.(att);
        return att;
      });
    }
    return finished;
  }

  async function doFinish(wasCancelled: boolean): Promise<Attachment | null> {
    if (finalized) return null;
    finalized = true;
    const durationMs = Date.now() - startedAt;

    /**
     * 等 MediaRecorder 收尾。
     *
     * ⚠️ **必须带超时兜底**：`onstop` 在某些情况下不会触发
     * （比如还没采到任何数据就 stop、或者轨道已经被系统收走）。
     * 原来这里就是干等 —— 一旦不触发，stop() 永远挂着，
     * 界面就卡在"正在录音"，点停止/发送都没反应（用户报的"像卡住了"）。
     * 800ms 足够正常收尾，等不到就继续往下走（chunks 里有多少算多少）。
     */
    await new Promise<void>((resolve) => {
      let done = false;
      const bail = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve();
      }, 800);
      rec.onstop = () => {
        if (done) return;
        done = true;
        window.clearTimeout(bail);
        resolve();
      };
      try {
        if (rec.state !== "inactive") rec.stop();
        else {
          if (!done) {
            done = true;
            window.clearTimeout(bail);
            resolve();
          }
        }
      } catch {
        if (!done) {
          done = true;
          window.clearTimeout(bail);
          resolve();
        }
      }
    });
    shutdown();

    if (wasCancelled || cancelled || chunks.length === 0) return null;

    const blob = new Blob(chunks, { type: mime || "audio/webm" });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error ?? new Error("读音频失败"));
      fr.readAsDataURL(blob);
    });

    return {
      id: uid(),
      kind: "audio",
      name: `语音 ${Math.max(1, Math.round(durationMs / 1000))}秒`,
      mime: blob.type,
      size: blob.size,
      dataUrl,
      durationMs,
      text: transcript || undefined,
    };
  }

  return {
    startedAt,
    elapsed: () => Date.now() - startedAt,
    stop: () => finish(false),
    cancel: () => {
      cancelled = true;
      void finish(true);
    },
    // 注意：**读它不会停止录音**，只是等它结束（说完自动停 / 手动停 / 到上限）
    done: donePromise,
  };
}
