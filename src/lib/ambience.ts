import { PadPlayer, TRACKS } from "@/lib/music";

/**
 * 氛围音（白噪音那类垫音）。
 * 复用原来那套 WebAudio 垫音引擎，把它从「页面里的玩具」变成他可以调用的能力。
 */

let pad: PadPlayer | null = null;

export function ambiencePlaying(): boolean {
  return Boolean(pad?.playing);
}

/** 播放 / 停止氛围音，返回一句结果说明。 */
export async function toggleAmbience(index = 0): Promise<string> {
  if (typeof window === "undefined") return "只能在浏览器里播";
  if (!pad) pad = new PadPlayer();
  if (pad.playing) {
    pad.stopOsc();
    return "氛围音已停";
  }
  const track = TRACKS[((index % TRACKS.length) + TRACKS.length) % TRACKS.length]!;
  // 浏览器的音频上下文可能被挂起，卡住就别让动作一直悬着
  const ok = await Promise.race([
    pad.start(track).then(() => true),
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 1800)),
  ]);
  return ok
    ? `开始播放氛围音「${track.title}」`
    : "浏览器拦住了音频（需要先有一次真实点击）";
}
