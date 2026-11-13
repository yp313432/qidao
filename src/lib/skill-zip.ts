import { SKILL_LIMITS, safeSkillPath, type SkillFile } from "./skills.ts";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function asFile(path: string, bytes: Uint8Array): SkillFile {
  try {
    const data = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!data.includes("\0")) return { path, data, encoding: "utf8" };
  } catch { /* Preserve binary resources. */ }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { path, data: btoa(binary), encoding: "base64" };
}

/** ZIP central-directory reader with bounded decompression, CRC and traversal checks. */
export async function readSkillZip(buffer: ArrayBuffer): Promise<SkillFile[]> {
  if (buffer.byteLength > SKILL_LIMITS.archive) throw new Error("压缩包超过 16MB");
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === buffer.byteLength) { end = i; break; }
  }
  if (end < 0) throw new Error("不是完整的 ZIP 压缩包");
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count > SKILL_LIMITS.files) throw new Error("不支持分卷压缩包，且文件不能超过 128 个");
  let cursor = view.getUint32(end + 16, true), total = 0;
  const files: SkillFile[] = [], names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("ZIP 文件目录损坏");
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const length = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true), mode = view.getUint32(cursor + 38, true) >>> 16;
    if (cursor + 46 + length + extra + comment > end) throw new Error("ZIP 目录越界");
    const rawPath = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + length));
    cursor += 46 + length + extra + comment;
    if (rawPath.endsWith("/")) { safeSkillPath(rawPath.slice(0, -1)); continue; }
    const path = safeSkillPath(rawPath);
    if (names.has(path) || flags & 1 || (mode & 0xf000) === 0xa000) throw new Error("ZIP 含重复路径、加密文件或符号链接");
    names.add(path); total += size;
    if (size > SKILL_LIMITS.file || total > SKILL_LIMITS.total || offset + 30 > end) throw new Error("Skill 解压后超过大小限制");
    if (view.getUint32(offset, true) !== 0x04034b50) throw new Error("ZIP 文件数据损坏");
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    if (start + compressed > view.getUint32(end + 16, true)) throw new Error("ZIP 数据越界");
    let decoded: Uint8Array;
    if (method === 0) decoded = bytes.slice(start, start + compressed);
    else if (method === 8) {
      const stream = new Blob([bytes.slice(start, start + compressed)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader(), chunks: Uint8Array[] = []; let read = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; read += part.value.length;
        if (read > size || read > SKILL_LIMITS.file) throw new Error("ZIP 解压数据超过声明大小"); chunks.push(part.value); }
      } finally { await reader.cancel().catch(() => {}); }
      decoded = new Uint8Array(read); let at = 0; for (const chunk of chunks) { decoded.set(chunk, at); at += chunk.length; }
    } else throw new Error("ZIP 压缩方式不受支持，请使用普通 ZIP");
    if (decoded.length !== size || crc32(decoded) !== crc) throw new Error("ZIP 文件校验失败");
    files.push(asFile(path, decoded));
  }
  return files;
}
