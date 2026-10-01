/**
 * 歌词：LRC 解析 + 从音频文件里读内嵌歌词。
 *
 * 内嵌歌词只读 ID3v2 的 USLT 帧（mp3）和 MP4 的 ©lyr（m4a）。
 * 中文 mp3 很常见地把整段 LRC 文本塞进 USLT，所以「内嵌」这条路上
 * 有很大概率直接拿到可同步的歌词 —— 解析出来是 LRC 就同步，是纯文本就只展示。
 */

export type LyricLine = { time: number; text: string };

/** 解析 LRC 文本；不是 LRC 格式就返回空数组。 */
export function parseLrc(raw: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const times: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      times.push(Number(m[1]) * 60 + Number(m[2]) + frac);
    }
    if (times.length === 0) continue;
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const t of times) out.push({ time: t, text });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** 找出当前播放时间对应的歌词行号（没有则为 -1）。 */
export function activeLineIndex(lines: LyricLine[], time: number): number {
  if (lines.length === 0) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid] as LyricLine).time <= time) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx;
}

/* ------------------------------ 内嵌歌词读取 ------------------------------ */

function readU32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

/** ID3 用的是「synchsafe」整数：每字节只用低 7 位。 */
function synchsafe(b: Uint8Array, o: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = (v << 7) | (b[o + i]! & 0x7f);
  return v;
}

function decodeText(bytes: Uint8Array, enc: number): string {
  try {
    if (enc === 1) {
      let start = 0;
      let le = true;
      if (bytes.length >= 2) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) {
          le = true;
          start = 2;
        } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
          le = false;
          start = 2;
        }
      }
      return new TextDecoder(le ? "utf-16le" : "utf-16be").decode(bytes.subarray(start));
    }
    if (enc === 2) return new TextDecoder("utf-16be").decode(bytes);
    if (enc === 3) return new TextDecoder("utf-8").decode(bytes);
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    return "";
  }
}

/** USLT 帧体：编码(1) + 语言(3) + 描述(以 0 结尾) + 歌词正文。 */
function decodeUslt(body: Uint8Array): string {
  if (body.length < 5) return "";
  const enc = body[0]!;
  let p = 4;
  if (enc === 0 || enc === 3) {
    while (p < body.length && body[p] !== 0) p++;
    p += 1;
  } else {
    while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
    p += 2;
  }
  return decodeText(body.subarray(p), enc).replace(/\u0000+$/, "").trim();
}

function readId3(buf: Uint8Array, major: number, flags: number): string | null {
  let offset = 10;
  if (flags & 0x40) {
    // 扩展头：v2.4 是 synchsafe 长度（含自身），v2.3 是普通长度（不含自身）
    const ext = major >= 4 ? synchsafe(buf, offset, 4) : readU32(buf, offset);
    offset += major >= 4 ? ext : ext + 4;
  }
  while (offset + 10 <= buf.length) {
    const id = String.fromCharCode(buf[offset]!, buf[offset + 1]!, buf[offset + 2]!, buf[offset + 3]!);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = major >= 4 ? synchsafe(buf, offset + 4, 4) : readU32(buf, offset + 4);
    if (size <= 0 || offset + 10 + size > buf.length) break;
    if (id === "USLT" || id === "SYLT") {
      const text = decodeUslt(buf.subarray(offset + 10, offset + 10 + size));
      if (text) return text;
    }
    offset += 10 + size;
  }
  return null;
}

/** 兜底：在 m4a 里找 ©lyr 原子（best effort，够用就行）。 */
function readMp4(buf: Uint8Array): string | null {
  for (let i = 0; i + 24 < buf.length; i++) {
    if (buf[i] === 0xa9 && buf[i + 1] === 0x6c && buf[i + 2] === 0x79 && buf[i + 3] === 0x72) {
      const start = i + 20;
      if (start >= buf.length) continue;
      let end = start;
      while (end < buf.length && buf[end] !== 0) end++;
      const text = decodeText(buf.subarray(start, end), 3).trim();
      if (text) return text;
    }
  }
  return null;
}

/** 从音频文件里读内嵌歌词；读不到返回 null。 */
export async function readEmbeddedLyrics(file: File): Promise<string | null> {
  try {
    const cap = Math.min(file.size, 4 * 1024 * 1024);
    const head = new Uint8Array(await file.slice(0, Math.min(cap, 10)).arrayBuffer());
    const isId3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
    if (!isId3) {
      const buf = new Uint8Array(await file.slice(0, cap).arrayBuffer());
      return readMp4(buf);
    }
    const major = head[3]!;
    if (major < 3) return null;
    const flags = head[5]!;
    const size = synchsafe(head, 6, 4);
    const total = Math.min(10 + size, cap);
    const buf = new Uint8Array(await file.slice(0, total).arrayBuffer());
    return readId3(buf, major, flags);
  } catch {
    return null;
  }
}
