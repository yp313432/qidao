export type Track = {
  id: string;
  title: string;
  artist: string;
  minutes: string;
  seed: number[];
  tempo: number;
};

export const TRACKS: Track[] = [
  { id: "mist", title: "晨雾", artist: "栖岛电台", minutes: "2:40", seed: [196, 247, 294, 392], tempo: 0.42 },
  { id: "paper", title: "纸窗", artist: "栖岛电台", minutes: "3:05", seed: [220, 261, 329, 392], tempo: 0.5 },
  { id: "night", title: "夜航", artist: "栖岛电台", minutes: "2:55", seed: [174, 220, 261, 349], tempo: 0.36 },
  { id: "grove", title: "林间", artist: "栖岛电台", minutes: "2:20", seed: [246, 293, 369, 440], tempo: 0.58 },
];

export class PadPlayer {
  private ctx: AudioContext | null = null;
  private nodes: OscillatorNode[] = [];
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private timer = 0;
  playing = false;
  track: Track = TRACKS[0]!;
  step = 0;

  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.connect(gain);
    gain.connect(ctx.destination);
    this.ctx = ctx;
    this.gain = gain;
    this.filter = filter;
    return ctx;
  }

  async start(track: Track) {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
    this.stopOsc();
    this.track = track;
    this.playing = true;
    this.step = 0;
    const now = ctx.currentTime;
    if (this.gain) {
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(this.gain.gain.value, now);
      this.gain.gain.linearRampToValueAtTime(0.08, now + 0.6);
    }
    this.tick();
  }

  private tick = () => {
    if (!this.playing || !this.ctx || !this.filter) return;
    const freqs = this.track.seed;
    const root = freqs[this.step % freqs.length]!;
    this.spawn(root);
    this.spawn(root * 1.5, 0.35);
    this.filter.frequency.linearRampToValueAtTime(700 + (this.step % 5) * 80, this.ctx.currentTime + 0.4);
    this.step += 1;
    this.timer = window.setTimeout(this.tick, 1000 / this.track.tempo);
  };

  private spawn(freq: number, vol = 0.55) {
    if (!this.ctx || !this.filter) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 * vol, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
    osc.connect(g);
    g.connect(this.filter);
    osc.start(t);
    osc.stop(t + 3.3);
    this.nodes.push(osc);
    osc.onended = () => {
      this.nodes = this.nodes.filter((n) => n !== osc);
    };
  }

  async pause() {
    this.playing = false;
    if (this.timer) window.clearTimeout(this.timer);
    if (this.gain && this.ctx) {
      const t = this.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.linearRampToValueAtTime(0.0001, t + 0.3);
    }
  }

  stopOsc() {
    this.playing = false;
    if (this.timer) window.clearTimeout(this.timer);
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.nodes = [];
  }
}

export const CHANNEL = "aster-listen";
