/**
 * 闹钟铃声。
 *
 * 用 WebAudio 现场合成，不打包任何音频文件 ——
 * 好处：不占体积、不用管版权、想改音色改两行就行。
 * 音型是"叮—叮，停一拍"的循环，节奏像闹钟而不是通知。
 */

let ctx: AudioContext | null = null;
let timer = 0;

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function beepOnce(t: number, freq: number, when: number, len: number, vol: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(vol, when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + len);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + len + 0.02);
  void t;
}

export function startRinging() {
  stopRinging();
  const AC = audioCtor();
  if (!AC) return;
  try {
    ctx = ctx ?? new AC();
    void ctx.resume();
  } catch {
    return;
  }
  const round = () => {
    if (!ctx) return;
    const now = ctx.currentTime;
    beepOnce(now, 880, now, 0.34, 0.3);
    beepOnce(now, 1180, now + 0.24, 0.34, 0.3);
  };
  round();
  timer = window.setInterval(round, 1500);
}

export function stopRinging() {
  if (timer) {
    window.clearInterval(timer);
    timer = 0;
  }
}

/** 试听一下（设置页里那个"听一下"按钮用） */
export function previewRing() {
  startRinging();
  window.setTimeout(stopRinging, 2600);
}
