import { create } from "zustand";
import { readEmbeddedLyrics } from "@/lib/lyrics";
import {
  deleteTrack,
  isPersistent,
  listTracks,
  putTrack,
  saveLyrics as dbSaveLyrics,
  type LyricsSource,
  type MusicTrack,
} from "@/lib/music-db";
import { uid } from "@/lib/utils";

/**
 * 全局音乐播放器。
 *
 * 播放逻辑从页面搬到了这里，所以：
 *  - 切到别的页面音乐不会停（离开音乐页音频元素也还在）
 *  - MediaSession 能接管锁屏 / 通知栏
 *  - AI 的动作层可以直接操控它（播放、暂停、切歌、音量、跳转）
 *
 * `<audio>` 元素由 PlayerHost 挂载后交给这里（attachAudioElement）。
 */

const AUDIO_RE = /\.(mp3|m4a|m4b|aac|wav|flac|ogg|opus|wma|ape|aif|aiff|amr)$/i;

/** 供 UI 放进 <input accept> 的宽泛过滤，免得文件对话框空着。 */
export const AUDIO_ACCEPT =
  "audio/*,.mp3,.m4a,.m4b,.aac,.wav,.flac,.ogg,.opus,.wma,.ape,.aif,.aiff,.amr,.ncm,.kgm,.kgma,.kgg,.qmc0,.qmc2,.qmc3,.qmcflac,.qmcogg,.mflac,.mgg,.tm0,.tm2";

/**
 * 各家客户端的**加密格式**：浏览器解不开，我们也不去解密。
 *
 * 把这些后缀放进 accept 是有意的 —— 否则文件对话框会直接把 .ncm 藏起来，
 * 用户只会觉得「明明有文件却选不中」。让它选进来，然后给一句明确的解释。
 */
const ENCRYPTED_RE =
  /\.(ncm|kgm|kgma|kgg|qmc0|qmc2|qmc3|qmcflac|qmcogg|mflac|mgg|mgg1|tm0|tm2|xm|uc)$/i;

function encryptedFrom(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!ENCRYPTED_RE.test(name)) return null;
  if (ext === "ncm") return "网易云音乐的加密格式";
  if (["kgm", "kgma", "kgg"].includes(ext)) return "酷狗的加密格式";
  if (["qmc0", "qmc2", "qmc3", "qmcflac", "qmcogg", "mflac", "mgg", "mgg1", "tm0", "tm2"].includes(ext))
    return "QQ音乐的加密格式";
  if (ext === "xm") return "虾米的加密格式";
  return "某个客户端的加密格式";
}

let audio: HTMLAudioElement | null = null;
/** 换源之后要不要自动接着播 */
let wantPlay = false;

export function attachAudioElement(el: HTMLAudioElement | null) {
  audio = el;
}

export type PlayerState = {
  tracks: MusicTrack[];
  urls: Record<string, string>;
  currentId: string | null;
  playing: boolean;
  time: number;
  duration: number;
  loop: boolean;
  volume: number;
  loaded: boolean;
  busy: boolean;
  toast: string;
  notice: string;

  load: () => Promise<void>;
  addFiles: (files: File[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  writeLyrics: (id: string, text: string, source: LyricsSource) => Promise<MusicTrack | null>;

  select: (id: string) => void;
  play: (id?: string) => void;
  pause: () => void;
  toggle: () => void;
  step: (delta: number) => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  setLoop: (v: boolean) => void;
  playByQuery: (query: string) => string;
  findTracks: (query: string) => MusicTrack[];

  syncSource: () => void;
  flash: (msg: string) => void;
};

export const usePlayer = create<PlayerState>()((set, get) => ({
  tracks: [],
  urls: {},
  currentId: null,
  playing: false,
  time: 0,
  duration: 0,
  loop: false,
  volume: 1,
  loaded: false,
  busy: false,
  toast: "",
  notice: "",

  flash: (msg) => {
    set({ toast: msg });
    window.setTimeout(() => {
      if (get().toast === msg) set({ toast: "" });
    }, 2600);
  },

  load: async () => {
    try {
      const list = (await listTracks()).sort((a, b) => a.addedAt - b.addedAt);
      const urls: Record<string, string> = {};
      for (const t of list) urls[t.id] = URL.createObjectURL(t.blob);
      set({
        tracks: list,
        urls,
        loaded: true,
        currentId: get().currentId ?? list[0]?.id ?? null,
        notice: isPersistent() ? "" : "浏览器不允许本地存储，本次会话有效",
      });
      get().syncSource();
    } catch {
      set({ loaded: true });
    }
  },

  addFiles: async (files) => {
    if (files.length === 0) return;
    set({ busy: true });
    get().flash(`正在导入 ${files.length} 个文件…`);
    try {
      const added: MusicTrack[] = [];
      let skipped = 0;
      let locked = 0;
      let lockedWhat = "";
      for (const file of files) {
        const enc = encryptedFrom(file.name);
        if (enc) {
          locked += 1;
          lockedWhat = enc;
          continue;
        }
        const looksAudio = file.type.startsWith("audio/") || AUDIO_RE.test(file.name);
        if (!looksAudio) {
          skipped += 1;
          continue;
        }
        let embedded: string | null = null;
        try {
          embedded = await readEmbeddedLyrics(file);
        } catch {
          /* 读歌词失败不影响导入 */
        }
        const track: MusicTrack = {
          id: uid("trk"),
          name: file.name.replace(/\.[^.]+$/, ""),
          size: file.size,
          type: file.type || "audio/mpeg",
          addedAt: Date.now(),
          blob: file,
          lyrics: embedded ?? "",
          lyricsSource: embedded ? "embedded" : "none",
        };
        await putTrack(track);
        added.push(track);
      }
      if (added.length === 0) {
        if (locked > 0) {
          set({
            notice: `这 ${locked} 个是${lockedWhat}，只有它自己的客户端能解，浏览器放不了 —— 我也不会去破解它。两条可行的路：① 用「外链歌单」直接贴那首歌的分享链接，走官方播放器；② 换成 mp3 / flac / m4a 这类没加密的文件。`,
          });
          get().flash("加密格式，放不了 —— 见下面的说明");
          return;
        }
        get().flash(skipped > 0 ? `这 ${skipped} 个文件不是音频` : "没有选到文件");
        return;
      }
      const urls = { ...get().urls };
      for (const t of added) urls[t.id] = URL.createObjectURL(t.blob);
      const tracks = [...get().tracks, ...added];
      set({ tracks, urls, currentId: get().currentId ?? added[0]!.id });
      const bits = [`加入 ${added.length} 首`];
      const withLyrics = added.filter((t) => t.lyrics).length;
      if (withLyrics) bits.push(`${withLyrics} 首带内嵌歌词`);
      if (skipped) bits.push(`跳过 ${skipped} 个非音频`);
      if (locked) bits.push(`${locked} 个是加密格式，放不了`);
      if (!isPersistent()) bits.push("本次会话有效");
      if (locked) {
        set({
          notice: `有 ${locked} 个是${lockedWhat}，浏览器解不开，也不会去破解。想听那几首可以用「外链歌单」贴链接。`,
        });
      }
      get().flash(bits.join(" · "));
      get().syncSource();
    } catch (err) {
      get().flash(`导入失败：${(err as Error).message || "未知错误"}`);
    } finally {
      set({ busy: false });
    }
  },

  remove: async (id) => {
    await deleteTrack(id);
    const url = get().urls[id];
    if (url) URL.revokeObjectURL(url);
    const urls = { ...get().urls };
    delete urls[id];
    const tracks = get().tracks.filter((t) => t.id !== id);
    const wasCurrent = get().currentId === id;
    set({ tracks, urls, currentId: wasCurrent ? (tracks[0]?.id ?? null) : get().currentId });
    if (wasCurrent) {
      audio?.pause();
      wantPlay = false;
      set({ playing: false });
      get().syncSource();
    }
  },

  writeLyrics: async (id, text, source) => {
    const saved = await dbSaveLyrics(id, text, source);
    if (saved) set({ tracks: get().tracks.map((t) => (t.id === saved.id ? saved : t)) });
    return saved;
  },

  select: (id) => {
    if (id === get().currentId) {
      get().toggle();
      return;
    }
    set({ currentId: id, time: 0, duration: 0 });
    wantPlay = true;
    get().syncSource();
  },

  play: (id) => {
    const el = audio;
    if (!el) return;
    if (id && id !== get().currentId) {
      set({ currentId: id, time: 0, duration: 0 });
      wantPlay = true;
      get().syncSource();
      return;
    }
    wantPlay = true;
    void el.play().catch(() => get().flash("这个格式当前浏览器播不了"));
  },

  pause: () => {
    wantPlay = false;
    audio?.pause();
  },

  toggle: () => {
    if (get().playing) get().pause();
    else get().play();
  },

  step: (delta) => {
    const { tracks, currentId } = get();
    if (tracks.length === 0) return;
    const i = tracks.findIndex((t) => t.id === currentId);
    const next = tracks[(i + delta + tracks.length) % tracks.length];
    if (!next) return;
    set({ currentId: next.id, time: 0, duration: 0 });
    wantPlay = true;
    get().syncSource();
  },

  seek: (seconds) => {
    const el = audio;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    set({ time: el.currentTime });
  },

  setVolume: (v) => {
    const vol = Math.min(1, Math.max(0, v));
    if (audio) audio.volume = vol;
    set({ volume: vol });
  },

  setLoop: (v) => set({ loop: v }),

  findTracks: (query) => {
    const q = query.trim().toLowerCase();
    if (!q) return get().tracks;
    return get().tracks.filter((t) => t.name.toLowerCase().includes(q));
  },

  playByQuery: (query) => {
    const hits = get().findTracks(query);
    if (hits.length === 0) return `音乐库里没有匹配「${query}」的歌`;
    get().play(hits[0]!.id);
    return `开始播放「${hits[0]!.name}」`;
  },

  syncSource: () => {
    const el = audio;
    const { currentId, urls } = get();
    if (!el || !currentId) return;
    const url = urls[currentId];
    if (!url || el.dataset.track === currentId) return;
    el.dataset.track = currentId;
    el.src = url;
    el.load();
    set({ time: 0, duration: 0 });
    if (wantPlay) void el.play().catch(() => get().flash("这个格式当前浏览器播不了"));
  },
}));

/** 当前曲目的可读描述，用于感知层与通知。 */
export function describePlayback(): string {
  const s = usePlayer.getState();
  const t = s.tracks.find((x) => x.id === s.currentId);
  if (!t) return s.tracks.length ? `音乐库 ${s.tracks.length} 首` : "音乐库是空的";
  const mm = Math.floor(s.time / 60);
  const ss = String(Math.floor(s.time % 60)).padStart(2, "0");
  return `${t.name} · ${s.playing ? "播放中" : "暂停"} ${mm}:${ss}`;
}

/** 由 PlayerHost 在音频元素事件里调用。 */
export function playerOnEnded() {
  const s = usePlayer.getState();
  if (s.loop) {
    s.seek(0);
    s.play();
    return;
  }
  s.step(1);
}
